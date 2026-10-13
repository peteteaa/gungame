// Splits the "Low poly guns" Sketchfab pack (one GLB with every gun laid out on a wall) into one GLB per gun.
// Each output is a single mesh with its magazine / scope / handle parts merged in, centered on the origin,
// barrel pointing down -Z, Y up, at one shared scale so relative sizes between guns are preserved.
// A "muzzle" node marks the barrel tip (tracers and muzzle flashes start there).
//
//   node scripts/split-guns.mjs ~/Downloads/low_poly_guns.glb [client/public/models/guns]
import fs from 'node:fs';
import path from 'node:path';
import { NodeIO, Logger } from '@gltf-transform/core';
import { cloneDocument, flatten, join, prune, dedup, unweld, weld, getBounds } from '@gltf-transform/functions';

const SCALE = 0.25; // pack units -> meters (pistol ~0.33 m, rifles ~0.65 m, snipers ~0.85 m)
const RENAME = { fusil: 'rifle', subfusil: 'smg' }; // pack names are Spanish
const PART = /^(.+?)_(?:charger|charguer|scope|handle)(?:_(\d+))?$/;
const SWATCHES = 9; // the pack's 64x64 texture is a 9x9 grid of flat color swatches
const MAX_UV_SPAN = 0.2; // UV extent beyond which a triangle is smeared across swatches

const [src, outDir = 'client/public/models/guns'] = process.argv.slice(2);
if (!src) {
  console.error('usage: node scripts/split-guns.mjs <low_poly_guns.glb> [outDir]');
  process.exit(1);
}

const io = new NodeIO();
const source = await io.read(src);
const rootNode = (doc) => doc.getRoot().listNodes().find((n) => n.getName() === 'RootNode');

// Group pack nodes into guns: "pistol_3" owns "pistol_charger_3", "pistol_scope_3", ...
const groups = new Map(); // body name -> [node names]
const parts = [];
for (const node of rootNode(source).listChildren()) {
  const name = node.getName();
  const m = name.match(PART);
  if (m) parts.push({ name, body: m[2] === undefined ? m[1] : `${m[1]}_${m[2]}` });
  else groups.set(name, [name]);
}
for (const { name, body } of parts) {
  // The flamethrower is un-numbered but has numbered parts (flamethrower_charger_1, _2).
  const owner = groups.has(body) ? body : body.replace(/_\d+$/, '');
  if (!groups.has(owner)) throw new Error(`part ${name} has no body ${body}`);
  groups.get(owner).push(name);
}

// Sanity check: every part should sit within its body's footprint (X/Z; scopes sit above the body in Y).
const byName = new Map(rootNode(source).listChildren().map((n) => [n.getName(), n]));
for (const [body, names] of groups) {
  const b = getBounds(byName.get(body));
  for (const name of names.slice(1)) {
    const p = getBounds(byName.get(name));
    const c = p.min.map((v, i) => (v + p.max[i]) / 2);
    const inside = c.every((v, i) => i === 1 || (v >= b.min[i] - 0.05 && v <= b.max[i] + 0.05));
    if (!inside) console.warn(`warning: ${name} is outside ${body}'s bounds`);
  }
}

fs.mkdirSync(outDir, { recursive: true });
const manifest = [];

for (const [body, names] of groups) {
  const doc = cloneDocument(source);
  doc.setLogger(new Logger(Logger.Verbosity.WARN));
  const keep = new Set(names);
  for (const node of rootNode(doc).listChildren()) {
    if (!keep.has(node.getName())) node.listChildren().concat(node).forEach((n) => n.dispose());
  }
  await doc.transform(flatten()); // mesh nodes move to the scene root with their world transforms

  const scene = doc.getRoot().getDefaultScene();
  const meshNodes = scene.listChildren().filter((n) => n.getMesh());
  const b = getBounds(scene);
  const center = b.min.map((v, i) => (v + b.max[i]) / 2);

  // New root: center, then scale. Barrel already runs along -Z with Y up in the pack's world space.
  const gun = doc.createNode(outName(body))
    .setScale([SCALE, SCALE, SCALE])
    .setTranslation(center.map((v) => -v * SCALE));
  for (const n of scene.listChildren()) scene.removeChild(n);
  for (const n of meshNodes) gun.addChild(n);
  scene.addChild(gun);

  await doc.transform(join({ keepNamed: false }), unweld(), flattenStretchedUVs, weld(), dedup(), prune());
  scene.addChild(doc.createNode('muzzle').setTranslation(findMuzzle(scene)));
  doc.getRoot().getAsset().extras = source.getRoot().getAsset().extras; // keep author / license / source
  const file = `${outName(body)}.glb`;
  await io.write(path.join(outDir, file), doc);

  const ob = getBounds(doc.getRoot().getDefaultScene());
  const size = ob.max.map((v, i) => +(v - ob.min[i]).toFixed(3));
  const muzzle = scene.listChildren().find((n) => n.getName() === 'muzzle').getTranslation();
  manifest.push({ name: outName(body), file, parts: names, size, muzzle });
  console.log(file.padEnd(20), `${names.length} parts`.padEnd(9), size.join(' x '), 'm');
}

manifest.sort((a, b) => a.name.localeCompare(b.name, 'en', { numeric: true }));
fs.writeFileSync(path.join(outDir, 'index.json'), `${JSON.stringify({
  source: source.getRoot().getAsset().extras,
  orientation: 'Y up, barrel along -Z, centered on the bounding box, meters',
  guns: manifest,
}, null, 2)}\n`);
console.log(`wrote ${manifest.length} guns + index.json to ${outDir}`);

// A few source triangles (thin bevels where two colors meet) have UVs spanning several swatches, which renders
// as rainbow stripes. Give each such triangle the swatch most of its corners use. Runs on unwelded geometry.
function flattenStretchedUVs(doc) {
  const swatch = (uv) => `${Math.floor(uv[0] * SWATCHES)},${Math.floor(uv[1] * SWATCHES)}`;
  let fixed = 0;
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const uv = prim.getAttribute('TEXCOORD_0');
      if (!uv) continue;
      for (let t = 0; t + 2 < uv.getCount(); t += 3) {
        const uvs = [0, 1, 2].map((k) => uv.getElement(t + k, []));
        const span = Math.max(...[0, 1].map((a) => Math.max(...uvs.map((u) => u[a])) - Math.min(...uvs.map((u) => u[a]))));
        if (span <= MAX_UV_SPAN) continue; // normal faces stay within (or straddle the edge of) one swatch
        const keys = uvs.map(swatch);
        const counts = keys.map((k) => keys.filter((o) => o === k).length);
        const pick = uvs[counts.indexOf(Math.max(...counts))];
        for (let k = 0; k < 3; k++) uv.setElement(t + k, pick);
        fixed++;
      }
    }
  }
  if (fixed) doc.getLogger().warn(`flattened ${fixed} stretched-UV triangles`);
}

// Barrel tip: center of the vertices in the front-most sliver of the gun (smallest z).
function findMuzzle(scene) {
  const pts = [];
  scene.traverse((node) => {
    const mesh = node.getMesh();
    if (!mesh) return;
    const m = node.getWorldMatrix();
    for (const prim of mesh.listPrimitives()) {
      const pos = prim.getAttribute('POSITION');
      const v = [0, 0, 0];
      for (let i = 0; i < pos.getCount(); i++) {
        pos.getElement(i, v);
        pts.push([0, 1, 2].map((r) => m[r] * v[0] + m[4 + r] * v[1] + m[8 + r] * v[2] + m[12 + r]));
      }
    }
  });
  const minZ = Math.min(...pts.map((p) => p[2]));
  const maxZ = Math.max(...pts.map((p) => p[2]));
  const front = pts.filter((p) => p[2] <= minZ + (maxZ - minZ) * 0.02);
  const mid = (i) => (Math.min(...front.map((p) => p[i])) + Math.max(...front.map((p) => p[i]))) / 2;
  return [+mid(0).toFixed(4), +mid(1).toFixed(4), +minZ.toFixed(4)];
}

function outName(body) {
  const [type, num] = body.split(/_(?=\d+$)/);
  return [RENAME[type] ?? type, num].filter((s) => s !== undefined).join('_');
}
