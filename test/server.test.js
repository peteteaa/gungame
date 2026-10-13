// Integration tests: real Socket.io clients against a real server on an ephemeral port.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { io as connect } from 'socket.io-client';
import { startServer } from '../server/server.js';
import { EVENTS, PLAYER, FINAL_TIER, MAX_HEALTH } from '../shared/constants.js';

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

const fireAt = (socket, from, dir) => socket.emit(EVENTS.FIRE_BULLET, {
  origin: { x: from.x, y: PLAYER.eyeHeight, z: from.z }, direction: dir, time: Date.now(),
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
  assert.deepEqual(await killed, { victimId: b.joined.id, killerId: a.joined.id, weapon: 'Pistol' });
  assert.deepEqual(await upgrade, { id: a.joined.id, newTier: 2 });
  const r = await respawn;
  assert.equal(r.id, b.joined.id);
  const room = server.game.socketRoom.get(b.joined.id);
  assert.equal(room.players.get(b.joined.id).health, MAX_HEALTH);
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
