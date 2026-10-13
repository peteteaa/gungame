// Static checks on every map layout: players must be able to stand where they spawn.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAPS, PLAYER, mapColliders, playerAABB } from '../shared/constants.js';

const overlaps = (a, b) => a.min.x < b.max.x && a.max.x > b.min.x && a.min.y < b.max.y && a.max.y > b.min.y
  && a.min.z < b.max.z && a.max.z > b.min.z;

for (const [id, map] of Object.entries(MAPS)) {
  test(`${id}: spawn points and the dummy spot are open, in-bounds ground`, () => {
    const colliders = mapColliders(map);
    const points = [...map.spawnPoints, ...(map.dummySpot ? [map.dummySpot] : [])];
    assert.ok(map.spawnPoints.length >= 8, 'enough spawn points to spread a full room');
    for (const p of points) {
      const box = playerAABB({ x: p.x, y: 0, z: p.z });
      assert.ok(Math.abs(p.x) <= map.halfSize - PLAYER.radius && Math.abs(p.z) <= map.halfSize - PLAYER.radius, `(${p.x}, ${p.z}) out of bounds`);
      assert.ok(!colliders.some((c) => overlaps(box, c)), `(${p.x}, ${p.z}) is inside a solid`);
    }
  });
}
