import * as THREE from 'three';
import { EVENTS, INTERPOLATION_DELAY_MS, FINAL_TIER, MAX_HEALTH, getWeapon } from '../../shared/constants.js';
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
  hud.toast(`UPGRADE: ${getWeapon(tier).name}`);
});

net.on(EVENTS.SHOT_FIRED, (d) => {
  if (d.tier === FINAL_TIER) return; // knife: no tracer
  const start = new THREE.Vector3();
  if (d.id === myId) viewmodel.muzzleWorld(start); else start.set(d.origin.x, d.origin.y, d.origin.z);
  for (const end of d.ends) effects.tracer(start, end);
});

net.on(EVENTS.MATCH_OVER, (d) => hud.showBanner(`${d.username} WINS`, d.restartIn));

net.on(EVENTS.MATCH_RESTART, (d) => {
  hud.hideBanner();
  const mine = d.players[myId];
  if (!mine) return;
  controls.teleport(mine.x, mine.y, mine.z);
  applyOwnState(mine);
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
  lastFireAt = now;
  camera.getWorldPosition(tmpOrigin);
  camera.getWorldDirection(tmpDir).normalize();
  net.emitFire(tmpOrigin, tmpDir);
  viewmodel.fire();
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
