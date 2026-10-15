// Spatial index over a map's colliders, shared by the client (movement) and the server (movement checks, shots,
// bots). Detailed maps have tens of thousands of boxes, so nothing here scans the whole list per query.
import { mapColliders, rayAABB } from './constants.js';

const CELL = 4; // grid cell size in meters (x/z only; boxes are indexed by their footprint)
const cache = new WeakMap(); // map -> physics

export function mapPhysics(map) {
  let phys = cache.get(map);
  if (!phys) {
    phys = createPhysics(mapColliders(map));
    cache.set(map, phys);
  }
  return phys;
}

function createPhysics(colliders) {
  let minX = Infinity; let minZ = Infinity; let maxX = -Infinity; let maxZ = -Infinity; let topY = 0;
  for (const c of colliders) {
    minX = Math.min(minX, c.min.x); minZ = Math.min(minZ, c.min.z);
    maxX = Math.max(maxX, c.max.x); maxZ = Math.max(maxZ, c.max.z);
    topY = Math.max(topY, c.max.y);
  }
  const nx = Math.max(1, Math.ceil((maxX - minX) / CELL));
  const nz = Math.max(1, Math.ceil((maxZ - minZ) / CELL));
  const cx = (x) => Math.min(nx - 1, Math.max(0, Math.floor((x - minX) / CELL)));
  const cz = (z) => Math.min(nz - 1, Math.max(0, Math.floor((z - minZ) / CELL)));
  const cells = Array.from({ length: nx * nz }, () => []);
  colliders.forEach((c, i) => {
    for (let z = cz(c.min.z); z <= cz(c.max.z); z++) for (let x = cx(c.min.x); x <= cx(c.max.x); x++) cells[z * nx + x].push(i);
  });
  const seen = new Uint32Array(colliders.length); // per-query dedupe for boxes that span several cells
  let stamp = 0;

  // Calls fn(box) for each collider whose footprint may overlap the x/z rectangle; stops early when fn returns true.
  function some(x0, z0, x1, z1, fn) {
    if (++stamp === 0xffffffff) { seen.fill(0); stamp = 1; }
    for (let z = cz(z0); z <= cz(z1); z++) {
      for (let x = cx(x0); x <= cx(x1); x++) {
        for (const i of cells[z * nx + x]) {
          if (seen[i] === stamp) continue;
          seen[i] = stamp;
          if (fn(colliders[i])) return true;
        }
      }
    }
    return false;
  }

  // Distance along the normalized dir to the first collider, or maxT if nothing is closer. Walks the grid cells
  // the ray crosses (2D DDA) and stops once a hit is nearer than the next cell boundary.
  function raycast(o, d, maxT = Infinity) {
    if (++stamp === 0xffffffff) { seen.fill(0); stamp = 1; }
    let best = maxT;
    let x = cx(o.x);
    let z = cz(o.z);
    const sx = d.x > 0 ? 1 : -1;
    const sz = d.z > 0 ? 1 : -1;
    const tdx = Math.abs(d.x) > 1e-9 ? CELL / Math.abs(d.x) : Infinity;
    const tdz = Math.abs(d.z) > 1e-9 ? CELL / Math.abs(d.z) : Infinity;
    let tx = Math.abs(d.x) > 1e-9 ? ((minX + (x + (sx > 0 ? 1 : 0)) * CELL) - o.x) / d.x : Infinity;
    let tz = Math.abs(d.z) > 1e-9 ? ((minZ + (z + (sz > 0 ? 1 : 0)) * CELL) - o.z) / d.z : Infinity;
    for (;;) {
      for (const i of cells[z * nx + x]) {
        if (seen[i] === stamp) continue;
        seen[i] = stamp;
        const t = rayAABB(o, d, colliders[i].min, colliders[i].max);
        if (t !== null && t < best) best = t;
      }
      const next = Math.min(tx, tz);
      if (best <= next || next === Infinity) return best;
      if (tx < tz) { x += sx; tx += tdx; if (x < 0 || x >= nx) return best; } else { z += sz; tz += tdz; if (z < 0 || z >= nz) return best; }
    }
  }

  // Highest collider top under the square footprint (x, z, half-width r) at or below y + eps; 0 = the ground.
  function surfaceBelow(x, y, z, r, eps = 0.1) {
    let top = 0;
    some(x - r, z - r, x + r, z + r, (c) => {
      if (c.max.y <= y + eps && c.max.y > top && x - r < c.max.x && x + r > c.min.x && z - r < c.max.z && z + r > c.min.z) top = c.max.y;
    });
    return top;
  }

  // Does a box with footprint half-width r spanning [y0, y1] overlap any collider (each shrunk by inset)?
  function blocked(x, z, r, y0, y1, inset = 0) {
    return some(x - r, z - r, x + r, z + r, (c) => x - r < c.max.x - inset && x + r > c.min.x + inset
      && z - r < c.max.z - inset && z + r > c.min.z + inset && y0 < c.max.y - inset && y1 > c.min.y + inset);
  }

  return { colliders, some, raycast, surfaceBelow, blocked, topY };
}
