// node tools/test/models-pipeline.test.js  (model pipeline validation, manifest completeness, installed-vs-manifest consistency)
const V = require('../models/validate.js'), assert = require('assert'), fs = require('fs'), path = require('path');
const good = {name: 'A320 low poly', archetype: 'narrowbody', author: 'Jane Doe', source: 'https://poly.pizza/m/abc', licence: 'CC-BY-4.0', attribution: '"A320" by Jane Doe (CC BY 4.0)', forward: '-z'};
assert.deepEqual(V.checkEntry('a', good), []);
for (const f of V.FIELDS) { const e = Object.assign({}, good); delete e[f]; assert(V.checkEntry('a', e).some(m => m.includes('"' + f + '"')), 'missing ' + f); }
assert(V.checkEntry('a', Object.assign({}, good, {licence: 'CC-BY-NC-4.0'})).some(m => /not allowed/.test(m)), 'NC licence refused');
assert(V.checkEntry('a', Object.assign({}, good, {licence: 'Royalty Free'})).length, 'royalty free refused');
assert(V.checkEntry('a', Object.assign({}, good, {licence: 'CC0-1.0'})).length === 0);
assert(V.checkEntry('a', Object.assign({}, good, {archetype: 'spaceship'})).some(m => /archetype/.test(m)));
assert(V.checkEntry('a', Object.assign({}, good, {source: 'http://x.example/a'})).some(m => /https/.test(m)));
assert(V.checkEntry('a', Object.assign({}, good, {source: 'https://www.cgtrader.com/free-3d-models/aircraft/x'})).some(m => /marketplace/.test(m)), 'marketplace refused');
assert(V.checkEntry('a', Object.assign({}, good, {forward: 'up'})).some(m => /forward/.test(m)));
assert(V.checkEntry('a', Object.assign({}, good, {licence: 'CC-BY-4.0', attribution: ' '})).length, 'CC-BY needs attribution text');
// manifest: one model per archetype
assert.deepEqual(V.checkManifest({models: {a: good}}), []);
assert(V.checkManifest({models: {a: good, b: good}}).some(m => /already used/.test(m)));
assert(V.checkManifest({}).length);
// stats budgets
const ok = {bytes: 200 * 1024, triangles: 9000, span: 35, length: 37, tableSpan: 35.8, tableLength: 37.6};
assert.deepEqual(V.checkStats('a', ok), []);
assert(V.checkStats('a', Object.assign({}, ok, {bytes: 301 * 1024})).some(m => /KB/.test(m)));
assert(V.checkStats('a', Object.assign({}, ok, {triangles: 15001})).some(m => /triangles/.test(m)));
assert(V.checkStats('a', Object.assign({}, ok, {span: 90, length: 20})).some(m => /axis/.test(m)));
// installed vs manifest
const m = {models: {a: good}}, idx = {models: {narrowbody: {file: 'narrowbody.glb', licence: good.licence, attribution: good.attribution}}};
assert.deepEqual(V.checkInstalled(['narrowbody.glb'], idx, m), []);
assert(V.checkInstalled(['widebodyTwin.glb'], {models: {}}, m).some(x => /no manifest entry/.test(x)));
assert(V.checkInstalled([], idx, m).some(x => /not installed/.test(x)));
assert(V.checkInstalled(['narrowbody.glb'], {models: {narrowbody: Object.assign({}, idx.models.narrowbody, {licence: 'CC0-1.0'})}}, m).some(x => /differs/.test(x)));
// the REAL repository: the committed manifest is valid, and every installed model has a manifest entry and an index entry with its licence
const root = path.resolve(__dirname, '../..'), manifest = JSON.parse(fs.readFileSync(path.join(root, 'tools/models/models-manifest.json'), 'utf8'));
assert.deepEqual(V.checkManifest(manifest), [], 'tools/models/models-manifest.json is complete');
const dir = path.join(root, 'html/models'), files = fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => f.endsWith('.glb')) : [];
const index = fs.existsSync(path.join(dir, 'index.json')) ? JSON.parse(fs.readFileSync(path.join(dir, 'index.json'), 'utf8')) : {models: {}};
assert.deepEqual(V.checkInstalled(files, index, manifest), [], 'installed models are all in the manifest and index');
for (const f of files) assert(fs.statSync(path.join(dir, f)).size <= V.LIMITS.maxBytes, f + ' within the size budget');
// CC-BY attribution of every installed model is in THIRD_PARTY.md
const tp = fs.readFileSync(path.join(root, 'THIRD_PARTY.md'), 'utf8');
for (const a of Object.keys(index.models)) if (/^CC-BY/.test(index.models[a].licence)) assert(tp.includes(index.models[a].attribution), 'THIRD_PARTY.md credits ' + a);
console.log('models-pipeline tests ok (' + files.length + ' model(s) installed, ' + Object.keys(manifest.models).length + ' in the manifest)');
