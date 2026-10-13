import * as THREE from 'three';

const TRACER_MS = 80;
const FLASH_MS = 50;

const FLAME_POOL = 400; // sprites reused round-robin; the oldest flame is recycled when the pool is full
const FLAME_PER_PELLET = 3;
const FLAME_LIFE = 0.4; // seconds
const FLAME_HOT = new THREE.Color(0xfff2b0);
const FLAME_MID = new THREE.Color(0xff7a1a);
const FLAME_COOL = new THREE.Color(0x8a1a05);

// Soft round blob; tinted per particle.
function flameTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.4, 'rgba(255,255,255,0.6)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

// Tracers, flames, muzzle flashes and the crosshair hit marker.
export function createEffects(scene) {
  const tracers = []; // { line, age }
  const flashes = []; // { mesh, timer }
  const flames = []; // pool of { sprite, from, to, age, life, size, spin, active }
  const flameMap = flameTexture();
  let nextFlame = 0;
  const hitEl = document.getElementById('hitmarker');
  let hitTimer = 0;

  function tracer(from, to) {
    const geo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(from.x, from.y, from.z),
      new THREE.Vector3(to.x, to.y, to.z),
    ]);
    const mat = new THREE.LineBasicMaterial({ color: 0xffe9a0, transparent: true, opacity: 1, fog: false });
    const line = new THREE.Line(geo, mat);
    scene.add(line);
    tracers.push({ line, age: 0 });
  }

  // A puff of fire travelling from `from` to where the pellet stopped, swelling, cooling and rising as it goes.
  function flame(from, to) {
    for (let k = 0; k < FLAME_PER_PELLET; k++) {
      let f = flames[nextFlame];
      if (!f) {
        const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
          map: flameMap, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false,
        }));
        scene.add(sprite);
        f = flames[nextFlame] = { sprite, from: new THREE.Vector3(), to: new THREE.Vector3() };
      }
      nextFlame = (nextFlame + 1) % FLAME_POOL;
      const j = 0.25; // scatter so the stream looks turbulent rather than three straight lines
      f.from.set(from.x, from.y, from.z);
      f.to.set(to.x + (Math.random() - 0.5) * j, to.y + (Math.random() - 0.5) * j, to.z + (Math.random() - 0.5) * j);
      f.age = -k * 0.025; // stagger the puffs within a shot
      f.life = FLAME_LIFE * (0.7 + Math.random() * 0.6);
      f.size = 0.6 + Math.random() * 0.5;
      f.spin = (Math.random() - 0.5) * 6;
      f.sprite.material.rotation = Math.random() * Math.PI * 2;
      f.sprite.visible = false;
      f.active = true;
    }
  }

  function updateFlames(dt) {
    for (const f of flames) {
      if (!f.active) continue;
      f.age += dt;
      if (f.age < 0) continue;
      const k = f.age / f.life;
      if (k >= 1) { f.active = false; f.sprite.visible = false; continue; }
      const travel = 1 - (1 - k) * (1 - k); // fast out of the nozzle, slowing as it spreads
      f.sprite.position.lerpVectors(f.from, f.to, travel);
      f.sprite.position.y += k * k * 0.6; // heat rises
      f.sprite.scale.setScalar(f.size * (0.25 + k));
      const c = f.sprite.material.color;
      if (k < 0.3) c.lerpColors(FLAME_HOT, FLAME_MID, k / 0.3); else c.lerpColors(FLAME_MID, FLAME_COOL, (k - 0.3) / 0.7);
      f.sprite.material.opacity = 0.9 * (1 - k) ** 1.5;
      f.sprite.material.rotation += f.spin * dt;
      f.sprite.visible = true;
    }
  }

  function createMuzzleFlash() {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.12, 0.12, 0.05),
      new THREE.MeshBasicMaterial({ color: 0xffd34a, fog: false }),
    );
    mesh.visible = false;
    const flash = { mesh, timer: 0 };
    flashes.push(flash);
    return { mesh, trigger() { flash.timer = FLASH_MS / 1000; mesh.visible = true; mesh.rotation.z = Math.random() * 3; } };
  }

  function hitMarker() {
    hitEl.classList.add('on');
    hitTimer = 0.12;
  }

  function update(dt) {
    updateFlames(dt);
    for (let i = tracers.length - 1; i >= 0; i--) {
      const t = tracers[i];
      t.age += dt * 1000;
      t.line.material.opacity = Math.max(0, 1 - t.age / TRACER_MS);
      if (t.age >= TRACER_MS) {
        scene.remove(t.line);
        t.line.geometry.dispose();
        t.line.material.dispose();
        tracers.splice(i, 1);
      }
    }
    for (const f of flashes) {
      if (f.timer > 0) { f.timer -= dt; if (f.timer <= 0) f.mesh.visible = false; }
    }
    if (hitTimer > 0) { hitTimer -= dt; if (hitTimer <= 0) hitEl.classList.remove('on'); }
  }

  return { tracer, flame, createMuzzleFlash, hitMarker, update };
}
