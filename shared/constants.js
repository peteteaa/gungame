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

// fireRate = minimum ms between shots. damage = total damage per shot (split across pellets).
export const WEAPON_TIERS = [
  { tier: 1, name: 'Pistol', model: 'models/pistol.glb', fireRate: 400, damage: 35, range: 80, pellets: 1, spread: 0.0, auto: false, color: 0x555555 },
  { tier: 2, name: 'Shotgun', model: 'models/shotgun.glb', fireRate: 800, damage: 90, range: 25, pellets: 6, spread: 0.08, auto: false, color: 0x7a4a24 },
  { tier: 3, name: 'Assault Rifle', model: 'models/rifle.glb', fireRate: 100, damage: 25, range: 100, pellets: 1, spread: 0.01, auto: true, color: 0x3d4a2f },
  { tier: 4, name: 'Sniper', model: 'models/sniper.glb', fireRate: 1500, damage: 100, range: 200, pellets: 1, spread: 0.0, auto: false, color: 0x1f2a36 },
  { tier: 5, name: 'Combat Knife', model: 'models/knife.glb', fireRate: 300, damage: 100, range: 2.5, pellets: 1, spread: 0.0, auto: false, color: 0xb0b0b0 }, // Winning tier
];
export const FINAL_TIER = WEAPON_TIERS.length;
export const getWeapon = (tier) => WEAPON_TIERS[Math.min(Math.max(tier, 1), FINAL_TIER) - 1];

// Static map. Ground is y = 0. Each box is an axis-aligned solid: center (x, z), size (w, d), height h, sitting on the ground.
export const MAP = {
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
};

// Network event names (single source of truth for both sides).
export const EVENTS = {
  // client -> server
  JOIN_MATCH: 'joinMatch', // { username }
  PLAYER_MOVE: 'playerMove', // { x, y, z, ry, rx }
  FIRE_BULLET: 'fireBullet', // { origin: {x,y,z}, direction: {x,y,z}, time }  time = client's estimate of server clock
  PING: 'clientPing', // (clientTime, ack) -> ack(serverTime)
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
export function mapColliders() {
  const s = MAP.halfSize;
  const h = MAP.wallHeight;
  const t = 1; // wall thickness
  const boxes = MAP.boxes.map((b) => ({
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
