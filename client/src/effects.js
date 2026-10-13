import * as THREE from 'three';

const TRACER_MS = 80;
const FLASH_MS = 50;

// Tracers, muzzle flashes and the crosshair hit marker.
export function createEffects(scene) {
  const tracers = []; // { line, age }
  const flashes = []; // { mesh, timer }
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

  return { tracer, createMuzzleFlash, hitMarker, update };
}
