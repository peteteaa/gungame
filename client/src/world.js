import * as THREE from 'three';
import { mapColliders } from '../../shared/constants.js';
import { mapPhysics } from '../../shared/physics.js';

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

// Traced maps have thousands of boxes: draw them as one mesh (plus one set of outlines), each box colored by what it
// most likely is, judged from its shape: tall blocks are buildings (plaster walls, roof on top), small raised ones are
// beams, small blocks standing up to 2.5 m from the floor around them are crates, long low ones are walls, taller
// ones facades, and the rest (including raised floors and bridges) is paving. Colors come from the map's theme.palette.
const FACES = [ // [axis, sign] for +x, -x, +y, +z, -z (no bottoms: nothing is ever seen from below)
  [0, 1], [0, -1], [1, 1], [2, 1], [2, -1],
];
const DEFAULT_PALETTE = {
  plaster: [0xd8c4a0], roof: 0xa0522d, paving: [0xa9a291, 0xb5ae9d], pavingSide: 0x857d70, wall: 0xc8b48f,
  wood: 0x7a5232, crates: [0x8a6a45],
};
const hash = (a, b) => ((Math.imul(a | 0, 73856093) ^ Math.imul(b | 0, 19349663)) >>> 0);
const pick = (list, h) => list[h % list.length];
const vary = (hex, h, amount = 0.04) => new THREE.Color(hex).offsetHSL(0, 0, ((h % 1000) / 1000 - 0.5) * amount);

function boxColors(b, phys, palette) {
  const cx = (b.min.x + b.max.x) / 2;
  const cz = (b.min.z + b.max.z) / 2;
  const w = b.max.x - b.min.x;
  const d = b.max.z - b.min.z;
  const h = hash(Math.round(cx * 4), Math.round(cz * 4));
  if (b.max.y > 8) { // building: one facade color per 12 m block of the city, roofs on top
    const facade = vary(pick(palette.plaster, hash(Math.floor(cx / 12), Math.floor(cz / 12))), h, 0.03);
    return { top: vary(palette.roof, h, 0.06), side: facade };
  }
  if (b.min.y > 0.5 && Math.max(w, d) < 2.5) { // beam, small balcony
    const wood = vary(palette.wood, h);
    return { top: wood.clone().offsetHSL(0, 0, 0.05), side: wood };
  }
  // How far this box stands above the floor right around it.
  let ground = b.max.y;
  phys.some(b.min.x - 1, b.min.z - 1, b.max.x + 1, b.max.z + 1, (c) => {
    if (c.max.y < ground && c.max.x >= b.min.x - 1 && c.min.x <= b.max.x + 1 && c.max.z >= b.min.z - 1 && c.min.z <= b.max.z + 1) ground = c.max.y;
  });
  const rise = b.max.y - ground;
  if (rise >= 0.75 && rise <= 2.5 && Math.max(w, d) <= 3) { // crate / cover
    const crate = vary(pick(palette.crates, h), h, 0.06);
    return { top: crate.clone().offsetHSL(0, 0, 0.06), side: crate };
  }
  if (rise > 2.5) { // pillar, low building, facade piece: plaster like the buildings around it
    const facade = vary(pick(palette.plaster, hash(Math.floor(cx / 12), Math.floor(cz / 12))), h, 0.03);
    // Some short wall pieces get a door (or frame) in the map's accent color: the bottom 2.4 m above the floor.
    const accent = palette.accent;
    if (accent && Math.min(w, d) <= 1 && Math.max(w, d) <= 2.5 && (h >>> 3) % 100 < accent.chance * 100) {
      return { top: new THREE.Color(palette.wall), side: facade, band: { y: ground + 2.4, color: vary(accent.color, h, 0.05) } };
    }
    return { top: new THREE.Color(palette.wall), side: facade };
  }
  if (rise >= 0.75) { // low wall, parapet, planter edge
    const wall = vary(palette.wall, h, 0.05);
    return { top: wall.clone().offsetHSL(0, 0, 0.06), side: wall.clone().offsetHSL(0, 0, -0.05) };
  }
  // paving: alternating stone tones (darker inside the map's marked zones, e.g. bombsites), a touch warmer on
  // higher terraces so levels read apart
  const zone = palette.zones?.find((zn) => Math.hypot(cx - zn.x, cz - zn.z) <= zn.r);
  const stone = vary(pick(zone?.paving ?? palette.paving, hash(Math.floor(cx / 2), Math.floor(cz / 2))), h, 0.03)
    .offsetHSL(0, Math.min(b.max.y, 8) * 0.008, Math.min(b.max.y, 8) * 0.006);
  return { top: stone, side: new THREE.Color(palette.pavingSide) };
}

function buildMergedBoxes(map) {
  const colliders = mapColliders(map);
  const phys = mapPhysics(map);
  const palette = { ...DEFAULT_PALETTE, ...map.theme?.palette };
  const pos = [];
  const nrm = [];
  const col = [];
  const idx = [];
  const lines = [];
  colliders.forEach((b) => {
    const lo = [b.min.x, b.min.y, b.min.z];
    const hi = [b.max.x, b.max.y, b.max.z];
    const { top, side, band } = boxColors(b, phys, palette);
    const quad = (axis, sign, qlo, qhi, c) => {
      const u = (axis + 1) % 3;
      const v = (axis + 2) % 3;
      const base = pos.length / 3;
      for (const [cu, cv] of [[0, 0], [1, 0], [1, 1], [0, 1]]) {
        const p = [0, 0, 0];
        p[axis] = sign > 0 ? qhi[axis] : qlo[axis];
        p[u] = cu ? qhi[u] : qlo[u];
        p[v] = cv ? qhi[v] : qlo[v];
        pos.push(...p);
        const n = [0, 0, 0];
        n[axis] = sign;
        nrm.push(...n);
        col.push(c.r, c.g, c.b);
      }
      if (sign > 0) idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
      else idx.push(base, base + 2, base + 1, base, base + 3, base + 2);
    };
    for (const [axis, sign] of FACES) {
      if (axis === 1) quad(axis, sign, lo, hi, top);
      else if (band && band.y > lo[1] && band.y < hi[1]) { // a door / frame painted on the bottom of the side
        quad(axis, sign, lo, [hi[0], band.y, hi[2]], band.color);
        quad(axis, sign, [lo[0], band.y, lo[2]], hi, side);
      } else quad(axis, sign, lo, hi, side);
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
    group.add(buildMergedBoxes(map));
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
