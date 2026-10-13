// Authoritative Gun Game simulation: rooms, movement validation, hit detection, tier progression.
import {
  EVENTS, MAX_PLAYERS_PER_ROOM, MAX_HEALTH, RESPAWN_DELAY_MS, MATCH_RESTART_DELAY_MS,
  INTERPOLATION_DELAY_MS, MAX_REWIND_MS, PLAYER, MAP, FINAL_TIER, getWeapon,
  rayAABB, mapColliders, playerAABB,
} from '../shared/constants.js';

const COLLIDERS = mapColliders();
const HISTORY_MS = 1000; // position history kept per player for lag compensation
const MOVE_TOLERANCE = 1.5; // multiplier on max speed to absorb network jitter
const MOVE_BURST = 1.5; // max horizontal distance that can be banked while idle / packets bunch up
const MAX_FALL_SPEED = 25; // units / second; generous bound on downward speed
const VERT_SLACK = 0.3; // flat tolerance on vertical checks
// Highest a jump can rise above the surface it left (v^2 / 2g), plus slack.
const MAX_CLIMB = (PLAYER.jumpVelocity ** 2) / (2 * PLAYER.gravity) + VERT_SLACK;
const SWEEP_STEP = 0.3; // spacing of collision samples along a move, so thin walls can't be skipped
const COLLIDE_INSET = 0.05; // shrink colliders slightly so the client's EPS pushes never count as overlap
const GROUND_EPS = 0.1;
const MAX_ORIGIN_DRIFT = 2.0; // how far a shot origin may be from the server's view of the shooter's eye
const FIRE_RATE_TOLERANCE = 0.85; // accept shots slightly early to absorb jitter
const MAX_Y = Math.max(...MAP.boxes.map((b) => b.h)) + 3;

const isNum = (n) => typeof n === 'number' && Number.isFinite(n);
const isVec = (v) => v && isNum(v.x) && isNum(v.y) && isNum(v.z);
const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
const lerp = (a, b, t) => a + (b - a) * t;

function normalize(v) {
  const len = Math.hypot(v.x, v.y, v.z);
  return len > 1e-6 ? { x: v.x / len, y: v.y / len, z: v.z / len } : null;
}

// Random direction inside a cone of half-angle ~spread radians around dir.
function applySpread(dir, spread) {
  if (spread <= 0) return dir;
  const up = Math.abs(dir.y) < 0.99 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 };
  // u = normalize(dir x up), w = dir x u
  const u = normalize({ x: dir.y * up.z - dir.z * up.y, y: dir.z * up.x - dir.x * up.z, z: dir.x * up.y - dir.y * up.x });
  const w = { x: dir.y * u.z - dir.z * u.y, y: dir.z * u.x - dir.x * u.z, z: dir.x * u.y - dir.y * u.x };
  const r = spread * Math.sqrt(Math.random());
  const a = Math.random() * Math.PI * 2;
  const du = Math.cos(a) * r;
  const dw = Math.sin(a) * r;
  return normalize({ x: dir.x + u.x * du + w.x * dw, y: dir.y + u.y * du + w.y * dw, z: dir.z + u.z * du + w.z * dw });
}

const overlapsXZ = (x, z, c, r) => x - r < c.max.x && x + r > c.min.x && z - r < c.max.z && z + r > c.min.z;

// Would a player standing at (x, y, z) be inside any solid?
function insideSolid(x, y, z) {
  const r = PLAYER.radius - COLLIDE_INSET;
  return COLLIDERS.some((c) => overlapsXZ(x, z, c, r)
    && y < c.max.y - COLLIDE_INSET && y + PLAYER.height > c.min.y + COLLIDE_INSET);
}

// Is the player standing on the ground or on top of a box?
function grounded(x, y, z) {
  if (y <= GROUND_EPS) return true;
  return COLLIDERS.some((c) => Math.abs(y - c.max.y) <= GROUND_EPS && overlapsXZ(x, z, c, PLAYER.radius));
}

function sanitizeUsername(name) {
  const clean = String(name ?? '').replace(/[^\w \-.]/g, '').trim().slice(0, 16);
  return clean || `Player${Math.floor(Math.random() * 1000)}`;
}

export class Room {
  constructor(id, io) {
    this.id = id;
    this.io = io;
    this.players = new Map(); // socketId -> player
    this.matchActive = true;
    this.restartTimer = null;
  }

  get size() { return this.players.size; }
  emit(event, payload) { this.io.to(this.id).emit(event, payload); }

  serialize(p) {
    return { id: p.id, username: p.username, x: p.x, y: p.y, z: p.z, ry: p.ry, rx: p.rx, tier: p.tier, health: p.health, alive: p.alive, kills: p.kills };
  }

  serializeAll() {
    const out = {};
    for (const p of this.players.values()) out[p.id] = this.serialize(p);
    return out;
  }

  // Spawn point farthest from all living players (falls back to random when the room is empty).
  pickSpawn(excludeId) {
    const living = [...this.players.values()].filter((p) => p.alive && p.id !== excludeId);
    if (!living.length) return MAP.spawnPoints[Math.floor(Math.random() * MAP.spawnPoints.length)];
    let best = MAP.spawnPoints[0];
    let bestDist = -1;
    for (const s of MAP.spawnPoints) {
      const d = Math.min(...living.map((p) => Math.hypot(p.x - s.x, p.z - s.z)));
      if (d > bestDist) { bestDist = d; best = s; }
    }
    return best;
  }

  placeAt(p, spawn, now) {
    Object.assign(p, { x: spawn.x, y: 0, z: spawn.z, ry: Math.atan2(spawn.x, spawn.z), rx: 0, lastMoveAt: now, moveBudget: MOVE_BURST, groundY: 0 });
    p.history = [{ t: now, x: p.x, y: p.y, z: p.z }];
  }

  addPlayer(socket, username, now = Date.now()) {
    const p = {
      id: socket.id, username: sanitizeUsername(username),
      x: 0, y: 0, z: 0, ry: 0, rx: 0,
      tier: 1, health: MAX_HEALTH, alive: true, kills: 0,
      lastFireAt: 0, lastMoveAt: now, moveBudget: MOVE_BURST, groundY: 0, history: [], respawnTimer: null,
    };
    this.placeAt(p, this.pickSpawn(p.id), now);
    this.players.set(p.id, p);
    socket.join(this.id);
    socket.emit(EVENTS.JOINED, { id: p.id, roomId: this.id, player: this.serialize(p), players: this.serializeAll(), serverTime: now });
    socket.to(this.id).emit(EVENTS.PLAYER_JOINED, { player: this.serialize(p) });
    return p;
  }

  removePlayer(socket) {
    const p = this.players.get(socket.id);
    if (!p) return;
    clearTimeout(p.respawnTimer);
    this.players.delete(socket.id);
    socket.leave(this.id);
    this.emit(EVENTS.PLAYER_LEFT, { id: socket.id });
  }

  destroy() {
    clearTimeout(this.restartTimer);
    for (const p of this.players.values()) clearTimeout(p.respawnTimer);
  }

  // Accept a client-predicted position if it is physically plausible; otherwise snap the client back.
  handleMove(socket, data, now = Date.now()) {
    const p = this.players.get(socket.id);
    if (!p || !p.alive || !data || !isNum(data.x) || !isNum(data.y) || !isNum(data.z)) return;
    if (isNum(data.ry)) p.ry = data.ry;
    if (isNum(data.rx)) p.rx = clamp(data.rx, -Math.PI / 2, Math.PI / 2);

    // Horizontal distance comes out of a budget that refills with elapsed time, so the allowance is
    // per second rather than per message (sending more moves doesn't buy more distance).
    const dt = clamp((now - p.lastMoveAt) / 1000, 0, 1);
    p.lastMoveAt = now;
    p.moveBudget = Math.min(p.moveBudget + PLAYER.moveSpeed * MOVE_TOLERANCE * dt, MOVE_BURST);

    const y = Math.max(0, data.y);
    const horiz = Math.hypot(data.x - p.x, data.z - p.z);
    const lim = MAP.halfSize - PLAYER.radius;
    const inBounds = Math.abs(data.x) <= lim + 0.05 && Math.abs(data.z) <= lim + 0.05 && data.y >= -0.05 && data.y <= MAX_Y;
    const fallOk = p.y - y <= MAX_FALL_SPEED * dt + VERT_SLACK;
    const climbOk = y <= p.groundY + MAX_CLIMB; // can't rise further above the last surface stood on than a jump allows

    if (!inBounds || horiz > p.moveBudget || !fallOk || !climbOk || this.sweepHitsSolid(p, data.x, y, data.z, horiz)) {
      socket.emit(EVENTS.POSITION_CORRECTION, { x: p.x, y: p.y, z: p.z });
      return;
    }
    p.moveBudget -= horiz;
    p.x = data.x; p.y = y; p.z = data.z;
    if (grounded(p.x, p.y, p.z)) p.groundY = p.y;
  }

  // Sample the straight path from the current position to the target for solid overlap.
  sweepHitsSolid(p, x, y, z, dist) {
    const steps = Math.max(1, Math.ceil(dist / SWEEP_STEP));
    for (let i = 1; i <= steps; i++) {
      const k = i / steps;
      if (insideSolid(lerp(p.x, x, k), lerp(p.y, y, k), lerp(p.z, z, k))) return true;
    }
    return false;
  }

  // Where was this player at server time t? Interpolates the tick history.
  positionAt(p, t) {
    const h = p.history;
    if (!h.length || t >= h[h.length - 1].t) return { x: p.x, y: p.y, z: p.z };
    if (t <= h[0].t) return h[0];
    for (let i = h.length - 1; i > 0; i--) {
      const a = h[i - 1];
      const b = h[i];
      if (t >= a.t) {
        const k = (t - a.t) / (b.t - a.t || 1);
        return { x: lerp(a.x, b.x, k), y: lerp(a.y, b.y, k), z: lerp(a.z, b.z, k) };
      }
    }
    return h[0];
  }

  handleFire(socket, data, now = Date.now()) {
    const shooter = this.players.get(socket.id);
    if (!shooter || !shooter.alive || !this.matchActive || !data || !isVec(data.origin) || !isVec(data.direction)) return;
    const weapon = getWeapon(shooter.tier);
    if (now - shooter.lastFireAt < weapon.fireRate * FIRE_RATE_TOLERANCE) return;

    const eye = { x: shooter.x, y: shooter.y + PLAYER.eyeHeight, z: shooter.z };
    const o = data.origin;
    if (Math.hypot(o.x - eye.x, o.y - eye.y, o.z - eye.z) > MAX_ORIGIN_DRIFT) return;
    const aim = normalize(data.direction);
    if (!aim) return;
    // Advance by a full interval (not to `now`) so early-arriving shots borrow from the next one;
    // the tolerance absorbs jitter without raising the sustained fire rate.
    shooter.lastFireAt = Math.max(now, shooter.lastFireAt + weapon.fireRate);

    // Lag compensation: rewind targets to what the shooter saw (their clock minus interpolation delay).
    const claimed = isNum(data.time) ? data.time - INTERPOLATION_DELAY_MS : now;
    const shotTime = clamp(claimed, now - MAX_REWIND_MS, now);
    const targets = [...this.players.values()]
      .filter((p) => p.alive && p.id !== shooter.id)
      .map((p) => ({ p, box: playerAABB(this.positionAt(p, shotTime)) }));

    const origin = { x: o.x, y: o.y, z: o.z };
    const damageByTarget = new Map();
    const ends = [];
    for (let i = 0; i < weapon.pellets; i++) {
      const dir = applySpread(aim, weapon.spread);
      let maxT = weapon.range;
      for (const c of COLLIDERS) {
        const t = rayAABB(origin, dir, c.min, c.max);
        if (t !== null && t < maxT) maxT = t;
      }
      if (dir.y < 0) maxT = Math.min(maxT, -origin.y / dir.y); // ground plane

      let hit = null;
      for (const tgt of targets) {
        const t = rayAABB(origin, dir, tgt.box.min, tgt.box.max);
        if (t !== null && t <= maxT) { maxT = t; hit = tgt.p; }
      }
      if (hit) damageByTarget.set(hit, (damageByTarget.get(hit) ?? 0) + weapon.damage / weapon.pellets);
      ends.push({ x: origin.x + dir.x * maxT, y: origin.y + dir.y * maxT, z: origin.z + dir.z * maxT });
    }

    this.emit(EVENTS.SHOT_FIRED, { id: shooter.id, tier: shooter.tier, origin, ends });
    for (const [target, dmg] of damageByTarget) this.applyDamage(shooter, target, Math.round(dmg), now, weapon);
  }

  applyDamage(attacker, target, damage, now, weapon = getWeapon(attacker.tier)) {
    if (!target.alive || !this.matchActive) return;
    target.health = Math.max(0, target.health - damage);
    this.emit(EVENTS.PLAYER_HIT, { targetId: target.id, attackerId: attacker.id, health: target.health, damage });
    if (target.health <= 0) this.handleKill(attacker, target, now, weapon);
  }

  // weapon = what actually landed the kill (a shotgun multi-kill upgrades the killer mid-blast).
  handleKill(killer, victim, now, weapon = getWeapon(killer.tier)) {
    victim.alive = false;
    victim.health = 0;
    killer.kills++;
    this.emit(EVENTS.PLAYER_KILLED, { victimId: victim.id, killerId: killer.id, weapon: weapon.name });

    if (killer.tier >= FINAL_TIER) {
      this.endMatch(killer);
      return;
    }
    killer.tier++;
    this.emit(EVENTS.TIER_UPGRADE, { id: killer.id, newTier: killer.tier });
    victim.respawnTimer = setTimeout(() => this.respawn(victim), RESPAWN_DELAY_MS);
  }

  respawn(p, now = Date.now()) {
    if (!this.players.has(p.id)) return;
    p.respawnTimer = null;
    p.health = MAX_HEALTH;
    p.alive = true;
    this.placeAt(p, this.pickSpawn(p.id), now);
    this.emit(EVENTS.PLAYER_RESPAWN, { id: p.id, x: p.x, y: p.y, z: p.z });
  }

  endMatch(winner) {
    this.matchActive = false;
    for (const p of this.players.values()) clearTimeout(p.respawnTimer);
    this.emit(EVENTS.MATCH_OVER, { winnerId: winner.id, username: winner.username, restartIn: MATCH_RESTART_DELAY_MS });
    this.restartTimer = setTimeout(() => this.restartMatch(), MATCH_RESTART_DELAY_MS);
  }

  restartMatch(now = Date.now()) {
    this.restartTimer = null;
    for (const p of this.players.values()) {
      // alive stays false until placed so unplaced players don't skew pickSpawn distances
      Object.assign(p, { tier: 1, health: MAX_HEALTH, alive: false, kills: 0, lastFireAt: 0, respawnTimer: null });
    }
    for (const p of this.players.values()) {
      this.placeAt(p, this.pickSpawn(p.id), now);
      p.alive = true;
    }
    this.matchActive = true;
    this.emit(EVENTS.MATCH_RESTART, { players: this.serializeAll() });
  }

  tick(now = Date.now()) {
    for (const p of this.players.values()) {
      p.history.push({ t: now, x: p.x, y: p.y, z: p.z });
      while (p.history.length > 1 && now - p.history[0].t > HISTORY_MS) p.history.shift();
    }
    this.emit(EVENTS.STATE_UPDATE, { players: this.serializeAll(), serverTime: now });
  }
}

export class GameServer {
  constructor(io) {
    this.io = io;
    this.rooms = new Map(); // roomId -> Room
    this.socketRoom = new Map(); // socketId -> Room
    this.nextRoomId = 1;
  }

  findOrCreateRoom() {
    for (const room of this.rooms.values()) if (room.size < MAX_PLAYERS_PER_ROOM) return room;
    const room = new Room(`room_${this.nextRoomId++}`, this.io);
    this.rooms.set(room.id, room);
    return room;
  }

  join(socket, username) {
    this.leave(socket); // re-joining moves the socket rather than duplicating it
    const room = this.findOrCreateRoom();
    room.addPlayer(socket, username);
    this.socketRoom.set(socket.id, room);
  }

  leave(socket) {
    const room = this.socketRoom.get(socket.id);
    if (!room) return;
    room.removePlayer(socket);
    this.socketRoom.delete(socket.id);
    if (room.size === 0) {
      room.destroy();
      this.rooms.delete(room.id);
    }
  }

  roomOf(socket) { return this.socketRoom.get(socket.id); }

  tick() {
    const now = Date.now();
    for (const room of this.rooms.values()) room.tick(now);
  }

  stats() {
    return { rooms: this.rooms.size, players: this.socketRoom.size };
  }
}
