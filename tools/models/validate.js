'use strict';
// Pure checks for a dropped-in aircraft model (used by tools/models/optimise.js and tested in tools/test/models-pipeline.test.js).
const ARCHETYPES = ['narrowbody', 'widebodyTwin', 'widebodyQuad', 'regionalJet', 'businessJet', 'turboprop', 'lightSingle', 'lightTwin', 'helicopter', 'generic'];
const LICENCES = ['CC0-1.0', 'CC-BY-4.0', 'CC-BY-3.0', 'CC-BY-2.0'];
const FORWARD = ['+x', '-x', '+z', '-z'];
const FIELDS = ['name', 'archetype', 'author', 'source', 'licence', 'attribution', 'forward'];
const LIMITS = {maxBytes: 300 * 1024, maxTriangles: 15000};
const MARKETPLACE = /cgtrader|turbosquid|3dexport|free3d\.com\/3d-model\/.*royalty|sketchfab\.com\/3d-models\/.*(?:store|buy)|renderhub|hum3d|3dsky|evermotion/i;
// manifest entry -> list of problems (empty = fine)
function checkEntry(key, e) {
  const bad = [];
  if (!e || typeof e !== 'object') return [key + ': entry missing'];
  for (const f of FIELDS) if (typeof e[f] !== 'string' || !e[f].trim()) bad.push(key + ': field "' + f + '" is missing or empty');
  if (e.archetype && ARCHETYPES.indexOf(e.archetype) < 0) bad.push(key + ': archetype "' + e.archetype + '" is not one of ' + ARCHETYPES.join(', '));
  if (e.licence && LICENCES.indexOf(e.licence) < 0) bad.push(key + ': licence "' + e.licence + '" is not allowed (CC0-1.0 or CC-BY only)');
  if (e.forward && FORWARD.indexOf(e.forward) < 0) bad.push(key + ': forward must be one of ' + FORWARD.join(', '));
  if (e.source && !/^https:\/\//.test(e.source)) bad.push(key + ': source must be an https URL of the page where the licence was verified');
  if (e.source && MARKETPLACE.test(e.source)) bad.push(key + ': marketplace models forbid redistribution and must not go in a public repository');
  if (e.licence && /^CC-BY/.test(e.licence) && !/\S+.*\S+/.test(e.attribution || '')) bad.push(key + ': CC-BY needs an attribution text');
  return bad;
}
function checkManifest(m) {
  const bad = [];
  if (!m || typeof m.models !== 'object') return ['manifest has no "models" object'];
  const seen = {};
  for (const k of Object.keys(m.models)) {
    bad.push(...checkEntry(k, m.models[k]));
    const a = m.models[k] && m.models[k].archetype;
    if (a) { if (seen[a]) bad.push(k + ': archetype "' + a + '" is already used by ' + seen[a]); else seen[a] = k; }
  }
  return bad;
}
// stats of the OPTIMISED file -> problems. stats: {bytes, triangles, span, length, tableSpan, tableLength}
function checkStats(key, s) {
  const bad = [];
  if (s.bytes > LIMITS.maxBytes) bad.push(key + ': ' + Math.round(s.bytes / 1024) + ' KB is over the ' + LIMITS.maxBytes / 1024 + ' KB budget');
  if (s.triangles > LIMITS.maxTriangles) bad.push(key + ': ' + s.triangles + ' triangles is over the ' + LIMITS.maxTriangles + ' budget');
  if (s.span && s.length && s.tableSpan && s.tableLength) {
    const a = s.span / s.length, b = s.tableSpan / s.tableLength;
    if (Math.abs(a - b) / b > 0.35) bad.push(key + ': span/length ' + a.toFixed(2) + ' does not fit the archetype (' + b.toFixed(2) + '): wrong "forward" axis, or the model is on its side or scaled by part');
  }
  return bad;
}
// installed files vs manifest: every html/models/*.glb must have a manifest entry (by archetype), and every index entry must too
function checkInstalled(files, index, m) {
  const bad = [], byArch = {};
  for (const k of Object.keys((m && m.models) || {})) byArch[m.models[k].archetype] = k;
  for (const f of files) { const a = f.replace(/\.glb$/, ''); if (!byArch[a]) bad.push(f + ': installed but there is no manifest entry for archetype "' + a + '"'); }
  for (const a of Object.keys((index && index.models) || {})) {
    const e = index.models[a];
    if (!byArch[a]) bad.push('index.json: "' + a + '" has no manifest entry');
    else { const me = m.models[byArch[a]]; if (me.licence !== e.licence || me.attribution !== e.attribution) bad.push('index.json: "' + a + '" differs from the manifest'); }
    if (files.indexOf(e.file) < 0) bad.push('index.json: "' + a + '" points at ' + e.file + ' which is not installed');
  }
  return bad;
}
module.exports = {ARCHETYPES, LICENCES, FORWARD, FIELDS, LIMITS, checkEntry, checkManifest, checkStats, checkInstalled};
