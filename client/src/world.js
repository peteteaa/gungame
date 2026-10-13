import * as THREE from 'three';
import { MAP, mapColliders } from '../../shared/constants.js';

function checkerTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = '#2b3140'; g.fillRect(0, 0, 64, 64);
  g.fillStyle = '#343b4d'; g.fillRect(0, 0, 32, 32); g.fillRect(32, 32, 32, 32);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.NearestFilter;
  tex.colorSpace = THREE.SRGBColorSpace;
  const tiles = MAP.halfSize; // one checker pair per 2 world units
  tex.repeat.set(tiles, tiles);
  return tex;
}

function addBox(scene, min, max, color) {
  const size = { x: max.x - min.x, y: max.y - min.y, z: max.z - min.z };
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(size.x, size.y, size.z),
    new THREE.MeshLambertMaterial({ color, flatShading: true }),
  );
  mesh.position.set((min.x + max.x) / 2, (min.y + max.y) / 2, (min.z + max.z) / 2);
  scene.add(mesh);
  const edges = new THREE.LineSegments(
    new THREE.EdgesGeometry(mesh.geometry),
    new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35 }),
  );
  mesh.add(edges);
}

// Lights, fog, ground, crates and perimeter walls.
export function buildWorld(scene) {
  scene.background = new THREE.Color(0x8fb4d9);
  scene.fog = new THREE.Fog(0x8fb4d9, 25, 95);
  scene.add(new THREE.HemisphereLight(0xcfe6ff, 0x3a3f4d, 1.1));
  const sun = new THREE.DirectionalLight(0xfff1d0, 1.6);
  sun.position.set(30, 50, 20);
  scene.add(sun);

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(MAP.halfSize * 2, MAP.halfSize * 2),
    new THREE.MeshLambertMaterial({ map: checkerTexture() }),
  );
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);

  const colliders = mapColliders();
  colliders.forEach((b, i) => {
    const isWall = i >= MAP.boxes.length;
    const color = isWall
      ? new THREE.Color().setHSL(0.62, 0.15, 0.3)
      : new THREE.Color().setHSL((0.05 + i * 0.13) % 1, 0.35, 0.45 + (i % 3) * 0.05);
    addBox(scene, b.min, b.max, color);
  });
}
