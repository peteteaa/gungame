import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { PLAYER, WEAPON_TIERS, getWeapon, FINAL_TIER } from '../../shared/constants.js';

const DARK = 0x22252c;
const mat = (color) => new THREE.MeshLambertMaterial({ color, flatShading: true });
// Polished metal for the gold knife: specular highlights plus a little glow so it reads even in shadow.
const metal = (color) => new THREE.MeshPhongMaterial({
  color, specular: 0xfff1b8, shininess: 90, emissive: new THREE.Color(color).multiplyScalar(0.18), flatShading: true,
});

function box(group, w, h, l, x, y, z, color, rx = 0) { // color may also be a Material
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, l), color.isMaterial ? color : mat(color));
  m.position.set(x, y, z);
  m.rotation.x = rx;
  group.add(m);
  return m;
}

function barrel(group, radius, length, z, y, color) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, length, 8), mat(color));
  m.rotation.x = Math.PI / 2;
  m.position.set(0, y, z);
  group.add(m);
  return m;
}

const SKIN = 0xe0b890;
const SLEEVE = 0x2b3445;
const Z_AXIS = new THREE.Vector3(0, 0, 1);

// Box of the given thickness stretched between two points (in the group's space).
function limb(group, from, to, thick, color) {
  const dir = new THREE.Vector3().subVectors(to, from);
  const m = new THREE.Mesh(new THREE.BoxGeometry(thick, thick, dir.length()), color.isMaterial ? color : mat(color));
  m.position.copy(from).add(to).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(Z_AXIS, dir.normalize());
  group.add(m);
  return m;
}

// Where the hands go on a weapon, in its mount space (origin = trigger hand, barrel down -Z).
// Returns { grip, support } with support null for one-handed weapons.
function handPoints(weapon) {
  const v = (x, y, z) => new THREE.Vector3(x, y, z);
  if (weapon.kind === 'knife') return { grip: v(0, 0, 0.05), support: null };
  if (weapon.kind === 'pistol') return { grip: v(0, -0.06, 0.01), support: v(-0.03, -0.08, 0.03) };
  return { grip: v(0, -0.06, 0.01), support: v(0, -0.05, -weapon.viewLength * 0.38) };
}

// First-person hands and sleeves holding the weapon; forearms run off the bottom of the screen.
function buildHands(weapon) {
  const g = new THREE.Group();
  const v = (x, y, z) => new THREE.Vector3(x, y, z);
  const { grip, support } = handPoints(weapon);
  box(g, 0.05, 0.07, 0.09, grip.x, grip.y, grip.z, SKIN);
  limb(g, v(grip.x + 0.01, grip.y - 0.02, grip.z + 0.05), v(0.12, -0.32, 0.45), 0.07, SLEEVE);
  if (support) {
    box(g, 0.05, 0.06, 0.09, support.x, support.y, support.z, SKIN);
    limb(g, v(support.x - 0.01, support.y - 0.02, support.z + 0.05), v(-0.3, -0.34, 0.42), 0.07, SLEEVE);
  }
  return g;
}

// Procedural low-poly gun pointing down -Z. userData.muzzle marks the barrel tip.
function buildProceduralGun(weapon) {
  const g = new THREE.Group();
  const c = weapon.color;
  let muzzleZ = -0.3;
  switch (weapon.kind) {
    case 'pistol':
      box(g, 0.05, 0.06, 0.24, 0, 0, -0.1, c);
      box(g, 0.045, 0.12, 0.06, 0, -0.08, 0.0, DARK, 0.2);
      muzzleZ = -0.23;
      break;
    case 'shotgun':
      barrel(g, 0.025, 0.6, -0.3, 0, c);
      barrel(g, 0.02, 0.45, -0.25, -0.045, DARK);
      box(g, 0.06, 0.05, 0.14, 0, -0.045, -0.25, c); // pump
      box(g, 0.06, 0.1, 0.3, 0, -0.03, 0.15, c);
      muzzleZ = -0.6;
      break;
    case 'rifle':
      box(g, 0.06, 0.08, 0.45, 0, 0, -0.1, c);
      barrel(g, 0.015, 0.3, -0.45, 0.01, DARK);
      box(g, 0.04, 0.14, 0.06, 0, -0.1, -0.05, DARK, 0.2); // magazine
      box(g, 0.05, 0.09, 0.2, 0, -0.01, 0.2, c);
      muzzleZ = -0.6;
      break;
    case 'sniper':
      box(g, 0.05, 0.07, 0.5, 0, 0, 0, c);
      barrel(g, 0.015, 0.6, -0.5, 0.01, DARK);
      barrel(g, 0.03, 0.22, -0.05, 0.08, DARK); // scope
      box(g, 0.05, 0.09, 0.25, 0, -0.01, 0.35, c);
      muzzleZ = -0.8;
      break;
    default: { // gold knife
      const gold = metal(c);
      box(g, 0.035, 0.035, 0.14, 0, 0, 0.05, DARK); // handle
      box(g, 0.04, 0.04, 0.02, 0, 0, 0.13, gold); // pommel
      box(g, 0.075, 0.016, 0.022, 0, 0.005, -0.03, gold); // guard
      box(g, 0.012, 0.05, 0.28, 0, 0.01, -0.18, gold); // blade
      box(g, 0.006, 0.03, 0.06, 0, 0.022, -0.34, gold, 0.6); // tip
      muzzleZ = -0.3;
      break;
    }
  }
  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 0.01, muzzleZ);
  g.add(muzzle);
  g.userData.muzzle = muzzle;
  return g;
}

// GLB models are optional: cache the attempt per URL; failures resolve to null.
const loader = new GLTFLoader();
const modelCache = new Map();
// Fetch and parse every weapon model up front; resolves to one fitted model (or null) for shader warm-up.
export function preloadModels() {
  return Promise.all(WEAPON_TIERS.map(loadModel))
    .then((scenes) => {
      const i = scenes.findIndex(Boolean);
      return i < 0 ? null : fitModel(scenes[i], WEAPON_TIERS[i]);
    });
}

function loadModel(weapon) {
  if (!modelCache.has(weapon.model)) {
    modelCache.set(weapon.model, loader.loadAsync(`/${weapon.model}`).then((gltf) => {
      // Low-poly packs color via a tiny palette texture; smooth filtering blends neighboring swatches into stripes.
      gltf.scene.traverse((o) => {
        const map = o.material?.map;
        if (!map) return;
        map.magFilter = map.minFilter = THREE.NearestFilter;
        map.generateMipmaps = false;
        map.needsUpdate = true;
      });
      return gltf.scene;
    }).catch(() => null));
  }
  return modelCache.get(weapon.model);
}

// Fit a loaded model (barrel down -Z) to the weapon's viewLength so every model reads at a consistent size,
// with its rear quarter behind the origin, where the hand is.
// The muzzle comes from the model's "muzzle" node when present, else the center of its front face.
function fitModel(scene, weapon) {
  const length = weapon.viewLength;
  const root = new THREE.Group();
  const model = scene.clone(true); // shares geometry/materials with the cached scene
  model.traverse((o) => { if (o.isMesh) o.userData.shared = true; });
  const size = new THREE.Box3().setFromObject(model).getSize(new THREE.Vector3());
  model.scale.multiplyScalar(length / (size.z || 1));
  const box = new THREE.Box3().setFromObject(model);
  const center = box.getCenter(new THREE.Vector3());
  model.position.set(-center.x, -center.y, length * 0.25 - box.max.z);
  root.add(model);
  root.updateMatrixWorld(true);
  const muzzle = new THREE.Object3D(); // unscaled, so the muzzle flash keeps its size
  const marker = model.getObjectByName('muzzle');
  if (marker) marker.getWorldPosition(muzzle.position);
  else muzzle.position.set(0, 0, length * 0.25 - (box.max.z - box.min.z));
  root.add(muzzle);
  root.userData.muzzle = muzzle;
  return root;
}

const SWAP_MS = 120;
const ADS_POS = new THREE.Vector3(0, -0.13, -0.34); // gun centered under the crosshair while aiming

// First-person weapon attached to the camera, with bob, recoil, stab and swap animations.
export function createViewmodel(camera, effects) {
  const holder = new THREE.Group();
  const base = new THREE.Vector3(0.26, -0.24, -0.45);
  holder.position.copy(base);
  camera.add(holder);
  const flash = effects.createMuzzleFlash();
  let current = null;
  let tier = 0;
  let pendingTier = 0;
  let swap = null; // { t, swapped }
  let kick = 0;
  let stab = 0;
  let reload = null; // { t, ms }
  let bobT = 0;
  let sprintK = 0; // 0 = aiming, 1 = gun lowered for sprinting

  function mount(group, weapon) {
    if (current) holder.remove(current);
    current = group;
    group.add(buildHands(weapon));
    holder.add(group);
    group.userData.muzzle.add(flash.mesh);
  }

  function showTier(t) {
    tier = t;
    const weapon = getWeapon(t);
    mount(buildProceduralGun(weapon), weapon);
    loadModel(weapon).then((scene) => {
      if (scene && tier === t) mount(fitModel(scene, weapon), weapon);
    });
  }

  function setTier(t) {
    if (t === tier || t === pendingTier) return;
    pendingTier = t;
    if (!tier) { showTier(t); return; } // first spawn: no animation
    swap = { t: 0, swapped: false };
  }

  function fire() {
    flash.trigger();
    if (tier === FINAL_TIER) stab = 1; else kick = 1;
  }

  function startReload(ms) { reload = { t: 0, ms }; }
  function cancelReload() { reload = null; }

  // adsK: 0 = hip, 1 = aiming down sights (gun pulled to center). hidden: a full scope overlay is up.
  function update(dt, moving, sprinting = false, adsK = 0, hidden = false) {
    kick = Math.max(0, kick - dt * 8);
    stab = Math.max(0, stab - dt * 4);
    bobT += dt * (moving ? (sprinting ? 13 : 9) : 0);
    sprintK += ((sprinting ? 1 : 0) - sprintK) * Math.min(1, dt * 10); // eases the gun down/up
    let drop = 0;
    if (swap) {
      swap.t += dt * 1000;
      if (!swap.swapped && swap.t >= SWAP_MS) { showTier(pendingTier); swap.swapped = true; }
      const k = swap.t < SWAP_MS ? swap.t / SWAP_MS : Math.max(0, 2 - swap.t / SWAP_MS);
      drop = k * 0.35;
      if (swap.t >= SWAP_MS * 2) swap = null;
    }
    let tilt = 0;
    if (reload) {
      reload.t += dt * 1000;
      const k = Math.sin(Math.min(1, reload.t / reload.ms) * Math.PI); // dip down and tilt, then back up
      drop = Math.max(drop, k * 0.18);
      tilt = k * 0.6;
      if (reload.t >= reload.ms) reload = null;
    }
    const bobAmt = moving ? 1 : 0;
    const stabK = Math.sin(stab * Math.PI);
    const bobScale = (1 + sprintK * 1.5) * (1 - adsK * 0.85);
    const hip = 1 - adsK;
    holder.position.set(
      (base.x + Math.cos(bobT) * 0.012 * bobAmt * bobScale - stabK * 0.1 - sprintK * 0.06) * hip + ADS_POS.x * adsK,
      (base.y - sprintK * 0.07) * hip + ADS_POS.y * adsK + Math.abs(Math.sin(bobT)) * 0.014 * bobAmt * bobScale - drop,
      (base.z - stabK * 0.25) * hip + ADS_POS.z * adsK + kick * 0.06 * (1 - adsK * 0.6),
    );
    holder.rotation.x = kick * 0.12 * (1 - adsK * 0.7) + stabK * 0.5 - sprintK * 0.25;
    holder.rotation.z = (tilt + sprintK * 0.3) * hip;
    holder.rotation.y = (stabK * 0.4 + sprintK * 0.6) * hip;
    holder.visible = !hidden;
  }

  function muzzleWorld(target) {
    return current.userData.muzzle.getWorldPosition(target);
  }

  return { setTier, fire, startReload, cancelReload, update, muzzleWorld, get tier() { return tier; } };
}

// ---- Remote players ----

// ---- Faces ----
// Each player gets a 16x16 pixel-art face, seeded from their id so it's stable for the whole match.
const SKIN_TONES = ['#ffdbac', '#f1c27d', '#e0ac69', '#c68642', '#a1665e', '#8d5524'];
const HAIR_COLORS = ['#1c1410', '#3b2414', '#6a4423', '#b5834a', '#e2c178', '#a33a1f', '#d9d9d9', '#2f5fd0'];
const EYE_COLORS = ['#3b2a1a', '#1f6fb5', '#2f7d3a', '#6b6b6b', '#5a3a1a'];
const HURT_MS = 350;

function rng(seed) { // mulberry32
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = (rand, list) => list[Math.floor(rand() * list.length)];

// Builds the look, plus 'normal' and 'hurt' face textures that share it.
function makeFace(id) {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  const rand = rng(h);
  const look = {
    skin: pick(rand, SKIN_TONES), hair: pick(rand, HAIR_COLORS), eyes: pick(rand, EYE_COLORS),
    brows: pick(rand, ['flat', 'angry', 'raised']), mouth: pick(rand, ['smile', 'flat', 'smirk', 'grin', 'o']),
    freckles: rand() < 0.2, beard: rand() < 0.2, shades: rand() < 0.12,
  };

  function draw(hurt) {
    const c = document.createElement('canvas');
    c.width = c.height = 16;
    const g = c.getContext('2d');
    const px = (x, y, w = 1, hh = 1, color) => { g.fillStyle = color; g.fillRect(x, y, w, hh); };
    px(0, 0, 16, 16, look.skin);
    px(0, 0, 16, 2, look.hair); // fringe
    const dark = '#1a1a1a';
    // Brows
    if (look.brows === 'flat') { px(3, 4, 3, 1, look.hair); px(10, 4, 3, 1, look.hair); }
    if (look.brows === 'angry') { px(3, 3, 1, 1, look.hair); px(4, 4, 2, 1, look.hair); px(12, 3, 1, 1, look.hair); px(10, 4, 2, 1, look.hair); }
    if (look.brows === 'raised') { px(3, 3, 3, 1, look.hair); px(10, 3, 3, 1, look.hair); }
    // Eyes
    if (hurt) { // squeezed shut: > <
      px(3, 6, 1, 1, dark); px(4, 7, 1, 1, dark); px(3, 8, 1, 1, dark);
      px(12, 6, 1, 1, dark); px(11, 7, 1, 1, dark); px(12, 8, 1, 1, dark);
    } else if (look.shades) {
      px(2, 6, 12, 2, dark); px(3, 6, 1, 1, '#555'); px(10, 6, 1, 1, '#555');
    } else {
      px(3, 6, 3, 2, '#fff'); px(10, 6, 3, 2, '#fff');
      px(4, 6, 2, 2, look.eyes); px(11, 6, 2, 2, look.eyes);
      px(5, 6, 1, 1, dark); px(12, 6, 1, 1, dark);
    }
    if (look.freckles) for (const [x, y] of [[3, 9], [5, 10], [11, 9], [13, 10]]) px(x, y, 1, 1, '#b07a4f');
    // Mouth
    const lip = '#5a2a22';
    if (hurt) { px(6, 11, 4, 3, lip); px(7, 12, 2, 1, '#2a0f0c'); } // grimace
    else if (look.mouth === 'smile') { px(5, 11, 1, 1, lip); px(6, 12, 4, 1, lip); px(10, 11, 1, 1, lip); }
    else if (look.mouth === 'flat') px(6, 12, 4, 1, lip);
    else if (look.mouth === 'smirk') { px(6, 12, 3, 1, lip); px(9, 11, 2, 1, lip); }
    else if (look.mouth === 'grin') { px(5, 11, 6, 2, lip); px(6, 11, 4, 1, '#fff'); }
    else { px(7, 11, 2, 2, lip); } // o
    if (look.beard) { px(2, 12, 12, 4, look.hair); px(5, 12, 6, 1, look.skin); px(6, 12, 4, 1, hurt ? lip : look.skin); }
    const tex = new THREE.CanvasTexture(c);
    tex.magFilter = tex.minFilter = THREE.NearestFilter;
    tex.generateMipmaps = false;
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }
  return { look, normal: draw(false), hurt: draw(true) };
}

function hashColor(id) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return new THREE.Color().setHSL((h % 360) / 360, 0.6, 0.5);
}

function labelSprite(text) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 64;
  const g = c.getContext('2d');
  g.font = 'bold 32px sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillStyle = 'rgba(0,0,0,0.55)'; g.fillRect(0, 8, 256, 48);
  g.fillStyle = '#fff'; g.fillText(text, 128, 33, 244);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true }));
  sprite.scale.set(1.6, 0.4, 1);
  sprite.position.y = PLAYER.height + 0.4;
  return sprite;
}

const STRIDE_RAD_PER_UNIT = 2.4; // leg phase advanced per unit walked (one full cycle ~ two steps)
const MAX_LEG_SWING = 0.8; // radians at full sprint
const CROUCH_DROP = PLAYER.height - PLAYER.crouchHeight; // how far the body lowers when crouched
const CROUCH_LEG_ANGLE = Math.acos((0.8 - CROUCH_DROP) / 0.8); // legs angle out so the hips sit lower
const GUN_MOUNT = new THREE.Vector3(0.26, 1.16, -0.32); // trigger hand, chest height in front of the body

// Humanoid built from boxes; origin at the feet, facing -Z at ry = 0. Legs swing with ground speed
// (animate), arms reach forward to hold the current weapon.
export function createRemotePlayer(state) {
  const root = new THREE.Group();
  const color = hashColor(state.id);
  const dark = color.clone().multiplyScalar(0.55);
  const legs = [-0.12, 0.12].map((x) => {
    const hip = new THREE.Group(); // pivot at the hip so the leg swings from the top
    hip.position.set(x, 0.8, 0);
    box(hip, 0.22, 0.8, 0.25, 0, -0.4, 0, dark);
    root.add(hip);
    return hip;
  });
  const upper = new THREE.Group(); // torso, head, arms and gun; bobs with each step
  root.add(upper);
  box(upper, 0.55, 0.7, 0.3, 0, 1.15, 0, color);
  const face = makeFace(state.id);
  const skin = face.look.skin;
  const head = new THREE.Group();
  head.position.y = 1.65;
  const skinMat = mat(skin);
  const hairMat = mat(face.look.hair);
  const faceMat = new THREE.MeshLambertMaterial({ map: face.normal });
  // BoxGeometry face order: +x, -x, +y, -y, +z, -z. Hair on top and back, face on the front (-z).
  head.add(new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 0.3), [skinMat, skinMat, hairMat, skinMat, hairMat, faceMat]));
  upper.add(head);
  let hurtTimer = 0;
  const held = new THREE.Group(); // current weapon, mounted at the trigger hand
  held.position.copy(GUN_MOUNT);
  upper.add(held);
  let gun = null;
  let arms = null;
  const label = labelSprite(state.username || 'player');
  root.add(label);
  let tier = 0;
  let disposed = false;

  const disposeTree = (obj) => obj.traverse((o) => {
    if (o.userData.shared) return; // gun models share GPU resources with the load cache
    if (o.geometry) o.geometry.dispose();
    if (o.material) { if (o.material.map) o.material.map.dispose(); o.material.dispose(); }
  });

  function setGun(group) {
    if (gun) { held.remove(gun); disposeTree(gun); }
    gun = group;
    held.add(gun);
  }

  // Arms stretch from the shoulders to the hand points on this weapon (or hang, for a free hand).
  function buildArms(weapon) {
    if (arms) { upper.remove(arms); disposeTree(arms); }
    arms = new THREE.Group();
    const { grip, support } = handPoints(weapon);
    const shoulderR = new THREE.Vector3(0.34, 1.42, 0);
    const shoulderL = new THREE.Vector3(-0.34, 1.42, 0);
    const handR = grip.clone().add(GUN_MOUNT);
    const handL = support ? support.clone().add(GUN_MOUNT) : new THREE.Vector3(-0.4, 0.9, 0.02);
    for (const [shoulder, hand] of [[shoulderR, handR], [shoulderL, handL]]) {
      limb(arms, shoulder, hand, 0.14, color);
      box(arms, 0.12, 0.12, 0.12, hand.x, hand.y, hand.z, skin);
    }
    upper.add(arms);
  }

  // Walk cycle, driven by how fast the (interpolated) body is actually moving.
  const lastPos = new THREE.Vector3();
  let havePos = false;
  let phase = 0;
  let stride = 0; // 0 = standing, 1 = full sprint
  let crouchK = 0; // 0 = standing, 1 = crouched (kneel: one leg forward, one back, body lowered)
  function animate(dt, crouched = false) {
    if (dt <= 0) return;
    if (hurtTimer > 0 && (hurtTimer -= dt * 1000) <= 0) { faceMat.map = face.normal; faceMat.needsUpdate = true; }
    crouchK += ((crouched ? 1 : 0) - crouchK) * Math.min(1, dt * 12);
    const speed = havePos ? Math.hypot(root.position.x - lastPos.x, root.position.z - lastPos.z) / dt : 0;
    lastPos.copy(root.position);
    havePos = true;
    const walking = speed > 0.5 && speed < PLAYER.sprintSpeed * 3; // ignore teleports (respawns)
    stride += ((walking ? Math.min(1, speed / PLAYER.sprintSpeed) : 0) - stride) * Math.min(1, dt * 10);
    if (walking) phase += speed * dt * STRIDE_RAD_PER_UNIT;
    const swing = Math.sin(phase) * MAX_LEG_SWING * stride * (1 - crouchK * 0.5);
    const kneel = CROUCH_LEG_ANGLE * crouchK;
    legs[0].rotation.x = swing + kneel;
    legs[1].rotation.x = -swing - kneel;
    for (const hip of legs) hip.position.y = 0.8 - CROUCH_DROP * crouchK;
    upper.position.y = Math.abs(Math.cos(phase)) * 0.05 * stride - CROUCH_DROP * crouchK;
    label.position.y = PLAYER.height + 0.4 - CROUCH_DROP * crouchK;
  }

  return {
    mesh: root,
    animate,
    setTier(t) {
      if (t === tier) return;
      tier = t;
      const weapon = getWeapon(t);
      setGun(buildProceduralGun(weapon)); // placeholder until the model loads
      buildArms(weapon);
      loadModel(weapon).then((scene) => {
        if (scene && tier === t && !disposed) setGun(fitModel(scene, weapon));
      });
    },
    setPitch(rx) { head.rotation.x = rx; },
    // Pained expression for a moment after being hit.
    hurt() {
      hurtTimer = HURT_MS;
      faceMat.map = face.hurt;
      faceMat.needsUpdate = true;
    },
    dispose() {
      disposed = true;
      disposeTree(root);
      face.normal.dispose();
      face.hurt.dispose();
    },
  };
}
