#!/usr/bin/env node
'use strict';
// Validate and optimise a dropped-in aircraft model, then install it.
//   cd tools/models && npm install && node optimise.js <name> <path-to-model.glb>
// <name> is the key of the entry in models-manifest.json (licence, author, source, attribution, archetype, forward axis). The script:
//   1. refuses unless the manifest entry is complete and the licence is CC0 or CC-BY (validate.js);
//   2. drops textures and liveries (the 3D layer shades by material NAME and geometry only: neutral body, grey trim), welds, simplifies to the triangle budget,
//      quantises and meshopt-compresses (gltf-transform);
//   3. checks the result: <= 300 KB, <= 15000 triangles, span/length fit the archetype's table dimensions (so the forward axis is right);
//   4. writes ../../html/models/<archetype>.glb and regenerates ../../html/models/index.json from the manifest + installed files.
const fs = require('fs'), path = require('path');
const V = require('./validate.js');
const ROOT = path.resolve(__dirname, '../..'), OUT = path.join(ROOT, 'html/models'), MANIFEST = path.join(__dirname, 'models-manifest.json');
const TABLE = {narrowbody: [35.8, 37.6], widebodyTwin: [60.9, 63.7], widebodyQuad: [68.5, 70.7], regionalJet: [28.7, 36.4], businessJet: [19.4, 20.8], turboprop: [27.0, 27.2], lightSingle: [11.0, 8.3], lightTwin: [11.5, 9.1], helicopter: [11.0, 12.5], generic: [30, 30]};
function writeIndex() {
  const m = JSON.parse(fs.readFileSync(MANIFEST, 'utf8')), files = fs.existsSync(OUT) ? fs.readdirSync(OUT).filter(f => f.endsWith('.glb')) : [], idx = {version: 1, models: {}};
  for (const k of Object.keys(m.models)) { const e = m.models[k], f = e.archetype + '.glb'; if (files.includes(f)) idx.models[e.archetype] = {file: f, forward: e.forward, author: e.author, source: e.source, licence: e.licence, attribution: e.attribution}; }
  fs.mkdirSync(OUT, {recursive: true}); fs.writeFileSync(path.join(OUT, 'index.json'), JSON.stringify(idx, null, 2) + '\n');
  return idx;
}
async function main() {
  const [name, input] = process.argv.slice(2);
  if (name === '--index') { console.log(Object.keys(writeIndex().models).length + ' model(s) in index.json'); return; }
  if (!name || !input) { console.error('usage: node optimise.js <manifest-key> <model.glb>   |   node optimise.js --index'); process.exit(2); }
  const m = JSON.parse(fs.readFileSync(MANIFEST, 'utf8')), e = m.models[name];
  let bad = V.checkEntry(name, e);
  if (bad.length) { console.error(bad.join('\n')); process.exit(1); }
  const {NodeIO} = require('@gltf-transform/core'), {ALL_EXTENSIONS} = require('@gltf-transform/extensions');
  const {dedup, prune, weld, simplify, quantize, meshopt, textureCompress, getBounds} = require('@gltf-transform/functions');
  const {MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier} = require('meshoptimizer');
  await MeshoptDecoder.ready; await MeshoptEncoder.ready; await MeshoptSimplifier.ready;
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder});
  const doc = await io.read(input);
  for (const t of doc.getRoot().listTextures()) t.dispose();                       // no liveries
  for (const mat of doc.getRoot().listMaterials()) { mat.setBaseColorTexture(null); mat.setNormalTexture(null); mat.setOcclusionTexture(null); mat.setEmissiveTexture(null); mat.setMetallicRoughnessTexture(null); }
  const count = () => doc.getRoot().listMeshes().reduce((n, mesh) => n + mesh.listPrimitives().reduce((k, p) => k + (p.getIndices() ? p.getIndices().getCount() : p.getAttribute('POSITION').getCount()) / 3, 0), 0);
  await doc.transform(dedup(), weld(), prune());
  let tris = Math.round(count());
  if (tris > V.LIMITS.maxTriangles) await doc.transform(simplify({simplifier: MeshoptSimplifier, ratio: V.LIMITS.maxTriangles / tris * 0.95, error: 0.01}), prune());
  tris = Math.round(count());
  await doc.transform(quantize(), meshopt({encoder: MeshoptEncoder, level: 'high'}));
  const b = getBounds(doc.getRoot().listScenes()[0]), ext = [b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]];
  const fwd = e.forward[1], lenAxis = fwd === 'x' ? 0 : 2, spanAxis = lenAxis === 0 ? 2 : 0;
  const glb = await io.writeBinary(doc), t = TABLE[e.archetype];
  bad = V.checkStats(name, {bytes: glb.byteLength, triangles: tris, span: ext[spanAxis], length: ext[lenAxis], tableSpan: t[0], tableLength: t[1]});
  if (bad.length) { console.error(bad.join('\n')); process.exit(1); }
  fs.mkdirSync(OUT, {recursive: true}); fs.writeFileSync(path.join(OUT, e.archetype + '.glb'), glb);
  writeIndex();
  console.log('installed html/models/' + e.archetype + '.glb  ' + Math.round(glb.byteLength / 1024) + ' KB  ' + tris + ' triangles  (' + e.licence + ', ' + e.author + ')');
}
main().catch(err => { console.error(err); process.exit(1); });
