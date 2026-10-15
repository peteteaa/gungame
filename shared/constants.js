// Shared game contract imported by both the server (Node) and the client (Vite).
// Keep this file dependency-free so it runs unchanged in both environments (generated map data is plain JS).
import piazzaData from './maps/piazza.js';

export const TICK_RATE = 30; // server simulation ticks per second
export const MAX_PLAYERS_PER_ROOM = 8;
export const MAX_HEALTH = 100;
// Health comes back on its own after a while without taking damage.
export const HEALTH_REGEN = { delayMs: 4000, perSecond: 20 };
export const RESPAWN_DELAY_MS = 2000;
export const MATCH_RESTART_DELAY_MS = 8000;
// Kills this close together chain into a multi-kill (double, triple, ...). A streak counts kills without dying.
export const MULTI_KILL_WINDOW_MS = 4000;

// Render remote players this far in the past so there are always two snapshots to lerp between.
export const INTERPOLATION_DELAY_MS = 100;
// Upper bound on how far back the server will rewind for lag compensation.
export const MAX_REWIND_MS = 300;

export const PLAYER = {
  radius: 0.4, // half-width of the player's square footprint (AABB)
  height: 1.8, // feet to top of head
  eyeHeight: 1.6, // feet to camera
  headY: 1.5, // feet to the bottom of the head; hits from here up to `height` are headshots
  crouchHeight: 1.2, // hitbox height while crouched (Ctrl / C)
  crouchEyeHeight: 1.0,
  crouchHeadY: 0.9,
  crouchSpeed: 4, // claiming to crouch caps your speed here, so faking it for the smaller hitbox costs mobility
  moveSpeed: 8, // units / second
  sprintSpeed: 12, // holding Shift while moving forward (not while firing)
  jumpVelocity: 7,
  stepHeight: 0.55, // ledges up to this high are walked up (stairs, curbs) instead of blocking
  gravity: 20,
};

// One kill = one tier up; a kill with the last weapon (the knife) wins the match.
// fireRate = minimum ms between shots. damage = total damage per shot (split across pellets).
// magSize = rounds per magazine (0 = melee, never reloads). reloadMs = time to refill the magazine.
// headshot = damage multiplier for hits on the head (default HEADSHOT_MULTIPLIER).
// ads = zoom while aiming down sights with Q (only guns whose model has a scope or sight). burn = damage over time
// a hit leaves on the target, refreshed by each hit.
// effect: 'flame' draws fire particles instead of tracers. kind picks the procedural fallback model; viewLength = first-person length in meters; model = GLB under client/public.
const W = (name, kind, model, viewLength, color, stats) => ({ name, kind, model: `models/${model}.glb`, viewLength, color, ...stats });
export const WEAPON_TIERS = [
  W('Pistol', 'pistol', 'guns/pistol_1', 0.28, 0x555555, { fireRate: 400, damage: 35, range: 80, pellets: 1, spread: 0, auto: false, magSize: 8, reloadMs: 1200 }),
  W('Heavy Pistol', 'pistol', 'guns/pistol_6', 0.3, 0x4a4f57, { fireRate: 550, damage: 50, range: 70, pellets: 1, spread: 0.005, auto: false, magSize: 6, reloadMs: 1400 }),
  W('Auto Pistol', 'pistol', 'guns/pistol_2', 0.28, 0x50545c, { fireRate: 110, damage: 16, range: 45, pellets: 1, spread: 0.035, auto: true, magSize: 18, reloadMs: 1300 }),
  W('SMG', 'rifle', 'guns/smg_2', 0.5, 0x3b3f46, { fireRate: 80, damage: 18, range: 50, pellets: 1, spread: 0.03, auto: true, magSize: 25, reloadMs: 1500, ads: 1.4 }),
  W('Shotgun', 'shotgun', 'guns/shotgun_2', 0.6, 0x7a4a24, { fireRate: 800, damage: 90, range: 25, pellets: 6, spread: 0.08, auto: false, magSize: 4, reloadMs: 1800 }),
  W('Heavy SMG', 'rifle', 'guns/smg_3', 0.48, 0x353a33, { fireRate: 105, damage: 24, range: 60, pellets: 1, spread: 0.025, auto: true, magSize: 30, reloadMs: 1900 }),
  W('Machine Pistol', 'rifle', 'guns/smg_5', 0.45, 0x2f3a2f, { fireRate: 60, damage: 14, range: 35, pellets: 1, spread: 0.045, auto: true, magSize: 20, reloadMs: 1300, ads: 1.3 }),
  W('Carbine', 'rifle', 'guns/rifle_1', 0.55, 0x3a4036, { fireRate: 140, damage: 34, range: 110, pellets: 1, spread: 0.008, auto: false, magSize: 20, reloadMs: 1700, ads: 1.8 }),
  W('Assault Rifle', 'rifle', 'guns/rifle_6', 0.6, 0x3d4a2f, { fireRate: 100, damage: 25, range: 100, pellets: 1, spread: 0.01, auto: true, magSize: 30, reloadMs: 1800, ads: 1.6 }),
  W('Auto Shotgun', 'shotgun', 'guns/shotgun_1', 0.6, 0x5a3a20, { fireRate: 350, damage: 72, range: 18, pellets: 6, spread: 0.1, auto: true, magSize: 8, reloadMs: 2200 }),
  W('Long Rifle', 'sniper', 'guns/rifle_3', 0.72, 0x4a3a2a, { fireRate: 350, damage: 55, range: 150, pellets: 1, spread: 0.002, auto: false, magSize: 8, reloadMs: 2100 }),
  W('Battle Rifle', 'rifle', 'guns/rifle_7', 0.65, 0x2e3440, { fireRate: 220, damage: 40, range: 120, pellets: 1, spread: 0.006, auto: false, magSize: 20, reloadMs: 2000, ads: 2 }),
  W('LMG', 'rifle', 'guns/rifle_4', 0.65, 0x333a2a, { fireRate: 90, damage: 22, range: 100, pellets: 1, spread: 0.025, auto: true, magSize: 60, reloadMs: 3200, ads: 1.6 }),
  W('Tactical Rifle', 'rifle', 'guns/rifle_2', 0.58, 0x2c3238, { fireRate: 85, damage: 21, range: 100, pellets: 1, spread: 0.015, auto: true, magSize: 32, reloadMs: 2000, ads: 1.7 }),
  W('Marksman Rifle', 'sniper', 'guns/sniper_1', 0.75, 0x283040, { fireRate: 450, damage: 60, range: 160, pellets: 1, spread: 0, auto: false, magSize: 10, reloadMs: 2200, ads: 3.5 }),
  W('Anti-Materiel Rifle', 'sniper', 'guns/sniper_0', 0.85, 0x30352c, { fireRate: 2000, damage: 120, range: 250, pellets: 1, spread: 0, auto: false, magSize: 3, reloadMs: 3200, ads: 8 }),
  W('Sniper', 'sniper', 'guns/sniper_2', 0.8, 0x1f2a36, { fireRate: 1500, damage: 100, range: 200, pellets: 1, spread: 0, auto: false, magSize: 5, reloadMs: 2200, ads: 6 }),
  W('Hand Cannon', 'pistol', 'guns/pistol_5', 0.36, 0x3d3a36, { fireRate: 550, damage: 55, range: 90, pellets: 1, spread: 0.003, auto: false, magSize: 6, reloadMs: 1800, ads: 2 }),
  W('Flamethrower', 'rifle', 'guns/flamethrower', 0.55, 0x8a3b12, { fireRate: 70, damage: 10, range: 9, pellets: 3, spread: 0.12, auto: true, magSize: 50, reloadMs: 2500, effect: 'flame', headshot: 1, burn: { dps: 12, durationMs: 2500 }, ads: 1.25 }),
  W('Combat Knife', 'knife', 'knife', 0.35, 0xd4af37, { fireRate: 300, damage: 100, range: 2.5, pellets: 1, spread: 0, auto: false, magSize: 0, reloadMs: 0 }), // winning tier
].map((w, i) => ({ tier: i + 1, ...w }));
export const FINAL_TIER = WEAPON_TIERS.length;
export const HEADSHOT_MULTIPLIER = 2;
export const getWeapon = (tier) => WEAPON_TIERS[Math.min(Math.max(tier, 1), FINAL_TIER) - 1];

// ---- Maps ----
// Ground is y = 0. Each box is an axis-aligned solid: center (x, z), size (w, d), height h, sitting on the ground
// unless it has a base height y (overhangs, bridges). Spawn points may have a y for raised floors (default 0).

// Maps can be drawn as ASCII, one character per MAP_CELL x MAP_CELL square, north (-z) on the top row.
// Runs of the same solid tile merge into one box. Marker tiles are open ground.
const MAP_CELL = 2;
const TILES = {
  '#': { h: 6, color: 0xd8c49f }, // building
  G: { h: 2.6, color: 0x56616c }, // generator
  X: { h: 2.2, color: 0x8a6a45 }, // big crate (too tall to climb)
  x: { h: 1.0, color: 0xa47b4f }, // crate (climbable)
  a: { h: 0.6, color: 0xbf7a50 }, // steps up to a raised platform
  b: { h: 1.2, color: 0xb36a42 },
  c: { h: 1.8, color: 0xa85d38 },
};
const MARKERS = { D: 'spawn', A: 'spawn', s: 'spawn', T: 'dummy' }; // defender / attacker / extra spawns, test dummy

function parseMap({ rows, ...rest }) {
  const n = rows.length;
  const half = (n * MAP_CELL) / 2;
  const at = (c, r) => ({ x: -half + (c + 0.5) * MAP_CELL, z: -half + (r + 0.5) * MAP_CELL });
  const used = rows.map(() => Array(n).fill(false));
  const boxes = [];
  const spawnPoints = [];
  let dummySpot = null;
  for (let r = 0; r < n; r++) {
    if (rows[r].length !== n) throw new Error(`map row ${r} is ${rows[r].length} wide; rows must form a square`);
    for (let c = 0; c < n; c++) {
      const ch = rows[r][c];
      if (MARKERS[ch] === 'spawn') spawnPoints.push(at(c, r));
      else if (MARKERS[ch] === 'dummy') dummySpot = at(c, r);
      else if (ch !== '.' && !TILES[ch]) throw new Error(`unknown map tile '${ch}' at column ${c}, row ${r}`);
      if (!TILES[ch] || used[r][c]) continue;
      // Greedy merge: widen along the row, then grow down while the whole span still matches.
      const free = (rr, cc) => rows[rr][cc] === ch && !used[rr][cc];
      let c1 = c;
      while (c1 + 1 < n && free(r, c1 + 1)) c1++;
      let r1 = r;
      while (r1 + 1 < n && Array.from({ length: c1 - c + 1 }, (_, k) => c + k).every((cc) => free(r1 + 1, cc))) r1++;
      for (let rr = r; rr <= r1; rr++) for (let cc = c; cc <= c1; cc++) used[rr][cc] = true;
      const w = (c1 - c + 1) * MAP_CELL;
      const d = (r1 - r + 1) * MAP_CELL;
      boxes.push({ x: -half + c * MAP_CELL + w / 2, z: -half + r * MAP_CELL + d / 2, w, d, h: TILES[ch].h, color: TILES[ch].color });
    }
  }
  return { halfSize: half, boxes, spawnPoints, dummySpot, ...rest };
}

// Generated maps store boxes as flat [minX, minY, minZ, maxX, maxY, maxZ, ...] in `unit` meters.
function unpackBoxes({ unit: u, boxes: a }) {
  const out = [];
  for (let i = 0; i < a.length; i += 6) {
    const [x0, y0, z0, x1, y1, z1] = [a[i] * u, a[i + 1] * u, a[i + 2] * u, a[i + 3] * u, a[i + 4] * u, a[i + 5] * u];
    out.push({ x: (x0 + x1) / 2, z: (z0 + z1) / 2, w: x1 - x0, d: z1 - z0, y: y0, h: y1 - y0 });
  }
  return out;
}

export const MAPS = {
  // Inspired by Valorant's Ascent: attackers spawn south, defenders north. A site (west) has the generator,
  // Heaven (stepped platform) and A Main / Rafters entrances; B site (east) has the Boathouse, B Main and B Back.
  // The open Mid courtyard links to A via Catwalk, to B via Market, and to defender spawn via Mid Top.
  ascent: parseMap({
    name: 'Ascent',
    wallHeight: 6,
    theme: { sky: 0x9cc3e6, ground: ['#cdbd98', '#d6c7a4'], wall: 0xc4ad85, fog: [35, 120] },
    rows: [
    '########################################',
    '##############............##############',
    '#####............D....D............#####',
    '#####..s........x......x........s..#####',
    '#####..............D...............#####',
    '#####....aaaa#...............###########',
    '#........bbbb#####....####.............#',
    '#.s......cccc#####....####.x.........s.#',
    '#....XX..cccc#####....####.............#',
    '#x........bbb#####....####....XX...#####',
    '#..........aa#####......##....XX...#####',
    '#..GG....#...#####......##.........#####',
    '#..GG....#...#####....####..x..........#',
    '#.....XX.........#....####.......X.....#',
    '#.....XX.........#....####.......X.....#',
    '#.x..........#...#....####.............#',
    '#....#########................#####....#',
    '#....#########.s..............#####....#',
    '#....#########..x.............#####....#',
    '#....#########................#####....#',
    '#....#########.....XX.....#########....#',
    '#..x.#########.....XX.....#########....#',
    '#....#########............#########.x..#',
    '#....#########.........x..#########....#',
    '#....#########......T.....#########....#',
    '#....#########...x......s.#########....#',
    '#....#########............#########....#',
    '#....############......############....#',
    '#...........#####......#####...........#',
    '#...........#####......#####...........#',
    '#..s..XX....#####..x...#####....XX..s..#',
    '#.....XX....#####......#####....XX.....#',
    '#.........s.#####......#####.s.........#',
    '#...........#####......#####...........#',
    '########........................########',
    '########...........A............########',
    '########........x......x........########',
    '########.......A........A.......########',
    '#############..............#############',
    '########################################',
    ],
  }),

  // The original arena. Integration tests pin the server to it (WEBGUN_MAP=arena) so their positions stay valid.
  // Not offered on the start screen.
  arena: {
    name: 'Arena',
    listed: false,
    halfSize: 30, // playable area is [-30, 30] on x and z; perimeter walls sit just outside
    wallHeight: 4,
    boxes: [
      { x: 0, z: 0, w: 4, d: 4, h: 3 },
      { x: -12, z: -12, w: 6, d: 1, h: 2.5 },
      { x: 12, z: 12, w: 6, d: 1, h: 2.5 },
      { x: -12, z: 12, w: 1, d: 6, h: 2.5 },
      { x: 12, z: -12, w: 1, d: 6, h: 2.5 },
      { x: -20, z: 0, w: 2, d: 2, h: 1.2 },
      { x: 20, z: 0, w: 2, d: 2, h: 1.2 },
      { x: 0, z: -20, w: 2, d: 2, h: 1.2 },
      { x: 0, z: 20, w: 2, d: 2, h: 1.2 },
      { x: -6, z: 8, w: 1.5, d: 1.5, h: 1 },
      { x: 6, z: -8, w: 1.5, d: 1.5, h: 1 },
      { x: 22, z: 22, w: 3, d: 3, h: 4 },
      { x: -22, z: -22, w: 3, d: 3, h: 4 },
      { x: 22, z: -22, w: 3, d: 3, h: 2 },
      { x: -22, z: 22, w: 3, d: 3, h: 2 },
    ],
    spawnPoints: [
      { x: -26, z: -26 }, { x: 26, z: 26 }, { x: -26, z: 26 }, { x: 26, z: -26 },
      { x: 0, z: -27 }, { x: 0, z: 27 }, { x: -27, z: 0 }, { x: 27, z: 0 },
    ],
    dummySpot: { x: 0, z: 10 },
  },
  // Ascent at full size: its lanes, terrain (raised floors, stairs, ramps) and obstacles traced at 0.5 m into boxes
  // (shared/maps/piazza.js). Steps up to PLAYER.stepHeight are walked up. Defender spawn north, Attacker south.
  piazza: {
    name: 'Piazza',
    halfSize: 70,
    wallHeight: 20,
    boxes: unpackBoxes(piazzaData),
    spawnPoints: piazzaData.spawnPoints,
    dummySpot: piazzaData.spawnPoints[0],
    theme: {
      sky: 0x8ec5ef, ground: ['#b9b2a5', '#c6bfb1'], wall: 0xcbb89a, fog: [60, 190],
      // Colors for traced maps (see client/src/world.js): Venetian plaster facades, terracotta roofs, stone paving,
      // wooden balconies and bridges, and crates in wood and tarp colors.
      palette: {
        plaster: [0xf0d9b5, 0xe8a987, 0xf2d98a, 0xe3906d, 0xcfdcc4, 0xf3ece0, 0xbcd5df, 0xe7b9b0],
        roof: 0xb4552f,
        paving: [0xbdb5a6, 0xccc3b2],
        pavingSide: 0x968d7e,
        wall: 0xd9c7a8,
        wood: 0x8c5b34,
        crates: [0x9b6b3f, 0x3f8088, 0x6c7d45, 0xb0503a, 0x4d6a8f],
      },
    },
  },
};
for (const [id, map] of Object.entries(MAPS)) map.id = id;

// Maps offered on the start screen, in order.
export const MAP_LIST = Object.values(MAPS).filter((m) => m.listed !== false);
// The map a room gets when a join doesn't name a valid one. A server process can pin it with WEBGUN_MAP (tests use
// the arena so their positions stay valid).
export const DEFAULT_MAP_ID = MAPS[globalThis.process?.env?.WEBGUN_MAP] ? globalThis.process.env.WEBGUN_MAP : 'ascent';
export const MAP = MAPS[DEFAULT_MAP_ID];
export const getMap = (id) => MAPS[id] ?? MAP;

// Network event names (single source of truth for both sides).
export const EVENTS = {
  // client -> server
  JOIN_MATCH: 'joinMatch', // { username, map }  map = a MAPS id
  PLAYER_MOVE: 'playerMove', // { x, y, z, ry, rx, crouch }
  FIRE_BULLET: 'fireBullet', // { origin: {x,y,z}, direction: {x,y,z}, time }  time = client's estimate of server clock
  PING: 'clientPing', // (clientTime, ack) -> ack(serverTime)
  RELOAD: 'reload', // (no payload) start reloading the current weapon
  CHAT_SEND: 'chatSend', // { text }
  // server -> client
  JOINED: 'joined', // { id, roomId, map, player, players, serverTime, version }
  STATE_UPDATE: 'stateUpdate', // { players: { [id]: {id, username, x,y,z, ry, rx, tier, health, alive, kills, burning, crouch} }, serverTime }
  TIER_UPGRADE: 'tierUpgrade', // { id, newTier }
  SHOT_FIRED: 'shotFired', // { id, tier, origin, ends: [{x,y,z}] }  for tracers
  PLAYER_HIT: 'playerHit', // { targetId, attackerId, health, damage, headshot, burn }  burn = a damage-over-time tick
  PLAYER_KILLED: 'playerKilled', // { victimId, killerId, weapon, headshot }
  PLAYER_RESPAWN: 'playerRespawn', // { id, x, y, z }
  POSITION_CORRECTION: 'positionCorrection', // { x, y, z }  server rejected a move; snap here
  PLAYER_JOINED: 'playerJoined', // { player }
  PLAYER_LEFT: 'playerLeft', // { id }
  MATCH_OVER: 'matchOver', // { winnerId, username, restartIn }
  MATCH_RESTART: 'matchRestart', // { players }
  AMMO: 'ammo', // { ammo, reloading, reloadMs }  sent only to the owner when their magazine state changes
  CHAT_MESSAGE: 'chatMessage', // { id, username, text, bot }  to everyone in the room
};

// Room chat: messages are trimmed to maxLength; a player can send at most one per minIntervalMs.
export const CHAT = { maxLength: 120, minIntervalMs: 700 };

// Ray vs axis-aligned box (slab method). Returns distance t >= 0 along the (normalized) dir, or null.
export function rayAABB(origin, dir, min, max) {
  let tMin = 0;
  let tMax = Infinity;
  for (const axis of ['x', 'y', 'z']) {
    const o = origin[axis];
    const d = dir[axis];
    if (Math.abs(d) < 1e-9) {
      if (o < min[axis] || o > max[axis]) return null;
      continue;
    }
    let t1 = (min[axis] - o) / d;
    let t2 = (max[axis] - o) / d;
    if (t1 > t2) [t1, t2] = [t2, t1];
    tMin = Math.max(tMin, t1);
    tMax = Math.min(tMax, t2);
    if (tMin > tMax) return null;
  }
  return tMin;
}

// World-space AABBs for every static solid, including the four perimeter walls.
export function mapColliders(map = MAP) {
  const s = map.halfSize;
  const h = map.wallHeight;
  const t = 1; // wall thickness
  const boxes = map.boxes.map((b) => ({
    min: { x: b.x - b.w / 2, y: b.y ?? 0, z: b.z - b.d / 2 },
    max: { x: b.x + b.w / 2, y: (b.y ?? 0) + b.h, z: b.z + b.d / 2 },
  }));
  boxes.push(
    { min: { x: -s - t, y: 0, z: -s - t }, max: { x: s + t, y: h, z: -s } },
    { min: { x: -s - t, y: 0, z: s }, max: { x: s + t, y: h, z: s + t } },
    { min: { x: -s - t, y: 0, z: -s }, max: { x: -s, y: h, z: s } },
    { min: { x: s, y: 0, z: -s }, max: { x: s + t, y: h, z: s } },
  );
  return boxes;
}

// Player hitbox: square footprint centered on (x, z), feet at y; shorter while p.crouch.
export function playerAABB(p) {
  return {
    min: { x: p.x - PLAYER.radius, y: p.y, z: p.z - PLAYER.radius },
    max: { x: p.x + PLAYER.radius, y: p.y + (p.crouch ? PLAYER.crouchHeight : PLAYER.height), z: p.z + PLAYER.radius },
  };
}

// Fingerprint of everything client and server must agree on. The server sends it on join; a browser tab still
// running an older build (e.g. it auto-reconnected after a server restart) reloads instead of playing a stale map.
export const CONTRACT_VERSION = (() => {
  const text = JSON.stringify({ MAPS, WEAPON_TIERS, PLAYER, EVENTS, TICK_RATE });
  let h = 0x811c9dc5; // FNV-1a
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193) >>> 0;
  return h.toString(36);
})();
