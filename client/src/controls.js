import * as THREE from 'three';
import { PLAYER, mapColliders } from '../../shared/constants.js';

const MAX_DT = 0.05;
const MAX_PITCH = (89 * Math.PI) / 180;
const SENSITIVITY = 0.0022;
const ADS_MOVE_SCALE = 0.6; // walking speed while aiming down sights
// Ctrl crouches; C too, because Ctrl+W closes the tab on Windows/Linux and pages can't block it.
const CROUCH_KEYS = ['ControlLeft', 'ControlRight', 'KeyC'];
const EPS = 1e-4;

// Pointer lock, keyboard/mouse input and client-side movement prediction against the static map.
export function createControls(canvas, camera, { onLockChange, onScoreboard, onReload }) {
  const colliders = mapColliders();
  const pos = { x: 0, y: 0, z: 0 }; // feet
  const vel = { x: 0, y: 0, z: 0 };
  const keys = new Set();
  let yaw = 0;
  let pitch = 0;
  let grounded = true;
  let mouseDown = false;
  let pressed = false;
  let moving = false;
  let sprinting = false;
  let crouching = false;
  let eyeHeight = PLAYER.eyeHeight; // eases toward the crouched/standing eye height
  let aiming = false; // set by the game loop each frame (ADS needs weapon/reload state)
  let sensitivityScale = 1; // lowered while zoomed

  const rig = new THREE.Object3D(); // yaw
  const pitchObj = new THREE.Object3D();
  rig.rotation.order = 'YXZ';
  pitchObj.rotation.order = 'YXZ';
  rig.add(pitchObj);
  pitchObj.add(camera);

  const isLocked = () => document.pointerLockElement === canvas;
  const requestLock = () => {
    const p = canvas.requestPointerLock();
    if (p && p.catch) p.catch(() => {});
  };

  document.addEventListener('pointerlockchange', () => onLockChange(isLocked()));
  document.addEventListener('mousemove', (e) => {
    if (!isLocked()) return;
    const k = SENSITIVITY * sensitivityScale;
    yaw -= e.movementX * k;
    pitch = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, pitch - e.movementY * k));
  });
  canvas.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    if (!isLocked()) { requestLock(); return; }
    mouseDown = true;
    pressed = true;
  });
  window.addEventListener('mouseup', (e) => { if (e.button === 0) mouseDown = false; });
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Tab') { e.preventDefault(); onScoreboard(true); return; }
    if (e.code === 'Space' || (e.ctrlKey && isLocked())) e.preventDefault(); // blocks what it can (not Ctrl+W)
    if (e.code === 'KeyR' && !e.repeat && isLocked()) onReload();
    keys.add(e.code);
  });
  window.addEventListener('keyup', (e) => {
    if (e.code === 'Tab') { e.preventDefault(); onScoreboard(false); return; }
    keys.delete(e.code);
  });
  window.addEventListener('blur', () => { keys.clear(); mouseDown = false; onScoreboard(false); });

  const overlapsXZ = (b) =>
    pos.x - PLAYER.radius < b.max.x && pos.x + PLAYER.radius > b.min.x &&
    pos.z - PLAYER.radius < b.max.z && pos.z + PLAYER.radius > b.min.z;
  const overlapsY = (b) => pos.y < b.max.y - EPS && pos.y + PLAYER.height > b.min.y + EPS;

  function moveAxis(axis, delta) {
    if (delta === 0) return;
    pos[axis] += delta;
    for (const b of colliders) {
      if (!overlapsXZ(b) || !overlapsY(b)) continue;
      pos[axis] = delta > 0 ? b.min[axis] - PLAYER.radius - EPS : b.max[axis] + PLAYER.radius + EPS;
    }
  }

  function moveY(delta) {
    pos.y += delta;
    grounded = false;
    for (const b of colliders) {
      if (!overlapsXZ(b) || !overlapsY(b)) continue;
      if (delta <= 0) { pos.y = b.max.y; grounded = true; } else { pos.y = b.min.y - PLAYER.height - EPS; }
      vel.y = 0;
    }
    if (pos.y <= 0) { pos.y = 0; vel.y = 0; grounded = true; }
  }

  function update(rawDt, enabled) {
    const dt = Math.min(rawDt, MAX_DT);
    let f = 0;
    let r = 0;
    if (enabled) {
      f = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0);
      r = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
    }
    const len = Math.hypot(f, r) || 1;
    f /= len; r /= len;
    const sin = Math.sin(yaw);
    const cos = Math.cos(yaw);
    // Sprint: Shift while moving forward; firing or aiming drops you back to walking speed.
    crouching = enabled && CROUCH_KEYS.some((k) => keys.has(k));
    sprinting = enabled && f > 0 && !mouseDown && !aiming && !crouching && (keys.has('ShiftLeft') || keys.has('ShiftRight'));
    const speed = sprinting ? PLAYER.sprintSpeed
      : crouching ? PLAYER.crouchSpeed
      : PLAYER.moveSpeed * (aiming ? ADS_MOVE_SCALE : 1);
    eyeHeight += ((crouching ? PLAYER.crouchEyeHeight : PLAYER.eyeHeight) - eyeHeight) * Math.min(1, dt * 14);
    vel.x = (-sin * f + cos * r) * speed;
    vel.z = (-cos * f - sin * r) * speed;
    moving = enabled && (f !== 0 || r !== 0) && grounded;
    if (enabled && grounded && keys.has('Space')) { vel.y = PLAYER.jumpVelocity; grounded = false; }
    vel.y -= PLAYER.gravity * dt;

    moveAxis('x', vel.x * dt);
    moveAxis('z', vel.z * dt);
    moveY(vel.y * dt);
    syncRig();
  }

  function syncRig() {
    rig.position.set(pos.x, pos.y + eyeHeight, pos.z);
    rig.rotation.y = yaw;
    pitchObj.rotation.x = pitch;
  }

  function teleport(x, y, z) {
    pos.x = x; pos.y = y; pos.z = z;
    vel.x = vel.y = vel.z = 0;
    syncRig();
  }

  return {
    rig, pos, update, teleport, isLocked, requestLock,
    get yaw() { return yaw; },
    get pitch() { return pitch; },
    set yaw(v) { yaw = v; },
    set pitch(v) { pitch = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, v)); },
    get mouseDown() { return mouseDown; },
    get moving() { return moving; },
    get sprinting() { return sprinting; },
    get crouching() { return crouching; },
    get aimHeld() { return keys.has('KeyQ'); },
    set aiming(v) { aiming = v; },
    set sensitivityScale(v) { sensitivityScale = v; },
    consumePress() { const p = pressed; pressed = false; return p; },
    releaseFire() { mouseDown = false; pressed = false; },
  };
}
