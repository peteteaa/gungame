// AI players that fill out rooms with few humans. They stay on the ground and walk a grid path to the nearest
// enemy, shoot only at enemies they can actually see (after a reaction delay, with turn-rate-limited, wobbly
// aim), and fire through Room.fireFrom, so fire rate, ammo, reloads and hit detection are the same as a human's.
import { PLAYER, MAP, INTERPOLATION_DELAY_MS, getWeapon, rayAABB, mapColliders } from '../shared/constants.js';

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

const COLLIDERS = mapColliders();
const CELL = 1; // nav grid resolution in meters; map tiles are 2m, so every corridor has walkable cells
const N = Math.ceil((MAP.halfSize * 2) / CELL);
const NAV_CLEARANCE = PLAYER.radius + 0.05; // cell centers sit 0.5m from tile edges, so this keeps 2m corridors open
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

const rand = (lo, hi) => lo + Math.random() * (hi - lo);
const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
const angleTo = (a, b) => Math.atan2(Math.sin(b - a), Math.cos(b - a));

const overlapsAny = (x, z, r) => COLLIDERS.some((c) => x + r > c.min.x && x - r < c.max.x && z + r > c.min.z && z - r < c.max.z);
const solid = (x, z) => overlapsAny(x, z, PLAYER.radius); // every collider stands on the ground, so all of them block

const cellOf = (v) => clamp(Math.floor((v + MAP.halfSize) / CELL), 0, N - 1);
const cellCenter = (i) => -MAP.halfSize + (i + 0.5) * CELL;
const walkable = new Uint8Array(N * N);
for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) walkable[r * N + c] = overlapsAny(cellCenter(c), cellCenter(r), NAV_CLEARANCE) ? 0 : 1;
const NEIGHBORS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

// Breadth-first search over walkable cells (diagonals only where both sides are open, so corners aren't cut).
// Ends at the goal cell, or the reachable cell nearest it when the goal itself isn't walkable (e.g. atop a crate).
function findPath(fromX, fromZ, toX, toZ) {
  const start = cellOf(fromZ) * N + cellOf(fromX);
  const gc = cellOf(toX);
  const gr = cellOf(toZ);
  const parent = new Int32Array(N * N).fill(-1);
  parent[start] = start;
  const queue = [start];
  let best = start;
  let bestD = Infinity;
  for (let qi = 0; qi < queue.length; qi++) {
    const cur = queue[qi];
    const r = Math.floor(cur / N);
    const c = cur % N;
    const d = Math.hypot(c - gc, r - gr);
    if (d < bestD) { bestD = d; best = cur; if (d === 0) break; }
    for (const [dc, dr] of NEIGHBORS) {
      const nc = c + dc;
      const nr = r + dr;
      if (nc < 0 || nr < 0 || nc >= N || nr >= N) continue;
      const next = nr * N + nc;
      if (parent[next] !== -1 || !walkable[next]) continue;
      if (dc && dr && (!walkable[r * N + nc] || !walkable[nr * N + c])) continue;
      parent[next] = cur;
      queue.push(next);
    }
  }
  const path = [];
  for (let cur = best; ; cur = parent[cur]) {
    path.push({ x: cellCenter(cur % N), z: cellCenter(Math.floor(cur / N)) });
    if (cur === start) break;
  }
  return path.reverse();
}

// Can a bot walk in a straight line from a to b without touching a solid?
function clearLine(ax, az, bx, bz) {
  const steps = Math.ceil(Math.hypot(bx - ax, bz - az) / 0.25);
  for (let i = 1; i <= steps; i++) {
    const k = i / steps;
    if (solid(ax + (bx - ax) * k, az + (bz - az) * k)) return false;
  }
  return true;
}

// Is the straight line between two points free of map geometry?
export function canSee(from, to) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dz = to.z - from.z;
  const dist = Math.hypot(dx, dy, dz);
  if (dist < 1e-6) return true;
  const dir = { x: dx / dist, y: dy / dist, z: dz / dist };
  return !COLLIDERS.some((c) => {
    const t = rayAABB(from, dir, c.min, c.max);
    return t !== null && t < dist;
  });
}

// Moves the bot up to `dist` toward (dx, dz), sliding along walls. Returns how far it actually went.
function step(bot, dx, dz, dist) {
  const len = Math.hypot(dx, dz);
  if (len < 1e-6 || dist <= 0) return 0;
  const mx = (dx / len) * dist;
  const mz = (dz / len) * dist;
  if (!solid(bot.x + mx, bot.z + mz)) { bot.x += mx; bot.z += mz; return dist; }
  if (!solid(bot.x + mx, bot.z)) { bot.x += mx; return Math.abs(mx); }
  if (!solid(bot.x, bot.z + mz)) { bot.z += mz; return Math.abs(mz); }
  return 0;
}

// Walks the bot along a (periodically refreshed) grid path toward goal. Returns the heading it moved in.
function walkToward(bot, ai, goal, now, dt) {
  if (!ai.path || now >= ai.repathAt) {
    ai.path = findPath(bot.x, bot.z, goal.x, goal.z);
    ai.wp = 0;
    ai.repathAt = now + REPATH_MS;
  }
  const path = ai.path;
  const last = Math.min(path.length - 1, ai.wp + LOOKAHEAD);
  for (let i = last; i > ai.wp; i--) {
    if (clearLine(bot.x, bot.z, path[i].x, path[i].z)) { ai.wp = i; break; }
  }
  // Past the end of the path, close in on the goal itself when there's a straight line to it.
  let to = path[ai.wp];
  if (ai.wp === path.length - 1 && clearLine(bot.x, bot.z, goal.x, goal.z)) to = goal;
  const dx = to.x - bot.x;
  const dz = to.z - bot.z;
  const want = Math.min(SPEED * dt, Math.hypot(dx, dz));
  const moved = step(bot, dx, dz, want);
  if (want > 0.01 && moved < want * 0.2) ai.repathAt = now; // stuck: replan next tick
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
    const seen = d <= SIGHT && canSee(eye, { x: p.x, y: p.y + CHEST, z: p.z });
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

  // Movement: close in until within a comfortable distance for this weapon, then strafe.
  let heading = null;
  if (target) {
    const dist = Math.hypot(target.x - bot.x, target.z - bot.z);
    const closeRange = weapon.magSize === 0 || weapon.range < 30; // knife, shotguns, flamethrower
    const keep = closeRange ? weapon.range * 0.5 : Math.min(weapon.range * 0.5, 18);
    if (!visible || dist > keep) {
      heading = walkToward(bot, ai, target, now, dt);
    } else {
      if (!(now < ai.strafeUntil)) { ai.strafeDir = Math.random() < 0.5 ? -1 : 1; ai.strafeUntil = now + rand(700, 1600); }
      const dx = target.x - bot.x;
      const dz = target.z - bot.z;
      if (!step(bot, -dz * ai.strafeDir, dx * ai.strafeDir, SPEED * 0.6 * dt)) ai.strafeUntil = 0; // wall: turn around
      ai.path = null;
    }
  } else {
    if (!ai.wander || Math.hypot(ai.wander.x - bot.x, ai.wander.z - bot.z) < 1) {
      ai.wander = MAP.spawnPoints[Math.floor(Math.random() * MAP.spawnPoints.length)];
      ai.path = null;
    }
    heading = walkToward(bot, ai, ai.wander, now, dt);
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
