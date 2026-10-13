// Integration tests: real Socket.io clients against a real server on an ephemeral port.
import './use-arena-map.js'; // must stay the first import
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { io as connect } from 'socket.io-client';
import { startServer } from '../server/server.js';
import { EVENTS, PLAYER, FINAL_TIER, MAX_HEALTH, WEAPON_TIERS, HEADSHOT_MULTIPLIER, getWeapon } from '../shared/constants.js';

let server;
let url;
const sockets = [];

before(async () => {
  server = startServer({ port: 0 });
  url = `http://localhost:${await server.ready}`;
});

after(async () => {
  for (const s of sockets) s.disconnect();
  await server.close();
});

const once = (socket, event, timeoutMs = 3000) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error(`timed out waiting for ${event}`)), timeoutMs);
  socket.once(event, (data) => { clearTimeout(timer); resolve(data); });
});

// Resolves true if the event does NOT arrive within the window.
const silent = (socket, event, ms = 300) => new Promise((resolve) => {
  const handler = () => { clearTimeout(timer); resolve(false); };
  const timer = setTimeout(() => { socket.off(event, handler); resolve(true); }, ms);
  socket.once(event, handler);
});

async function joinPlayer(username) {
  const socket = connect(url, { transports: ['websocket'], forceNew: true });
  sockets.push(socket);
  const joined = once(socket, EVENTS.JOINED);
  socket.emit(EVENTS.JOIN_MATCH, { username });
  return { socket, joined: await joined };
}

// Put a player at an exact spot with no rewind history, directly in server state.
function place(id, x, z, extra = {}) {
  const room = server.game.socketRoom.get(id);
  const p = room.players.get(id);
  Object.assign(p, { x, y: 0, z, history: [], lastFireAt: 0, ...extra });
  return { room, p };
}

const CHEST = 1.1; // below PLAYER.headY, so level shots from here are body shots
const fireAt = (socket, from, dir, y = CHEST) => socket.emit(EVENTS.FIRE_BULLET, {
  origin: { x: from.x, y, z: from.z }, direction: dir, time: Date.now(),
});

test('join assigns a room, sanitizes the name, and streams state updates', async () => {
  const { socket, joined } = await joinPlayer('<script>Alice</script>!!');
  assert.equal(joined.player.username, 'scriptAlicescrip'); // tags stripped, capped at 16 chars
  assert.equal(joined.player.tier, 1);
  assert.equal(joined.player.health, MAX_HEALTH);
  const state = await once(socket, EVENTS.STATE_UPDATE);
  assert.ok(state.players[joined.id]);
  assert.equal(typeof state.serverTime, 'number');
  socket.disconnect();
});

test('ping ack returns server time', async () => {
  const { socket } = await joinPlayer('Pinger');
  const t = await new Promise((resolve) => socket.emit(EVENTS.PING, Date.now(), resolve));
  assert.ok(Math.abs(t - Date.now()) < 1000);
  socket.disconnect();
});

test('implausible movement is rejected with a position correction', async () => {
  const { socket, joined } = await joinPlayer('Teleporter');
  const start = joined.player;
  const correction = once(socket, EVENTS.POSITION_CORRECTION);
  socket.emit(EVENTS.PLAYER_MOVE, { x: start.x + 40, y: 0, z: start.z, ry: 0, rx: 0 });
  const c = await correction;
  assert.deepEqual([c.x, c.z], [start.x, start.z]);
  socket.disconnect();
});

test('pistol kills in 3 shots, awards a tier upgrade, then the victim respawns', async () => {
  const a = await joinPlayer('Shooter');
  const b = await joinPlayer('Target');
  place(a.joined.id, 10, 5);
  place(b.joined.id, 10, -5);

  for (const expectedHealth of [65, 30]) {
    const hit = once(a.socket, EVENTS.PLAYER_HIT);
    fireAt(a.socket, { x: 10, z: 5 }, { x: 0, y: 0, z: -1 });
    const h = await hit;
    assert.equal(h.targetId, b.joined.id);
    assert.equal(h.health, expectedHealth);
    place(a.joined.id, 10, 5); // reset fire cooldown
  }

  const killed = once(b.socket, EVENTS.PLAYER_KILLED);
  const upgrade = once(b.socket, EVENTS.TIER_UPGRADE);
  const respawn = once(b.socket, EVENTS.PLAYER_RESPAWN, 4000);
  fireAt(a.socket, { x: 10, z: 5 }, { x: 0, y: 0, z: -1 });
  assert.deepEqual(await killed, { victimId: b.joined.id, killerId: a.joined.id, weapon: 'Pistol', headshot: false });
  assert.deepEqual(await upgrade, { id: a.joined.id, newTier: 2 });
  const r = await respawn;
  assert.equal(r.id, b.joined.id);
  const room = server.game.socketRoom.get(b.joined.id);
  assert.equal(room.players.get(b.joined.id).health, MAX_HEALTH);
  a.socket.disconnect();
  b.socket.disconnect();
});

test('headshots deal bonus damage and are flagged; body shots are not', async () => {
  const a = await joinPlayer('Headhunter');
  const b = await joinPlayer('Helmetless');
  place(a.joined.id, 10, 5);
  place(b.joined.id, 10, -5);
  const pistol = getWeapon(1);

  const head = once(a.socket, EVENTS.PLAYER_HIT);
  fireAt(a.socket, { x: 10, z: 5 }, { x: 0, y: 0, z: -1 }, PLAYER.eyeHeight); // level with the target's head
  const h = await head;
  assert.equal(h.headshot, true);
  assert.equal(h.damage, pistol.damage * HEADSHOT_MULTIPLIER);

  place(a.joined.id, 10, 5); // reset fire cooldown
  const body = once(a.socket, EVENTS.PLAYER_HIT);
  const killed = once(a.socket, EVENTS.PLAYER_KILLED);
  fireAt(a.socket, { x: 10, z: 5 }, { x: 0, y: 0, z: -1 });
  const bh = await body;
  assert.equal(bh.headshot, false);
  assert.equal(bh.damage, pistol.damage);
  assert.equal((await killed).headshot, false); // the killing blow was a body shot
  a.socket.disconnect();
  b.socket.disconnect();
});

test('the flamethrower gets no headshot bonus', async () => {
  const tier = WEAPON_TIERS.findIndex((w) => w.name === 'Flamethrower') + 1;
  const a = await joinPlayer('Torch');
  const b = await joinPlayer('Kindling');
  place(a.joined.id, 10, 5, { tier, ammo: getWeapon(tier).magSize });
  place(b.joined.id, 10, 2);
  const hit = once(a.socket, EVENTS.PLAYER_HIT);
  fireAt(a.socket, { x: 10, z: 5 }, { x: 0, y: 0, z: -1 }, PLAYER.eyeHeight);
  assert.ok((await hit).damage <= getWeapon(tier).damage);
  a.socket.disconnect();
  b.socket.disconnect();
});

test('fire rate is enforced server-side', async () => {
  const a = await joinPlayer('Spammer');
  const b = await joinPlayer('Victim');
  place(a.joined.id, 10, 5);
  place(b.joined.id, 10, -5);
  const hits = [];
  a.socket.on(EVENTS.PLAYER_HIT, (h) => hits.push(h));
  for (let i = 0; i < 5; i++) fireAt(a.socket, { x: 10, z: 5 }, { x: 0, y: 0, z: -1 });
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(hits.length, 1);
  a.socket.disconnect();
  b.socket.disconnect();
});

test('spamming tiny moves cannot exceed max speed', async () => {
  const { socket, joined } = await joinPlayer('Speeder');
  const { p } = place(joined.id, -10, 5, { lastMoveAt: Date.now() });
  for (let i = 1; i <= 20; i++) socket.emit(EVENTS.PLAYER_MOVE, { x: -10 + i * 0.7, y: 0, z: 5, ry: 0, rx: 0 });
  await new Promise((r) => setTimeout(r, 150));
  assert.ok(p.x - -10 < 3, `moved ${(p.x + 10).toFixed(2)} units in ~150ms`);
  socket.disconnect();
});

test('spamming upward moves cannot fly', async () => {
  const { socket, joined } = await joinPlayer('Flyer');
  const { p } = place(joined.id, -10, 5, { lastMoveAt: Date.now() });
  for (let i = 1; i <= 12; i++) socket.emit(EVENTS.PLAYER_MOVE, { x: -10, y: i * 0.5, z: 5, ry: 0, rx: 0 });
  await new Promise((r) => setTimeout(r, 150));
  assert.ok(p.y < 2, `reached y=${p.y.toFixed(2)}`);
  socket.disconnect();
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SEND_MS = 33;
const arc = (t) => PLAYER.jumpVelocity * t - 0.5 * PLAYER.gravity * t * t; // height above takeoff t seconds into a jump

// Sends moves at the client's rate. Returns the corrections received.
async function sendPath(socket, points) {
  const corrections = [];
  const onCorrection = (c) => corrections.push(c);
  socket.on(EVENTS.POSITION_CORRECTION, onCorrection);
  for (const pt of points) {
    socket.emit(EVENTS.PLAYER_MOVE, { ...pt, ry: 0, rx: 0 });
    await sleep(SEND_MS);
  }
  await sleep(50);
  socket.off(EVENTS.POSITION_CORRECTION, onCorrection);
  return corrections;
}

test('a normal running jump is accepted', async () => {
  const { socket, joined } = await joinPlayer('Jumper');
  const { p } = place(joined.id, -10, 5, { lastMoveAt: Date.now() });
  const points = [];
  for (let t = SEND_MS / 1000; arc(t) > 0; t += SEND_MS / 1000) points.push({ x: -10 + 6 * t, y: arc(t), z: 5 });
  points.push({ x: points.at(-1).x + 0.2, y: 0, z: 5 });
  assert.deepEqual(await sendPath(socket, points), []);
  assert.equal(p.y, 0);
  socket.disconnect();
});

test('walking off a tall box falls without corrections', async () => {
  const { socket, joined } = await joinPlayer('Faller');
  // corner tower at (22, 22) is 4 tall and spans x 20.5..23.5; start on its west edge
  const { p } = place(joined.id, 20.4, 22, { y: 4, groundY: 4, lastMoveAt: Date.now() });
  const points = [];
  for (let t = SEND_MS / 1000; ; t += SEND_MS / 1000) {
    const x = 20.4 - 6 * t;
    const y = Math.max(0, 4 - 0.5 * PLAYER.gravity * (t - 0.02) ** 2);
    points.push({ x, y, z: 22 });
    if (y === 0) break;
  }
  assert.deepEqual(await sendPath(socket, points), []);
  assert.equal(p.y, 0);
  socket.disconnect();
});

test('hovering in mid-air is pulled back down', async () => {
  const { socket, joined } = await joinPlayer('Hoverer');
  const { p } = place(joined.id, -10, 5, { lastMoveAt: Date.now() });
  const points = [0.2, 0.45, 0.7, 0.9, 1.0].map((y) => ({ x: -10, y, z: 5 }));
  for (let i = 0; i < 36; i++) points.push({ x: -10, y: 1.0, z: 5 }); // ~1.2s of claimed hovering
  const corrections = await sendPath(socket, points);
  assert.ok(corrections.length > 0, 'expected a correction');
  assert.ok(p.y < 0.5, `server still has the player at y=${p.y.toFixed(2)}`);
  socket.disconnect();
});

test('a player who stops sending moves mid-air still falls', async () => {
  const { socket, joined } = await joinPlayer('Freezer');
  const { p } = place(joined.id, -10, 5, { lastMoveAt: Date.now() });
  await sendPath(socket, [0.2, 0.45, 0.7, 0.9, 1.1].map((y) => ({ x: -10, y, z: 5 })));
  await sleep(1000);
  assert.equal(p.y, 0);
  socket.disconnect();
});

test('moving into a box is rejected', async () => {
  const { socket, joined } = await joinPlayer('Ghost');
  place(joined.id, 0, 2.5, { lastMoveAt: Date.now() - 100 }); // just south of the center box (z <= 2)
  const correction = once(socket, EVENTS.POSITION_CORRECTION);
  socket.emit(EVENTS.PLAYER_MOVE, { x: 0, y: 0, z: 1.9, ry: 0, rx: 0 });
  const c = await correction;
  assert.equal(c.z, 2.5);
  socket.disconnect();
});

test('fire rate tolerance does not allow a faster sustained rate', async () => {
  const a = await joinPlayer('Macro');
  const b = await joinPlayer('Dummy');
  place(a.joined.id, 10, 5);
  place(b.joined.id, 10, -5);
  const hits = [];
  a.socket.on(EVENTS.PLAYER_HIT, (h) => hits.push(h));
  for (let i = 0; i < 3; i++) {
    fireAt(a.socket, { x: 10, z: 5 }, { x: 0, y: 0, z: -1 });
    await new Promise((r) => setTimeout(r, 350)); // pistol is 400ms; 350 passes a per-shot 0.85 check
  }
  assert.equal(hits.length, 2);
  a.socket.disconnect();
  b.socket.disconnect();
});

test('walls block shots', async () => {
  const a = await joinPlayer('Camper');
  const b = await joinPlayer('Hider');
  place(a.joined.id, 0, 8);
  place(b.joined.id, 0, -8); // center box sits between them
  const shot = once(a.socket, EVENTS.SHOT_FIRED);
  const noHit = silent(a.socket, EVENTS.PLAYER_HIT);
  fireAt(a.socket, { x: 0, z: 8 }, { x: 0, y: 0, z: -1 });
  const s = await shot;
  assert.ok(s.ends[0].z > 1.9, 'tracer should stop at the box face (z=2)');
  assert.ok(await noHit);
  a.socket.disconnect();
  b.socket.disconnect();
});

test('shots from a spoofed origin are ignored', async () => {
  const a = await joinPlayer('Cheater');
  const b = await joinPlayer('Honest');
  place(a.joined.id, 10, 20);
  place(b.joined.id, 10, -5);
  const noShot = silent(a.socket, EVENTS.SHOT_FIRED);
  fireAt(a.socket, { x: 10, z: 5 }, { x: 0, y: 0, z: -1 }); // claims to be 15 units from where it is
  assert.ok(await noShot);
  a.socket.disconnect();
  b.socket.disconnect();
});

test('lag compensation hits where the target was, not where it is now', async () => {
  const a = await joinPlayer('LaggyShooter');
  const b = await joinPlayer('Runner');
  place(a.joined.id, 10, 5);
  const { p: target } = place(b.joined.id, 15, -5);
  const now = Date.now();
  // 200ms ago the runner was directly in the line of fire at x=10.
  target.history = [{ t: now - 400, x: 10, y: 0, z: -5 }, { t: now - 150, x: 10, y: 0, z: -5 }, { t: now, x: 15, y: 0, z: -5 }];
  const hit = once(a.socket, EVENTS.PLAYER_HIT);
  a.socket.emit(EVENTS.FIRE_BULLET, {
    origin: { x: 10, y: PLAYER.eyeHeight, z: 5 }, direction: { x: 0, y: 0, z: -1 }, time: now - 100, // shooter rendered at now - 200
  });
  assert.equal((await hit).targetId, b.joined.id);
  a.socket.disconnect();
  b.socket.disconnect();
});

test('a kill with the final tier weapon wins the match', async () => {
  const a = await joinPlayer('Winner');
  const b = await joinPlayer('Loser');
  place(a.joined.id, 10, 5, { tier: FINAL_TIER });
  place(b.joined.id, 10, 3.5); // within knife range
  const over = once(b.socket, EVENTS.MATCH_OVER);
  fireAt(a.socket, { x: 10, z: 5 }, { x: 0, y: 0, z: -1 });
  const o = await over;
  assert.equal(o.winnerId, a.joined.id);
  assert.equal(o.username, 'Winner');

  const room = server.game.socketRoom.get(a.joined.id);
  assert.equal(room.matchActive, false);
  const restart = once(b.socket, EVENTS.MATCH_RESTART);
  clearTimeout(room.restartTimer);
  room.restartMatch();
  const { players } = await restart;
  assert.equal(players[a.joined.id].tier, 1);
  assert.equal(players[b.joined.id].alive, true);
  a.socket.disconnect();
  b.socket.disconnect();
});

test('knife cannot reach beyond its range', async () => {
  const a = await joinPlayer('Stabber');
  const b = await joinPlayer('FarAway');
  place(a.joined.id, 10, 5, { tier: FINAL_TIER });
  place(b.joined.id, 10, -5);
  const noHit = silent(a.socket, EVENTS.PLAYER_HIT);
  fireAt(a.socket, { x: 10, z: 5 }, { x: 0, y: 0, z: -1 });
  assert.ok(await noHit);
  a.socket.disconnect();
  b.socket.disconnect();
});

test('empty rooms are cleaned up after everyone leaves', async () => {
  for (const s of sockets) s.disconnect();
  await new Promise((r) => setTimeout(r, 200));
  const res = await fetch(`${url}/health`).then((r) => r.json());
  assert.deepEqual(res, { ok: true, rooms: 0, players: 0 });
});

test('emptying the magazine auto-reloads, and shots during the reload are ignored', async () => {
  const a = await joinPlayer('Dry');
  const b = await joinPlayer('Wall');
  const { p } = place(a.joined.id, 10, 5, { ammo: 1 });
  place(b.joined.id, 10, -5);
  const reloadStart = once(a.socket, EVENTS.AMMO);
  const hit = once(a.socket, EVENTS.PLAYER_HIT);
  fireAt(a.socket, { x: 10, z: 5 }, { x: 0, y: 0, z: -1 });
  await hit;
  assert.deepEqual(await reloadStart, { ammo: 0, reloading: true, reloadMs: getWeapon(1).reloadMs });

  p.lastFireAt = 0;
  const noHit = silent(a.socket, EVENTS.PLAYER_HIT);
  fireAt(a.socket, { x: 10, z: 5 }, { x: 0, y: 0, z: -1 });
  assert.ok(await noHit, 'shot during reload should be ignored');

  const done = once(a.socket, EVENTS.AMMO);
  p.reloadingUntil = Date.now(); // fast-forward; the tick loop completes it
  assert.deepEqual(await done, { ammo: getWeapon(1).magSize, reloading: false, reloadMs: getWeapon(1).reloadMs });
  a.socket.disconnect();
  b.socket.disconnect();
});

test('manual reload only starts with a partly used magazine', async () => {
  const { socket, joined } = await joinPlayer('Reloader');
  const { p } = place(joined.id, 10, 5);
  const ignored = silent(socket, EVENTS.AMMO);
  socket.emit(EVENTS.RELOAD);
  assert.ok(await ignored, 'full magazine should not reload');

  p.ammo = 3;
  const started = once(socket, EVENTS.AMMO);
  socket.emit(EVENTS.RELOAD);
  assert.equal((await started).reloading, true);
  assert.ok(p.reloadingUntil > Date.now());
  socket.disconnect();
});

test('a kill upgrade refills the new weapon and cancels a reload', async () => {
  const a = await joinPlayer('Upgrader');
  const b = await joinPlayer('Fodder');
  const { p } = place(a.joined.id, 10, 5, { ammo: 1 }); // last round: the kill also triggers an auto-reload
  const { p: victim } = place(b.joined.id, 10, -5);
  victim.health = 10;
  const upgrade = once(a.socket, EVENTS.TIER_UPGRADE);
  fireAt(a.socket, { x: 10, z: 5 }, { x: 0, y: 0, z: -1 });
  await upgrade;
  assert.equal(p.ammo, getWeapon(2).magSize);
  assert.equal(p.reloadingUntil, 0);
  a.socket.disconnect();
  b.socket.disconnect();
});
