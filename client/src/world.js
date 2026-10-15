import * as THREE from 'three';
import { mapColliders } from '../../shared/constants.js';

function checkerTexture(map) {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const [dark, light] = map.theme?.ground ?? ['#2b3140', '#343b4d'];
  g.fillStyle = dark; g.fillRect(0, 0, 64, 64);
  g.fillStyle = light; g.fillRect(0, 0, 32, 32); g.fillRect(32, 32, 32, 32);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.NearestFilter;
  tex.colorSpace = THREE.SRGBColorSpace;
  const tiles = map.halfSize; // one checker pair per 2 world units
  tex.repeat.set(tiles, tiles);
  return tex;
}

function addBox(group, min, max, color) {
  const size = { x: max.x - min.x, y: max.y - min.y, z: max.z - min.z };
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(size.x, size.y, size.z),
    new THREE.MeshLambertMaterial({ color, flatShading: true }),
  );
  mesh.position.set((min.x + max.x) / 2, (min.y + max.y) / 2, (min.z + max.z) / 2);
  group.add(mesh);
  const edges = new THREE.LineSegments(
    new THREE.EdgesGeometry(mesh.geometry),
    new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35 }),
  );
  mesh.add(edges);
}

// Traced maps have thousands of boxes: draw them as one mesh (plus one set of outlines), colored by height so
// terrain levels read at a glance: low ground and steps in stone tones, raised floors warmer, buildings in plaster.
const FACES = [ // [axis, sign] for +x, -x, +y, +z, -z (no bottoms: nothing is ever seen from below)
  [0, 1], [0, -1], [1, 1], [2, 1], [2, -1],
];
function heightColor(top, i) {
  const c = new THREE.Color();
  if (top > 9) c.setHSL(0.07, 0.35, 0.72); // buildings
  else c.setHSL(0.1 - Math.min(top, 9) * 0.006, 0.3, 0.56 + Math.min(top, 9) * 0.025);
  return c.offsetHSL(0, 0, ((i * 2654435761) % 997) / 997 * 0.06 - 0.03);
}
function buildMergedBoxes(colliders) {
  const pos = [];
  const nrm = [];
  const col = [];
  const idx = [];
  const lines = [];
  colliders.forEach((b, i) => {
    const lo = [b.min.x, b.min.y, b.min.z];
    const hi = [b.max.x, b.max.y, b.max.z];
    const color = heightColor(b.max.y, i);
    for (const [axis, sign] of FACES) {
      const u = (axis + 1) % 3;
      const v = (axis + 2) % 3;
      const base = pos.length / 3;
      for (const [cu, cv] of [[0, 0], [1, 0], [1, 1], [0, 1]]) {
        const p = [0, 0, 0];
        p[axis] = sign > 0 ? hi[axis] : lo[axis];
        p[u] = cu ? hi[u] : lo[u];
        p[v] = cv ? hi[v] : lo[v];
        pos.push(...p);
        const n = [0, 0, 0];
        n[axis] = sign;
        nrm.push(...n);
        const shade = axis === 1 ? 1.08 : 0.92; // tops a little lighter than walls
        col.push(color.r * shade, color.g * shade, color.b * shade);
      }
      if (sign > 0) idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
      else idx.push(base, base + 2, base + 1, base, base + 3, base + 2);
    }
    // the four top edges and four verticals: enough to read the shapes
    const [x0, y0, z0] = lo;
    const [x1, y1, z1] = hi;
    lines.push(x0, y1, z0, x1, y1, z0, x1, y1, z0, x1, y1, z1, x1, y1, z1, x0, y1, z1, x0, y1, z1, x0, y1, z0,
      x0, y0, z0, x0, y1, z0, x1, y0, z0, x1, y1, z0, x1, y0, z1, x1, y1, z1, x0, y0, z1, x0, y1, z1);
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setIndex(idx);
  const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true }));
  const lineGeo = new THREE.BufferGeometry();
  lineGeo.setAttribute('position', new THREE.Float32BufferAttribute(lines, 3));
  mesh.add(new THREE.LineSegments(lineGeo, new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.22 })));
  return mesh;
}

// A checkered ground plus every collider drawn as a box (colors from the map's theme/tiles).
function buildBoxMap(map) {
  const group = new THREE.Group();
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(map.halfSize * 2, map.halfSize * 2),
    new THREE.MeshLambertMaterial({ map: checkerTexture(map) }),
  );
  ground.rotation.x = -Math.PI / 2;
  group.add(ground);
  const colliders = mapColliders(map);
  if (colliders.length > 500) {
    group.add(buildMergedBoxes(colliders));
    return group;
  }
  colliders.forEach((b, i) => {
    const isWall = i >= map.boxes.length;
    let color;
    if (isWall) color = new THREE.Color(map.theme?.wall ?? new THREE.Color().setHSL(0.62, 0.15, 0.3));
    else if (map.boxes[i].color !== undefined) color = new THREE.Color(map.boxes[i].color);
    else color = new THREE.Color().setHSL((0.05 + i * 0.13) % 1, 0.35, 0.45 + (i % 3) * 0.05);
    addBox(group, b.min, b.max, color);
  });
  return group;
}

// Lights are shared; each map's geometry is built once and swapped in by setMap.
export function createWorld(scene) {
  scene.add(new THREE.HemisphereLight(0xcfe6ff, 0x3a3f4d, 1.1));
  const sun = new THREE.DirectionalLight(0xfff1d0, 1.6);
  sun.position.set(30, 50, 20);
  scene.add(sun);
  const built = new Map(); // map id -> Object3D
  let current = null;

  return {
    setMap(map) {
      if (!built.has(map.id)) built.set(map.id, buildBoxMap(map));
      if (current) scene.remove(current);
      current = built.get(map.id);
      scene.add(current);
      const sky = map.theme?.sky ?? 0x8fb4d9;
      const [fogNear, fogFar] = map.theme?.fog ?? [25, 95];
      scene.background = new THREE.Color(sky);
      scene.fog = new THREE.Fog(sky, fogNear, fogFar);
    },
  };
}
