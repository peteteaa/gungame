import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { PLAYER, getWeapon, FINAL_TIER } from '../../shared/constants.js';

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

  function mount(group) {
    if (current) holder.remove(current);
    current = group;
    holder.add(group);
    group.userData.muzzle.add(flash.mesh);
  }

  function showTier(t) {
    tier = t;
    const weapon = getWeapon(t);
    mount(buildProceduralGun(weapon));
    loadModel(weapon).then((scene) => {
      if (scene && tier === t) mount(fitModel(scene, weapon));
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

  function update(dt, moving) {
    kick = Math.max(0, kick - dt * 8);
    stab = Math.max(0, stab - dt * 4);
    bobT += dt * (moving ? 9 : 0);
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
    holder.position.set(
      base.x + Math.cos(bobT) * 0.012 * bobAmt - stabK * 0.1,
      base.y + Math.abs(Math.sin(bobT)) * 0.014 * bobAmt - drop,
      base.z + kick * 0.06 - stabK * 0.25,
    );
    holder.rotation.x = kick * 0.12 + stabK * 0.5;
    holder.rotation.z = tilt;
    holder.rotation.y = stabK * 0.4;
  }

  function muzzleWorld(target) {
    return current.userData.muzzle.getWorldPosition(target);
  }

  return { setTier, fire, startReload, cancelReload, update, muzzleWorld, get tier() { return tier; } };
}

// ---- Remote players ----

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

// Humanoid built from boxes; origin at the feet, facing -Z at ry = 0.
export function createRemotePlayer(state) {
  const root = new THREE.Group();
  const color = hashColor(state.id);
  const dark = color.clone().multiplyScalar(0.55);
  box(root, 0.22, 0.8, 0.25, -0.12, 0.4, 0, dark);
  box(root, 0.22, 0.8, 0.25, 0.12, 0.4, 0, dark);
  box(root, 0.55, 0.7, 0.3, 0, 1.15, 0, color);
  box(root, 0.15, 0.6, 0.15, -0.37, 1.2, 0, color);
  box(root, 0.15, 0.6, 0.15, 0.37, 1.2, 0, color);
  const head = new THREE.Group();
  head.position.y = 1.65;
  box(head, 0.3, 0.3, 0.3, 0, 0, 0, 0xe0b890);
  box(head, 0.24, 0.07, 0.04, 0, 0.03, -0.15, 0x111111); // visor shows facing
  root.add(head);
  const hand = new THREE.Group(); // held weapon: box placeholder until the tier's model loads
  hand.position.set(0.3, 1.2, -0.2);
  root.add(hand);
  const weaponBox = box(hand, 0.06, 0.08, 0.5, 0, 0, -0.1, 0x555555);
  let gunModel = null;
  root.add(labelSprite(state.username || 'player'));
  let tier = 0;
  let disposed = false;

  return {
    mesh: root,
    setTier(t) {
      if (t === tier) return;
      tier = t;
      const weapon = getWeapon(t);
      weaponBox.material.color.setHex(weapon.color);
      weaponBox.visible = true;
      if (gunModel) { hand.remove(gunModel); gunModel = null; }
      loadModel(weapon).then((scene) => {
        if (!scene || tier !== t || disposed) return;
        gunModel = fitModel(scene, weapon);
        hand.add(gunModel);
        weaponBox.visible = false;
      });
    },
    setPitch(rx) { head.rotation.x = rx; },
    dispose() {
      disposed = true;
      root.traverse((o) => {
        if (o.userData.shared) return; // gun models share GPU resources with the load cache
        if (o.geometry) o.geometry.dispose();
        if (o.material) { if (o.material.map) o.material.map.dispose(); o.material.dispose(); }
      });
    },
  };
}
