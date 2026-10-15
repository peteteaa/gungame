// AI players that fill out rooms with few humans. They walk a grid path (up stairs, off ledges) to the nearest
// enemy, shoot only at enemies they can actually see (after a reaction delay, with turn-rate-limited, wobbly
// aim), and fire through Room.fireFrom, so fire rate, ammo, reloads and hit detection are the same as a human's.
import { PLAYER, MAP, INTERPOLATION_DELAY_MS, getWeapon } from '../shared/constants.js';
import { mapPhysics } from '../shared/physics.js';

export const BOT_NAMES = ['Ava', 'Kai', 'Milo', 'Nova', 'Rex', 'Zed', 'Ivy'];

// What a bot says in chat after a kill. {victim} and {weapon} are filled in.
const TAUNTS = [
  'gg {victim}, I was aiming at the wall',
  '{victim} I am literally a for loop',
  'gg freaking ez',
  'sorry {victim}, my aim is set to "yes"',
  'beep boop, {victim} has been deleted',
  '{victim} did you try turning your aim on and off again?',
  'that {weapon} goes hard',
  'calculated. (I cannot calculate)',
  '{victim} lagged. definitely lag. not skill',
  'my creator would be proud. or concerned',
  '{victim} respawn and try again, I believe in you',
  'error 404: {victim} not found',
  'I run at 30 ticks a second and still outplayed you {victim}',
  'tell the Dummy I said hi, {victim}',
  'is this what humans call "fun"?',
  '{victim}, I was programmed in 15 minutes',
  'uninstalling your hitbox, {victim}',
];
const HEADSHOT_TAUNTS = [
  'HEADSHOT. {victim} your head is a hitbox, did you know?',
  'right between the pixels, {victim}',
  '{victim}, nice hat. was',
];
const pickLine = (list) => list[Math.floor(Math.random() * list.length)];

export function botTaunt(victim, weapon, headshot = false) {
  const line = headshot && Math.random() < 0.5 ? pickLine(HEADSHOT_TAUNTS) : pickLine(TAUNTS);
  return line.replaceAll('{victim}', victim).replaceAll('{weapon}', weapon);
}

const CELL = 0.5; // nav grid resolution in meters; cell centers sit on multiples of CELL, like map walls, so a
// 1 m doorway has a center exactly in its middle
const NAV_CLEARANCE = PLAYER.radius + 0.05;
const MAX_DROP = 4; // bots will path off ledges up to this high
const CHEST = 1.2; // aim point above the feet: a body shot, so bots rarely land headshots
const SIGHT = 80; // meters a bot can spot an enemy at (walls still block)
const SPEED = PLAYER.moveSpeed * 0.85;
const TURN_RATE = 6; // rad/s
const REACTION_MS = [350, 700]; // delay after first spotting a target before the first shot
const TRACK_MS = 1000; // a target out of sight for less than this is still tracked (no new reaction delay)
const AIM_WOBBLE = 0.05; // rad, re-rolled a few times a second
const FIRE_CONE = 0.06; // fire once the aim is this close to the target (plus the target's angular half-width)
const SEMI_AUTO_DELAY = [1.2, 1.7]; // multiplier on fire rate for non-auto weapons, like a human clicking
const REPATH_MS = 800;
const LOOKAHEAD = 8; // waypoints checked when cutting straight to a later one
const STUCK_MS = 1000; // making no progress this long triggers a short random walk to get unstuck
const LOST_MS = 10000; // a bot that hunts this long without getting LOST_DIST anywhere is respawned
const LOST_DIST = 3;

const rand = (lo, hi) => lo + Math.random() * (hi - lo);
const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
const angleTo = (a, b) => Math.atan2(Math.sin(b - a), Math.cos(b - a));

// Nav graph per map: each grid cell has one node per surface under its center (the ground, or a collider top), so
// multi-level maps work. Nodes with headroom above are standable (ok); the rest are kept so a move that would land
// on one (a ledge too low to stand under) is known to be blocked. Built on first use.
const navCache = new WeakMap();
function navFor(map) {
  let nav = navCache.get(map);
  if (nav) return nav;
  const phys = mapPhysics(map);
  const n = Math.floor((map.halfSize * 2) / CELL) + 1;
  const center = (i) => -map.halfSize + i * CELL;
  const start = new Int32Array(n * n + 1); // nodes of cell k are start[k] .. start[k + 1] - 1
  const ys = [];
  const ok = [];
  for (let k = 0; k < n * n; k++) {
    start[k] = ys.length;
    const x = center(k % n);
    const z = center(Math.floor(k / n));
    const floors = [0];
    phys.some(x, z, x, z, (c) => {
      if (x >= c.min.x && x <= c.max.x && z >= c.min.z && z <= c.max.z) floors.push(c.max.y);
    });
    floors.sort((a, b) => a - b);
    for (let i = 0; i < floors.length; i++) {
      const y = floors[i];
      if (i && y - floors[i - 1] < 0.01) continue;
      ys.push(y);
      // Anything lower than a step is walked over, so only check for room from step height up.
      ok.push(phys.blocked(x, z, NAV_CLEARANCE, y + PLAYER.stepHeight + 0.05, y + PLAYER.height) ? 0 : 1);
    }
  }
  start[n * n] = ys.length;
  nav = { map, phys, n, center, start, ys: Float32Array.from(ys), ok: Uint8Array.from(ok) };
  navCache.set(map, nav);
  return nav;
}

const cellOf = (nav, v) => clamp(Math.round((v + nav.map.halfSize) / CELL), 0, nav.n - 1);

// The node nearest (x, y, z): in its own cell if that has one, else the closest within two cells (the cell
// center can sit inside a wall the body itself is only brushing). Floors more than a step above y count as far
// away. Returns -1 if there's none.
function nodeAt(nav, x, y, z) {
  const c0 = cellOf(nav, x);
  const r0 = cellOf(nav, z);
  let best = -1;
  let bestD = Infinity;
  for (let ring = 0; ring <= 2 && best < 0; ring++) {
    for (let r = r0 - ring; r <= r0 + ring; r++) {
      for (let c = c0 - ring; c <= c0 + ring; c++) {
        if (r < 0 || c < 0 || r >= nav.n || c >= nav.n || Math.max(Math.abs(r - r0), Math.abs(c - c0)) !== ring) continue;
        const k = r * nav.n + c;
        for (let i = nav.start[k]; i < nav.start[k + 1]; i++) {
          if (!nav.ok[i]) continue;
          const d = Math.abs(nav.ys[i] - y) + (nav.ys[i] > y + PLAYER.stepHeight ? 100 : 0)
            + Math.hypot(nav.center(c) - x, nav.center(r) - z);
          if (d < bestD) { bestD = d; best = i; }
        }
      }
    }
  }
  return best;
}

// Cell index of node i (binary search over the CSR offsets).
function cellOfNode(nav, i) {
  let lo = 0;
  let hi = nav.n * nav.n - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (nav.start[mid] <= i) lo = mid; else hi = mid - 1;
  }
  return lo;
}

// The node in cell k a body at floor y moves onto: the highest surface at most a step up, if it's standable and no
// more than MAX_DROP down; else -1.
function stepInto(nav, k, y) {
  let best = -1;
  for (let i = nav.start[k]; i < nav.start[k + 1]; i++) {
    const ny = nav.ys[i];
    if (ny <= y + PLAYER.stepHeight && (best < 0 || ny > nav.ys[best])) best = i;
  }
  return best >= 0 && nav.ok[best] && nav.ys[best] >= y - MAX_DROP ? best : -1;
}

const NEIGHBORS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

// Breadth-first search over the nav graph (diagonals only where both sides are walkable, so corners aren't cut).
// Ends at the goal node, or the reachable node nearest it when the goal itself isn't reachable.
function findPath(nav, from, to) {
  const n = nav.n;
  const startNode = nodeAt(nav, from.x, from.y ?? 0, from.z);
  if (startNode < 0) return [{ x: from.x, y: from.y ?? 0, z: from.z }];
  const gc = cellOf(nav, to.x);
  const gr = cellOf(nav, to.z);
  const gy = to.y ?? 0;
  const parent = new Int32Array(nav.ys.length).fill(-1);
  const cellOfQ = new Int32Array(nav.ys.length);
  parent[startNode] = startNode;
  cellOfQ[startNode] = cellOfNode(nav, startNode);
  const queue = [startNode];
  let best = startNode;
  let bestD = Infinity;
  for (let qi = 0; qi < queue.length; qi++) {
    const cur = queue[qi];
    const k = cellOfQ[cur];
    const r = Math.floor(k / n);
    const c = k % n;
    const y = nav.ys[cur];
    const d = Math.hypot(c - gc, r - gr) * CELL + Math.abs(y - gy) * 2;
    if (d < bestD) { bestD = d; best = cur; if (d < 0.5) break; }
    for (const [dc, dr] of NEIGHBORS) {
      const nc = c + dc;
      const nr = r + dr;
      if (nc < 0 || nr < 0 || nc >= n || nr >= n) continue;
      const nk = nr * n + nc;
      const next = stepInto(nav, nk, y);
      if (next < 0 || parent[next] !== -1) continue;
      if (dc && dr && (stepInto(nav, r * n + nc, y) < 0 || stepInto(nav, nr * n + c, y) < 0)) continue;
      parent[next] = cur;
      cellOfQ[next] = nk;
      queue.push(next);
    }
  }
  const path = [];
  for (let cur = best; ; cur = parent[cur]) {
    const k = cellOfQ[cur];
    path.push({ x: nav.center(k % n), y: nav.ys[cur], z: nav.center(Math.floor(k / n)) });
    if (cur === startNode) break;
  }
  return path.reverse();
}

// Where a body standing at height y ends up moving to (nx, nz): onto the floor there (up at most a step, and never
// above cap, or dropping down), or null if a wall is in the way.
function landing(phys, y, nx, nz, cap = y + PLAYER.stepHeight) {
  const floor = phys.surfaceBelow(nx, Math.min(y + PLAYER.stepHeight, cap), nz, PLAYER.radius, 0.01);
  if (phys.blocked(nx, nz, PLAYER.radius, floor + 0.01, floor + PLAYER.height, 0.02)) return null;
  return floor;
}

// The highest a bot heading for `to` will climb: a step above it (so it doesn't wander up onto ledges and
// awnings off its path), or where it already is.
const climbCap = (y, to) => Math.max((to.y ?? 0) + PLAYER.stepHeight, y);

// Can a bot walk in a straight line from a to b (ending on b's floor)?
function clearLine(phys, a, b) {
  const steps = Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 0.25);
  let y = a.y;
  for (let i = 1; i <= steps; i++) {
    const k = i / steps;
    const ny = landing(phys, y, a.x + (b.x - a.x) * k, a.z + (b.z - a.z) * k, climbCap(y, b));
    if (ny === null) return false;
    y = ny;
  }
  return Math.abs(y - (b.y ?? 0)) < 1;
}

// Is the straight line between two points free of map geometry?
export function canSee(from, to, map = MAP) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dz = to.z - from.z;
  const dist = Math.hypot(dx, dy, dz);
  if (dist < 1e-6) return true;
  return mapPhysics(map).raycast(from, { x: dx / dist, y: dy / dist, z: dz / dist }, dist) >= dist;
}

// Moves the bot up to `dist` toward (dx, dz), sliding along walls, stepping up (to at most cap) and dropping down
// with the floor. Returns how far it actually went.
function step(phys, bot, dx, dz, dist, cap) {
  const len = Math.hypot(dx, dz);
  if (len < 1e-6 || dist <= 0) return 0;
  const mx = (dx / len) * dist;
  const mz = (dz / len) * dist;
  for (const [sx, sz, moved] of [[mx, mz, dist], [mx, 0, Math.abs(mx)], [0, mz, Math.abs(mz)]]) {
    if (!sx && !sz) continue;
    const y = landing(phys, bot.y, bot.x + sx, bot.z + sz, cap);
    if (y === null) continue;
    bot.x += sx; bot.z += sz; bot.y = y;
    return moved;
  }
  return 0;
}

// Walks the bot along a (periodically refreshed) grid path toward goal. Returns the heading it moved in.
function walkToward(room, bot, ai, goal, now, dt) {
  const nav = navFor(room.map);
  // Wedged somewhere (on a ledge, against a corner) for a while: walk a random way for a moment, then replan.
  if (now < (ai.unstickUntil ?? 0)) {
    step(nav.phys, bot, Math.cos(ai.unstickDir), Math.sin(ai.unstickDir), SPEED * dt);
    return Math.atan2(-Math.cos(ai.unstickDir), -Math.sin(ai.unstickDir));
  }
  if (!ai.path || now >= ai.repathAt) {
    ai.path = findPath(nav, bot, goal);
    ai.wp = 0;
    ai.repathAt = now + REPATH_MS;
  }
  const path = ai.path;
  const last = Math.min(path.length - 1, ai.wp + LOOKAHEAD);
  for (let i = last; i > ai.wp; i--) {
    if (clearLine(nav.phys, bot, path[i])) { ai.wp = i; break; }
  }
  // Past the end of the path, close in on the goal itself when there's a straight line to it.
  let to = path[ai.wp];
  if (ai.wp === path.length - 1 && clearLine(nav.phys, bot, goal)) to = goal;
  const dx = to.x - bot.x;
  const dz = to.z - bot.z;
  const want = Math.min(SPEED * dt, Math.hypot(dx, dz));
  const moved = step(nav.phys, bot, dx, dz, want, climbCap(bot.y, to));
  if (want > 0.01 && moved < want * 0.2) { // stuck: replan soon, and break free if that doesn't help
    ai.repathAt = Math.min(ai.repathAt, now + 250);
    ai.stuckSince ??= now;
    if (now - ai.stuckSince > STUCK_MS) {
      ai.unstickDir = Math.random() * Math.PI * 2;
      ai.unstickUntil = now + rand(400, 900);
      ai.stuckSince = null;
      ai.path = null;
    }
  } else if (want > 0.01) {
    ai.stuckSince = null;
  }
  return Math.hypot(dx, dz) > 0.01 ? Math.atan2(-dx, -dz) : null;
}

const facing = (bot) => ({
  x: -Math.sin(bot.ry) * Math.cos(bot.rx),
  y: Math.sin(bot.rx),
  z: -Math.cos(bot.ry) * Math.cos(bot.rx),
});

// One server tick of thinking, moving, aiming and shooting for a bot.
export function updateBot(room, bot, now, dt) {
  const ai = bot.ai;
  if (!bot.alive) { ai.path = null; ai.seenAt = null; return; }
  const weapon = getWeapon(bot.tier);
  const eye = { x: bot.x, y: bot.y + PLAYER.eyeHeight, z: bot.z };

  // Target: the nearest enemy in sight, else the nearest enemy anywhere (to hunt down).
  let target = null;
  let visible = false;
  let bestScore = Infinity;
  for (const p of room.players.values()) {
    if (p === bot || !p.alive || p.isDummy) continue;
    const d = Math.hypot(p.x - bot.x, p.z - bot.z);
    const seen = d <= SIGHT && canSee(eye, { x: p.x, y: p.y + CHEST, z: p.z }, room.map);
    const score = seen ? d : d + SIGHT * 10;
    if (score < bestScore) { bestScore = score; target = p; visible = seen; }
  }
  if (visible) {
    if (ai.seenAt === null || ai.seenId !== target.id) {
      ai.seenAt = now;
      ai.seenId = target.id;
      ai.reactMs = rand(...REACTION_MS);
    }
    ai.lastSeenAt = now;
  } else if (now - ai.lastSeenAt > TRACK_MS) {
    ai.seenAt = null; // lost track; spotting them again takes a fresh reaction
  }

  // Watchdog: a bot wedged somewhere its paths can't get it out of (an odd ledge) respawns rather than idle forever.
  if (visible || !ai.anchor || Math.hypot(bot.x - ai.anchor.x, bot.z - ai.anchor.z) > LOST_DIST) {
    ai.anchor = { x: bot.x, z: bot.z, t: now };
  } else if (now - ai.anchor.t > LOST_MS) {
    ai.anchor = null;
    ai.path = null;
    room.respawn(bot, now);
    return;
  }

  // Movement: close in until within a comfortable distance for this weapon, then strafe.
  let heading = null;
  if (target) {
    const dist = Math.hypot(target.x - bot.x, target.z - bot.z);
    const closeRange = weapon.magSize === 0 || weapon.range < 30; // knife, shotguns, flamethrower
    const keep = closeRange ? weapon.range * 0.5 : Math.min(weapon.range * 0.5, 18);
    if (!visible || dist > keep) {
      heading = walkToward(room, bot, ai, target, now, dt);
    } else {
      if (!(now < ai.strafeUntil)) { ai.strafeDir = Math.random() < 0.5 ? -1 : 1; ai.strafeUntil = now + rand(700, 1600); }
      const dx = target.x - bot.x;
      const dz = target.z - bot.z;
      if (!step(room.phys, bot, -dz * ai.strafeDir, dx * ai.strafeDir, SPEED * 0.6 * dt)) ai.strafeUntil = 0; // wall: turn around
      ai.path = null;
    }
  } else {
    if (!ai.wander || Math.hypot(ai.wander.x - bot.x, ai.wander.z - bot.z) < 1) {
      ai.wander = room.map.spawnPoints[Math.floor(Math.random() * room.map.spawnPoints.length)];
      ai.path = null;
    }
    heading = walkToward(room, bot, ai, ai.wander, now, dt);
  }

  // Aim: turn toward the target's chest (or the way it's walking), never faster than TURN_RATE, with wobble.
  if (!(now < ai.wobbleAt)) {
    ai.wobbleAt = now + rand(250, 500);
    ai.wobbleYaw = rand(-AIM_WOBBLE, AIM_WOBBLE);
    ai.wobblePitch = rand(-AIM_WOBBLE, AIM_WOBBLE) * 0.6;
  }
  let wantYaw = heading ?? bot.ry;
  let wantPitch = 0;
  let aimPoint = null;
  if (visible) {
    aimPoint = { x: target.x, y: target.y + CHEST, z: target.z };
    const dx = aimPoint.x - eye.x;
    const dz = aimPoint.z - eye.z;
    wantYaw = Math.atan2(-dx, -dz);
    wantPitch = Math.atan2(aimPoint.y - eye.y, Math.hypot(dx, dz));
  }
  const maxTurn = TURN_RATE * dt;
  bot.ry += clamp(angleTo(bot.ry, wantYaw + ai.wobbleYaw), -maxTurn, maxTurn);
  bot.rx = clamp(bot.rx + clamp(wantPitch + ai.wobblePitch - bot.rx, -maxTurn, maxTurn), -Math.PI / 2, Math.PI / 2);

  // Shoot once reacted, in range, and the aim is on target.
  if (!aimPoint || now - ai.seenAt < ai.reactMs || now < (ai.nextShotAt ?? 0)) return;
  const dist = Math.hypot(aimPoint.x - eye.x, aimPoint.y - eye.y, aimPoint.z - eye.z);
  if (dist > weapon.range) return;
  const f = facing(bot);
  const err = Math.acos(clamp((f.x * (aimPoint.x - eye.x) + f.y * (aimPoint.y - eye.y) + f.z * (aimPoint.z - eye.z)) / dist, -1, 1));
  if (err > FIRE_CONE + Math.atan2(PLAYER.radius, dist)) return;
  // time is the shooter's view of the server clock; the server subtracts the interpolation delay, so no rewind.
  if (room.fireFrom(bot, { origin: eye, direction: f, time: now + INTERPOLATION_DELAY_MS }, now)) {
    ai.nextShotAt = now + (weapon.auto ? 0 : weapon.fireRate * rand(...SEMI_AUTO_DELAY));
  }
}
