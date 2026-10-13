// Shared game contract imported by both the server (Node) and the client (Vite).
// Keep this file dependency-free so it runs unchanged in both environments.

export const TICK_RATE = 30; // server simulation ticks per second
export const MAX_PLAYERS_PER_ROOM = 8;
export const MAX_HEALTH = 100;
export const RESPAWN_DELAY_MS = 2000;
export const MATCH_RESTART_DELAY_MS = 8000;

// Render remote players this far in the past so there are always two snapshots to lerp between.
export const INTERPOLATION_DELAY_MS = 100;
// Upper bound on how far back the server will rewind for lag compensation.
export const MAX_REWIND_MS = 300;

export const PLAYER = {
  radius: 0.4, // half-width of the player's square footprint (AABB)
  height: 1.8, // feet to top of head
  eyeHeight: 1.6, // feet to camera
  moveSpeed: 6, // units / second
  jumpVelocity: 7,
  gravity: 20,
};

// One kill = one tier up; a kill with the last weapon (the knife) wins the match.
// fireRate = minimum ms between shots. damage = total damage per shot (split across pellets).
// magSize = rounds per magazine (0 = melee, never reloads). reloadMs = time to refill the magazine.
// kind picks the procedural fallback model; viewLength = first-person length in meters; model = GLB under client/public.
const W = (name, kind, model, viewLength, color, stats) => ({ name, kind, model: `models/${model}.glb`, viewLength, color, ...stats });
export const WEAPON_TIERS = [
  W('Pistol', 'pistol', 'guns/pistol_1', 0.28, 0x555555, { fireRate: 400, damage: 35, range: 80, pellets: 1, spread: 0, auto: false, magSize: 8, reloadMs: 1200 }),
  W('Heavy Pistol', 'pistol', 'guns/pistol_6', 0.3, 0x4a4f57, { fireRate: 550, damage: 50, range: 70, pellets: 1, spread: 0.005, auto: false, magSize: 6, reloadMs: 1400 }),
  W('SMG', 'rifle', 'guns/smg_2', 0.5, 0x3b3f46, { fireRate: 80, damage: 18, range: 50, pellets: 1, spread: 0.03, auto: true, magSize: 25, reloadMs: 1500 }),
  W('Shotgun', 'shotgun', 'guns/shotgun_2', 0.6, 0x7a4a24, { fireRate: 800, damage: 90, range: 25, pellets: 6, spread: 0.08, auto: false, magSize: 4, reloadMs: 1800 }),
  W('Machine Pistol', 'rifle', 'guns/smg_5', 0.45, 0x2f3a2f, { fireRate: 60, damage: 14, range: 35, pellets: 1, spread: 0.045, auto: true, magSize: 20, reloadMs: 1300 }),
  W('Assault Rifle', 'rifle', 'guns/rifle_6', 0.6, 0x3d4a2f, { fireRate: 100, damage: 25, range: 100, pellets: 1, spread: 0.01, auto: true, magSize: 30, reloadMs: 1800 }),
  W('Auto Shotgun', 'shotgun', 'guns/shotgun_1', 0.6, 0x5a3a20, { fireRate: 350, damage: 72, range: 18, pellets: 6, spread: 0.1, auto: true, magSize: 8, reloadMs: 2200 }),
  W('Battle Rifle', 'rifle', 'guns/rifle_7', 0.65, 0x2e3440, { fireRate: 220, damage: 40, range: 120, pellets: 1, spread: 0.006, auto: false, magSize: 20, reloadMs: 2000 }),
  W('LMG', 'rifle', 'guns/rifle_4', 0.65, 0x333a2a, { fireRate: 90, damage: 22, range: 100, pellets: 1, spread: 0.025, auto: true, magSize: 60, reloadMs: 3200 }),
  W('Marksman Rifle', 'sniper', 'guns/sniper_1', 0.75, 0x283040, { fireRate: 450, damage: 60, range: 160, pellets: 1, spread: 0, auto: false, magSize: 10, reloadMs: 2200 }),
  W('Sniper', 'sniper', 'guns/sniper_2', 0.8, 0x1f2a36, { fireRate: 1500, damage: 100, range: 200, pellets: 1, spread: 0, auto: false, magSize: 5, reloadMs: 2200 }),
  W('Flamethrower', 'rifle', 'guns/flamethrower', 0.55, 0x8a3b12, { fireRate: 70, damage: 10, range: 9, pellets: 3, spread: 0.12, auto: true, magSize: 50, reloadMs: 2500 }),
  W('Combat Knife', 'knife', 'knife', 0.35, 0xb0b0b0, { fireRate: 300, damage: 100, range: 2.5, pellets: 1, spread: 0, auto: false, magSize: 0, reloadMs: 0 }), // winning tier
].map((w, i) => ({ tier: i + 1, ...w }));
export const FINAL_TIER = WEAPON_TIERS.length;
export const getWeapon = (tier) => WEAPON_TIERS[Math.min(Math.max(tier, 1), FINAL_TIER) - 1];

// ---- Maps ----
// Ground is y = 0. Each box is an axis-aligned solid sitting on the ground: center (x, z), size (w, d), height h.

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
  arena: {
    name: 'Arena',
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
};

// Ascent is the first map. A server process can be pinned to another layout with WEBGUN_MAP (tests only:
// browsers always build the default, so a real server must not set it).
export const MAP = MAPS[globalThis.process?.env?.WEBGUN_MAP] ?? MAPS.ascent;

// Network event names (single source of truth for both sides).
export const EVENTS = {
  // client -> server
  JOIN_MATCH: 'joinMatch', // { username }
  PLAYER_MOVE: 'playerMove', // { x, y, z, ry, rx }
  FIRE_BULLET: 'fireBullet', // { origin: {x,y,z}, direction: {x,y,z}, time }  time = client's estimate of server clock
  PING: 'clientPing', // (clientTime, ack) -> ack(serverTime)
  RELOAD: 'reload', // (no payload) start reloading the current weapon
  // server -> client
  JOINED: 'joined', // { id, roomId, player, players, serverTime }
  STATE_UPDATE: 'stateUpdate', // { players: { [id]: {id, username, x,y,z, ry, rx, tier, health, alive, kills} }, serverTime }
  TIER_UPGRADE: 'tierUpgrade', // { id, newTier }
  SHOT_FIRED: 'shotFired', // { id, tier, origin, ends: [{x,y,z}] }  for tracers
  PLAYER_HIT: 'playerHit', // { targetId, attackerId, health, damage }
  PLAYER_KILLED: 'playerKilled', // { victimId, killerId, weapon }
  PLAYER_RESPAWN: 'playerRespawn', // { id, x, y, z }
  POSITION_CORRECTION: 'positionCorrection', // { x, y, z }  server rejected a move; snap here
  PLAYER_JOINED: 'playerJoined', // { player }
  PLAYER_LEFT: 'playerLeft', // { id }
  MATCH_OVER: 'matchOver', // { winnerId, username, restartIn }
  MATCH_RESTART: 'matchRestart', // { players }
  AMMO: 'ammo', // { ammo, reloading, reloadMs }  sent only to the owner when their magazine state changes
};

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
    min: { x: b.x - b.w / 2, y: 0, z: b.z - b.d / 2 },
    max: { x: b.x + b.w / 2, y: b.h, z: b.z + b.d / 2 },
  }));
  boxes.push(
    { min: { x: -s - t, y: 0, z: -s - t }, max: { x: s + t, y: h, z: -s } },
    { min: { x: -s - t, y: 0, z: s }, max: { x: s + t, y: h, z: s + t } },
    { min: { x: -s - t, y: 0, z: -s }, max: { x: -s, y: h, z: s } },
    { min: { x: s, y: 0, z: -s }, max: { x: s + t, y: h, z: s } },
  );
  return boxes;
}

// Player hitbox: square footprint centered on (x, z), feet at y.
export function playerAABB(p) {
  return {
    min: { x: p.x - PLAYER.radius, y: p.y, z: p.z - PLAYER.radius },
    max: { x: p.x + PLAYER.radius, y: p.y + PLAYER.height, z: p.z + PLAYER.radius },
  };
}
