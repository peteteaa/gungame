// AI bots, driven directly through a Room with simulated time (no sockets or real clock needed).
import './use-arena-map.js'; // must stay the first import
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Room } from '../server/game.js';
import { canSee } from '../server/bots.js';
import { EVENTS, mapColliders, playerAABB } from '../shared/constants.js';

const fakeIo = () => {
  const events = [];
  return { events, to: () => ({ emit: (event, payload) => events.push({ event, payload }) }) };
};
const fakeSocket = (id) => ({ id, join() {}, leave() {}, emit() {}, to: () => ({ emit() {} }) });
const botsIn = (room) => [...room.players.values()].filter((p) => p.isBot);

test('each human after the first replaces one bot, and bots come back as humans leave', () => {
  const io = fakeIo();
  const room = new Room('r', io, { bots: 3 });
  room.addPlayer(fakeSocket('h1'), 'Solo');
  assert.equal(botsIn(room).length, 3);
  assert.equal(room.size, 1, 'bots take no slots');
  assert.equal(io.events.filter((e) => e.event === EVENTS.PLAYER_JOINED).length, 3);

  room.addPlayer(fakeSocket('h2'), 'Second');
  assert.equal(botsIn(room).length, 2);
  room.addPlayer(fakeSocket('h3'), 'Third');
  assert.equal(botsIn(room).length, 1);
  room.addPlayer(fakeSocket('h4'), 'Fourth');
  assert.equal(botsIn(room).length, 0);
  assert.equal(io.events.filter((e) => e.event === EVENTS.PLAYER_LEFT).length, 3);

  room.removePlayer(fakeSocket('h4'));
  room.removePlayer(fakeSocket('h3'));
  assert.equal(botsIn(room).length, 2);
  assert.deepEqual(botsIn(room).map((b) => b.username).sort(), ['BOT Ava', 'BOT Kai']);
  room.removePlayer(fakeSocket('h2'));
  room.removePlayer(fakeSocket('h1'));
  assert.equal(botsIn(room).length, 0, 'an empty room keeps no bots');
  room.destroy();
});

test('line of sight is blocked by map geometry', () => {
  // Arena: a 4x4, 3-high box at the center.
  assert.equal(canSee({ x: -10, y: 1.6, z: 0 }, { x: 10, y: 1.2, z: 0 }), false);
  assert.equal(canSee({ x: -10, y: 1.6, z: 0 }, { x: -10, y: 1.2, z: 10 }), true);
});

test('bots hunt down and kill a human standing still, without walking into walls', () => {
  const io = fakeIo();
  const room = new Room('r', io, { bots: 3 });
  const human = room.addPlayer(fakeSocket('h1'), 'Target');
  const colliders = mapColliders();
  const inside = (p) => {
    const b = playerAABB(p);
    return colliders.some((c) => b.min.x < c.max.x - 0.01 && b.max.x > c.min.x + 0.01 && b.min.z < c.max.z - 0.01 && b.max.z > c.min.z + 0.01);
  };
  let now = Date.now();
  for (let i = 0; i < 30 * 60 && human.alive; i++) { // up to a minute of simulated play
    now += 1000 / 30;
    room.tick(now);
    for (const b of botsIn(room)) assert.ok(!inside(b), `${b.username} is inside a wall at (${b.x.toFixed(2)}, ${b.z.toFixed(2)})`);
  }
  assert.equal(human.alive, false, 'a bot killed the human');
  const kill = io.events.find((e) => e.event === EVENTS.PLAYER_KILLED && e.payload.victimId === 'h1');
  assert.ok(kill.payload.killerId.startsWith('bot_'));
  const taunt = io.events.find((e) => e.event === EVENTS.CHAT_MESSAGE && e.payload.id === kill.payload.killerId);
  assert.ok(taunt, 'the killer says something in chat');
  assert.equal(taunt.payload.bot, true);
  assert.ok(taunt.payload.text.length > 0);
  room.destroy();
});
