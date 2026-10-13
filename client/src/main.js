import * as THREE from 'three';
import { CONTRACT_VERSION, EVENTS, INTERPOLATION_DELAY_MS, FINAL_TIER, MAX_HEALTH, getWeapon } from '../../shared/constants.js';
import { createNetwork, lerpAngle } from './network.js';
import { createControls } from './controls.js';
import { buildWorld } from './world.js';
import { createEffects } from './effects.js';
import { createViewmodel, createRemotePlayer } from './weapons.js';
import { createHud } from './hud.js';

const MOVE_SEND_MS = 1000 / 30;

// ---- Renderer / scene ----
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.shadowMap.enabled = false;
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
document.getElementById('app').appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.05, 300);
buildWorld(scene);

window.addEventListener('resize', () => {
  renderer.setSize(window.innerWidth, window.innerHeight);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
});

// ---- Modules ----
const hud = createHud();
const net = createNetwork();
const effects = createEffects(scene);
const controls = createControls(renderer.domElement, camera, {
  onLockChange: (locked) => {
    if (!locked) controls.releaseFire();
    hud.setResume(joined && !locked);
  },
  onScoreboard: (on) => hud.setScoreboardVisible(on && joined),
  onReload: () => joined && startReload(),
});
scene.add(controls.rig);
const viewmodel = createViewmodel(camera, effects);

// ---- Game state ----
let joined = false;
let myId = null;
let username = '';
let me = null; // own state from the latest snapshot / join
let tier = 1;
let alive = true;
let lastFireAt = 0;
let ammo = getWeapon(1).magSize; // predicted locally; the server is authoritative and syncs via EVENTS.AMMO
let reloadEndsAt = 0; // performance.now() time the local reload finishes, 0 when not reloading
let lastMoveSent = 0;
let lastBoardAt = 0;
const remotes = new Map(); // id -> { mesh, setTier, setPitch, dispose }

const nameOf = (id) => (net.latest() && net.latest()[id] && net.latest()[id].username) || 'unknown';

function applyOwnState(state) {
  if (!state) return;
  me = state;
  tier = state.tier;
  alive = state.alive;
  hud.setHealth(state.health);
  hud.setWeapon(tier);
  hud.setDead(!alive);
}

const showAmmo = () => hud.setAmmo(ammo, getWeapon(tier).magSize, reloadEndsAt > 0);

function refillAmmo() {
  ammo = getWeapon(tier).magSize;
  reloadEndsAt = 0;
  viewmodel.cancelReload();
  showAmmo();
}

// Always tells the server, even for the automatic reload on empty, so its magazine can't drift from ours.
function startReload() {
  const weapon = getWeapon(tier);
  if (!alive || !weapon.magSize || reloadEndsAt || ammo >= weapon.magSize) return;
  beginLocalReload(weapon.reloadMs);
  net.emitReload();
}

function beginLocalReload(ms) {
  reloadEndsAt = performance.now() + ms;
  viewmodel.startReload(ms);
  showAmmo();
}

function resetRemotes() {
  for (const r of remotes.values()) { scene.remove(r.mesh); r.dispose(); }
  remotes.clear();
}

function removeRemote(id) {
  const r = remotes.get(id);
  if (!r) return;
  scene.remove(r.mesh);
  r.dispose();
  remotes.delete(id);
}

// ---- Network events ----
net.on('disconnect', () => hud.setDisconnected(true));
net.on('connect', () => hud.setDisconnected(false));

net.on(EVENTS.JOINED, (data) => {
  // The server runs a different build (map, weapons...): reload to fetch it, at most once per server version.
  if (data.version !== CONTRACT_VERSION) {
    if (sessionStorage.getItem('webgun-reloaded-for') !== data.version) {
      sessionStorage.setItem('webgun-reloaded-for', data.version);
      window.location.reload();
      return;
    }
    console.warn(`client build ${CONTRACT_VERSION} differs from server ${data.version}`);
  }
  myId = data.id;
  joined = true;
  net.syncClock(data.serverTime);
  net.clearSnapshots();
  net.pushSnapshot(data.serverTime, data.players);
  resetRemotes();
  const p = data.player;
  controls.teleport(p.x, p.y, p.z);
  controls.yaw = p.ry || 0;
  applyOwnState(p);
  refillAmmo();
  hud.enterGame();
  hud.hideBanner();
  hud.setResume(!controls.isLocked());
});

net.on(EVENTS.STATE_UPDATE, (data) => {
  applyOwnState(data.players[myId]);
});

net.on(EVENTS.POSITION_CORRECTION, (d) => controls.teleport(d.x, d.y, d.z));

net.on(EVENTS.PLAYER_RESPAWN, (d) => {
  if (d.id !== myId) return;
  controls.teleport(d.x, d.y, d.z);
  alive = true;
  refillAmmo();
  hud.setDead(false);
});

net.on(EVENTS.PLAYER_HIT, (d) => {
  if (d.targetId === myId) {
    hud.flashDamage();
    hud.setHealth(d.health);
  }
  if (d.attackerId === myId) effects.hitMarker();
});

net.on(EVENTS.PLAYER_KILLED, (d) => {
  const self = (id) => (id === myId ? 'self' : '');
  hud.feed([
    { text: nameOf(d.killerId), cls: `killer ${self(d.killerId)}` },
    { text: `[${d.weapon}]`, cls: 'weapon' },
    { text: nameOf(d.victimId), cls: `victim ${self(d.victimId)}` },
  ]);
  if (d.victimId === myId) { alive = false; hud.setDead(true); }
});

net.on(EVENTS.TIER_UPGRADE, (d) => {
  if (d.id !== myId) return;
  tier = d.newTier;
  hud.setWeapon(tier);
  refillAmmo();
  hud.toast(`UPGRADE: ${getWeapon(tier).name}`);
});

net.on(EVENTS.SHOT_FIRED, (d) => {
  if (d.tier === FINAL_TIER) return; // knife: no tracer
  const start = new THREE.Vector3();
  if (d.id === myId) viewmodel.muzzleWorld(start); else start.set(d.origin.x, d.origin.y, d.origin.z);
  const draw = getWeapon(d.tier).effect === 'flame' ? effects.flame : effects.tracer;
  for (const end of d.ends) draw(start, end);
});

net.on(EVENTS.MATCH_OVER, (d) => hud.showBanner(`${d.username} WINS`, d.restartIn));

net.on(EVENTS.MATCH_RESTART, (d) => {
  hud.hideBanner();
  const mine = d.players[myId];
  if (!mine) return;
  controls.teleport(mine.x, mine.y, mine.z);
  applyOwnState(mine);
  refillAmmo();
});

// Server-side magazine changes. Only act on disagreements: a reload the server started that we didn't,
// or a reload the server finished before our timer did. Otherwise local prediction is already ahead.
net.on(EVENTS.AMMO, (d) => {
  if (d.reloading && !reloadEndsAt) {
    ammo = d.ammo;
    beginLocalReload(d.reloadMs);
  } else if (!d.reloading && reloadEndsAt) {
    ammo = d.ammo;
    reloadEndsAt = 0;
    viewmodel.cancelReload();
    showAmmo();
  }
});

net.on(EVENTS.PLAYER_JOINED, (d) => hud.feed([{ text: `${d.player.username} joined`, cls: 'weapon' }]));
net.on(EVENTS.PLAYER_LEFT, (d) => {
  hud.feed([{ text: `${nameOf(d.id)} left`, cls: 'weapon' }]);
  removeRemote(d.id);
});

// ---- Join flow ----
function startGame(name) {
  username = name.trim().slice(0, 16) || 'Player';
  net.join(username);
  if (!joined) hud.enterGame();
  controls.requestLock();
}

const nameInput = document.getElementById('username');
document.getElementById('play').addEventListener('click', () => startGame(nameInput.value));
nameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') startGame(nameInput.value); });
document.getElementById('resume').addEventListener('click', () => controls.requestLock());

const autojoin = new URLSearchParams(window.location.search).get('autojoin');
if (autojoin) startGame(autojoin);

// ---- Firing ----
const tmpOrigin = new THREE.Vector3();
const tmpDir = new THREE.Vector3();

function tryFire(now) {
  const weapon = getWeapon(tier);
  if (now - lastFireAt < weapon.fireRate) return;
  if (weapon.magSize && (reloadEndsAt || ammo <= 0)) return;
  lastFireAt = now;
  camera.getWorldPosition(tmpOrigin);
  camera.getWorldDirection(tmpDir).normalize();
  net.emitFire(tmpOrigin, tmpDir);
  viewmodel.fire();
  if (weapon.magSize) {
    ammo--;
    if (ammo <= 0) startReload(); else showAmmo();
  }
}

// ---- Remote players ----
function updateRemotes() {
  const players = net.latest();
  if (!players) return;
  for (const id of remotes.keys()) if (!players[id]) removeRemote(id);
  const poses = net.sample(net.serverNow() - INTERPOLATION_DELAY_MS);
  for (const id of Object.keys(players)) {
    if (id === myId) continue;
    const state = players[id];
    let r = remotes.get(id);
    const pose = poses[id] || state;
    if (!r) {
      r = createRemotePlayer(state);
      r.mesh.position.set(pose.x, pose.y, pose.z);
      r.mesh.rotation.y = pose.ry;
      scene.add(r.mesh);
      remotes.set(id, r);
    } else if (pose.exact) {
      r.mesh.position.set(pose.x, pose.y, pose.z);
      r.mesh.rotation.y = pose.ry;
    } else {
      r.mesh.position.lerp(tmpDir.set(pose.x, pose.y, pose.z), 0.3);
      r.mesh.rotation.y = lerpAngle(r.mesh.rotation.y, pose.ry, 0.3);
    }
    r.setTier(state.tier);
    r.setPitch(pose.rx);
    r.mesh.visible = state.alive !== false;
  }
}

// ---- Loop ----
let last = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.max(0, (now - last) / 1000); // first rAF timestamp can precede `last`
  last = now;

  if (joined) {
    if (reloadEndsAt && now >= reloadEndsAt) refillAmmo();
    controls.update(dt, alive);
    if (alive) {
      viewmodel.setTier(tier);
      const wantFire = getWeapon(tier).auto ? controls.mouseDown : controls.consumePress();
      if (wantFire && controls.isLocked()) tryFire(performance.now());
      if (now - lastMoveSent >= MOVE_SEND_MS) {
        lastMoveSent = now;
        const p = controls.pos;
        net.emitMove({ x: p.x, y: p.y, z: p.z, ry: controls.yaw, rx: controls.pitch });
      }
    } else {
      controls.consumePress();
    }
    updateRemotes();
    if (now - lastBoardAt > 250 && net.latest()) {
      lastBoardAt = now;
      hud.setPing(net.pingMs);
      hud.renderScoreboard(net.latest(), myId);
    }
  }
  viewmodel.update(dt, controls.moving && alive);
  effects.update(dt);
  renderer.render(scene, camera);
}
requestAnimationFrame(frame);

window.__webgun = {
  getState: () => ({
    myId,
    position: { x: controls.pos.x, y: controls.pos.y, z: controls.pos.z },
    tier,
    health: me ? me.health : MAX_HEALTH,
    alive,
    remoteCount: remotes.size,
    connected: net.connected,
    pingMs: net.pingMs,
  }),
};
