// Raised terrain and per-map rooms, driven directly through Room / GameServer (no sockets or real clock needed).
import './use-arena-map.js'; // must stay the first import
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Room, GameServer } from '../server/game.js';
import { EVENTS, MAPS, PLAYER, playerAABB } from '../shared/constants.js';
import { mapPhysics } from '../shared/physics.js';

const fakeIo = () => {
  const events = [];
  return { events, to: () => ({ emit: (event, payload) => events.push({ event, payload }) }) };
};
const fakeSocket = (id) => {
  const sent = [];
  return { id, sent, join() {}, leave() {}, emit: (event, payload) => sent.push({ event, payload }), to: () => ({ emit() {} }) };
};
const corrections = (socket) => socket.sent.filter((e) => e.event === EVENTS.POSITION_CORRECTION).length;

// A small test map: a 0.5 m step (walkable) and a 1 m ledge (needs a jump) side by side.
const STEP_MAP = {
  id: 'steps', name: 'Steps', halfSize: 10, wallHeight: 4,
  boxes: [{ x: -3, z: -4, w: 4, d: 4, h: 0.5 }, { x: 3, z: -4, w: 4, d: 4, h: 1 }],
  spawnPoints: [{ x: 0, z: 5 }], dummySpot: { x: 0, z: 8 },
};

function walk(room, socket, p, to, now) {
  // Small moves at walking speed toward `to`, as a client would send them.
  for (let i = 0; i < 60; i++) {
    const dx = to.x - p.x;
    const dz = to.z - p.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.05) break;
    const k = Math.min(1, (PLAYER.moveSpeed / 30) / d);
    now += 1000 / 30;
    room.handleMove(socket, { x: p.x + dx * k, y: to.y, z: p.z + dz * k, ry: 0, rx: 0 }, now);
  }
  return now;
}

test('walking up a step is accepted; a ledge taller than a step is not', () => {
  const room = new Room('r', fakeIo(), { bots: 0, map: STEP_MAP });
  const s = fakeSocket('h1');
  const p = room.addPlayer(s, 'Walker');
  let now = Date.now();
  // Up to the edge of the step at ground level, then onto it at its height.
  now = walk(room, s, p, { x: -3, y: 0, z: -1.6 }, now);
  now = walk(room, s, p, { x: -3, y: 0.5, z: -3 }, now);
  assert.equal(corrections(s), 0);
  assert.deepEqual([p.x, p.y, p.z], [-3, 0.5, -3]);

  room.destroy();

  // The 1 m ledge: walking straight onto it is corrected.
  const room2 = new Room('r2', fakeIo(), { bots: 0, map: STEP_MAP });
  const s2 = fakeSocket('h2');
  const p2 = room2.addPlayer(s2, 'Climber');
  now = walk(room2, s2, p2, { x: 3, y: 0, z: -1.6 }, Date.now());
  assert.equal(corrections(s2), 0);
  room2.handleMove(s2, { x: 3, y: 1, z: -1.9, ry: 0, rx: 0 }, now + 33);
  assert.equal(corrections(s2), 1, 'climbing a 1 m ledge without jumping is rejected');
  room2.destroy();
});

test('players who pick different maps get different rooms', () => {
  const server = new GameServer(fakeIo());
  const a = fakeSocket('a');
  const b = fakeSocket('b');
  const c = fakeSocket('c');
  server.join(a, 'A', 'ascent');
  server.join(b, 'B', 'ascentXL');
  server.join(c, 'C', 'ascentXL');
  assert.notEqual(server.roomOf(a), server.roomOf(b));
  assert.equal(server.roomOf(b), server.roomOf(c));
  assert.equal(server.roomOf(b).map, MAPS.ascentXL);
  assert.equal(b.sent.find((e) => e.event === EVENTS.JOINED).payload.map, 'ascentXL');
  server.join(fakeSocket('d'), 'D', 'no-such-map');
  assert.equal(server.roomOf({ id: 'd' }).map.id, 'arena', 'an unknown map falls back to the default');
  for (const room of server.rooms.values()) room.destroy();
});

test('on Ascent XL, bots climb the terrain and hunt down a human without clipping into it', () => {
  const io = fakeIo();
  const room = new Room('r', io, { bots: 3, map: MAPS.ascentXL });
  const human = room.addPlayer(fakeSocket('h1'), 'Target');
  const phys = mapPhysics(MAPS.ascentXL);
  const bots = [...room.players.values()].filter((p) => p.isBot);
  let now = Date.now();
  for (let i = 0; i < 30 * 120 && human.alive; i++) { // up to two minutes of simulated play
    now += 1000 / 30;
    room.tick(now);
    for (const b of bots) {
      const box = playerAABB(b);
      assert.ok(!phys.blocked(b.x, b.z, PLAYER.radius, box.min.y + 0.02, box.max.y, 0.03), `${b.username} is inside the map at (${b.x}, ${b.y}, ${b.z})`);
    }
  }
  assert.equal(human.alive, false, 'a bot killed the human');
  room.destroy();
});
