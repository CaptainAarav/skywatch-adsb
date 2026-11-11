// glTF aircraft model pipeline at runtime (Phase 42 Part C), no screenshots, no network, no real model file. A FIXTURE GLB (a box aircraft facing +Z, built in the page) is served for
// models/index.json and models/narrowbody.glb by a fetch override. Asserts: (1) fallback: with no index (the installed one is empty) nothing is loaded, nothing logs an error, the procedural
// archetypes still draw; (2) with the fixture the loader parses the GLB, normalises it (unit span and length, belly at z = 0, nose at +Y, fin part flagged), attaches an instanced mesh to the
// narrowbody slot; (3) the LOD: aircraft drawn at >= 90 px use the real model, smaller ones the archetype geometry, instancing preserved (one InstancedMesh each); (4) a broken GLB is
// ignored silently and the archetype remains; (5) the colour setting switches the shader mode; (6) the credits line appears for an attributed model.
(async () => {
  const w = ms => new Promise(r => setTimeout(r, ms));
  const failures = [], out = {};
  const check = (n, ok, d) => { if (!ok) failures.push(n + (d !== undefined ? ' ' + JSON.stringify(d).slice(0, 200) : '')); };
  for (let i = 0; i < 240 && !((typeof MLR != 'undefined') && MLR.map && MLR.map.loaded() && [...MLR.planes.values()].some(e => e.plane.position && e.plane.proj)); i++) await w(500);
  const m = MLR.map;
  window.QUALITY_IGNORE_SOFTWARE = true; MLR.setQualityMode('high');      // a software renderer forces the Low tier (no real models); this test needs the full tier
  const T = await import('./libs/three-0.170.0.module.min.js');
  // --- fixture GLB: box aircraft facing +Z (the glTF spec's front), 36 vertices non-indexed
  function boxTris(c, h) { const V = [[-1,-1,-1],[1,-1,-1],[1,1,-1],[-1,1,-1],[-1,-1,1],[1,-1,1],[1,1,1],[-1,1,1]], F = [[0,1,2,3],[4,7,6,5],[0,4,5,1],[2,6,7,3],[0,3,7,4],[1,5,6,2]], P = [], N = [];
    for (const q of F) for (const k of [[0,1,2],[0,2,3]]) for (const i of k) { P.push(c[0]+V[q[i]][0]*h[0], c[1]+V[q[i]][1]*h[1], c[2]+V[q[i]][2]*h[2]); N.push(0, 1, 0); } return {P, N}; }
  function glb(parts) {
    let P = [], N = []; for (const p of parts) { const b = boxTris(p.c, p.h); P = P.concat(b.P); N = N.concat(b.N); }
    const pos = new Float32Array(P), nor = new Float32Array(N), bin = new Uint8Array(pos.byteLength + nor.byteLength); bin.set(new Uint8Array(pos.buffer), 0); bin.set(new Uint8Array(nor.buffer), pos.byteLength);
    const min = [1e9, 1e9, 1e9], max = [-1e9, -1e9, -1e9]; for (let i = 0; i < P.length; i += 3) for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], P[i + k]); max[k] = Math.max(max[k], P[i + k]); }
    const json = {asset: {version: '2.0'}, scene: 0, scenes: [{nodes: [0]}], nodes: [{mesh: 0}], meshes: [{primitives: [{attributes: {POSITION: 0, NORMAL: 1}, material: 0}]}], materials: [{name: 'Fuselage'}],
      buffers: [{byteLength: bin.length}], bufferViews: [{buffer: 0, byteOffset: 0, byteLength: pos.byteLength}, {buffer: 0, byteOffset: pos.byteLength, byteLength: nor.byteLength}],
      accessors: [{bufferView: 0, componentType: 5126, count: P.length / 3, type: 'VEC3', min, max}, {bufferView: 1, componentType: 5126, count: P.length / 3, type: 'VEC3'}]};
    let js = new TextEncoder().encode(JSON.stringify(json)); const pad = (4 - js.length % 4) % 4; if (pad) { const j2 = new Uint8Array(js.length + pad).fill(32); j2.set(js); js = j2; }
    const total = 12 + 8 + js.length + 8 + bin.length, out = new Uint8Array(total), dv = new DataView(out.buffer);
    dv.setUint32(0, 0x46546C67, true); dv.setUint32(4, 2, true); dv.setUint32(8, total, true); dv.setUint32(12, js.length, true); dv.setUint32(16, 0x4E4F534A, true); out.set(js, 20);
    const o = 20 + js.length; dv.setUint32(o, bin.length, true); dv.setUint32(o + 4, 0x004E4942, true); out.set(bin, o + 8); return out.buffer;
  }
  const GOOD = glb([{c: [0, 3, 0], h: [2, 2, 18]}, {c: [0, 3, 2], h: [17, 0.2, 3]}, {c: [0, 7, -16], h: [0.2, 3, 3]}]);   // fuselage along Z, wings along X, fin at the rear (-Z faces back when facing +Z)
  const idxFix = {version: 1, models: {narrowbody: {file: 'narrowbody.glb', forward: '+z', author: 'Fixture', source: 'https://example.org/fixture', licence: 'CC0-1.0', attribution: 'Fixture jet by Test (CC0)'}}};
  const realFetch = window.fetch; let mode = 'none';
  window.fetch = function (u, o) {
    const s = String(u);
    if (/models\/index\.json/.test(s)) return mode === 'none' ? realFetch.apply(this, arguments) : Promise.resolve(new Response(JSON.stringify(idxFix), {status: 200}));
    if (/models\/narrowbody\.glb/.test(s)) return Promise.resolve(mode === 'broken' ? new Response(new Uint8Array([1, 2, 3, 4]).buffer, {status: 200}) : new Response(GOOD.slice(0), {status: 200}));
    return realFetch.apply(this, arguments);
  };
  const logs = []; const oe = console.error; console.error = function () { logs.push([].join.call(arguments, ' ')); return oe.apply(this, arguments); };
  try {
    const pl = [...MLR.planes.values()].map(e => e.plane).find(p => p.position && p.proj);
    m.jumpTo({center: pl.position, zoom: 15}); MLR.setView('3d'); await w(3000);
    for (let i = 0; i < 60 && !MLR.modelsActive(); i++) await w(300);
    check('the model layer is active', MLR.modelsActive());
    const layerImpl = () => m.getLayer('tar-models3d') && m.getLayer('tar-models3d').implementation, state = () => layerImpl()._s, ai = MODELS.ARCHETYPES.indexOf('narrowbody');
    // (1) fallback: the installed index is empty -> nothing loaded, no error, archetypes draw
    MLR.gltfState.indexTried = false; MLR.gltfState.index = null; MLR.gltfState.geos = {}; MLR.gltfState.failed = {}; MLR.gltfState.loading = {};
    MLR.gltfAttachAll(state(), T); await w(800);
    out.fallback = MLR.gltfStats();
    check('fallback: no model loaded when the index is empty', out.fallback.loaded.length === 0 && !state().hiByIndex[ai], out.fallback);
    check('fallback: the archetype meshes still exist', !!state().meshesByIndex[ai]);
    check('fallback: no error was logged', logs.length === 0, logs);
    // (2) fixture
    mode = 'good'; MLR.gltfState.indexTried = false; MLR.gltfState.index = null; MLR.gltfState.geos = {}; MLR.gltfState.failed = {}; MLR.gltfState.loading = {};
    MLR.gltfAttachAll(state(), T);
    for (let i = 0; i < 60 && !state().hiByIndex[ai]; i++) await w(250);
    const hi = state().hiByIndex[ai];
    check('the fixture model is attached to the narrowbody slot as an InstancedMesh', !!hi && hi.isInstancedMesh, MLR.gltfStats());
    if (hi) {
      const g = hi.geometry, p = g.attributes.position.array, parts = g.attributes.part.array;
      let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9, z0 = 1e9; for (let i = 0; i < p.length; i += 3) { x0 = Math.min(x0, p[i]); x1 = Math.max(x1, p[i]); y0 = Math.min(y0, p[i + 1]); y1 = Math.max(y1, p[i + 1]); z0 = Math.min(z0, p[i + 2]); }
      out.norm = {span: +(x1 - x0).toFixed(4), length: +(y1 - y0).toFixed(4), z0: +z0.toFixed(4), triangles: g.userData.triangles};
      check('normalised: unit span, unit length, belly at z = 0', Math.abs(x1 - x0 - 1) < 1e-3 && Math.abs(y1 - y0 - 1) < 1e-3 && Math.abs(z0) < 1e-4, out.norm);
      const fin = []; for (let i = 0; i < parts.length; i++) if (parts[i] === 2) fin.push(p[i * 3 + 1]);
      check('the tail fin is flagged and at the rear (-Y)', fin.length > 0 && fin.every(y => y < -0.2), fin.length);
      // (3) LOD: 4 big and 6 small narrowbody aircraft
      const set = new Map(), arr = [], c = pl.position;
      for (let i = 0; i < 10; i++) { const ll = [c[0] + i * 0.0004, c[1] + 0.0003], big = i < 4; const plane = {icao: 'lod' + i, proj: mapgeo.fromLonLat(ll), position: ll, altitude: 5000, alt_geom: 5200, icaoType: 'A320', true_heading: 90, track: 90, gs: 200, category: 'A3'};
        set.set(plane.icao, {plane, dLL: ll, fillColor: '#8899cc', sel: false}); arr.push({icao: plane.icao, arch: 'narrowbody', ai, span: 35.8, length: 37.6, f: 1, px: big ? 200 : 30}); }
      const sel0 = MLR.modelsSelect; MLR.modelsSelect = function () {}; MLR.modelTestPlanes = set; MLR.modelArr = arr; MLR.modelSet.clear(); m.setCenter(c);
      for (let i = 0; i < 6; i++) { m.redraw(); await w(150); }
      out.lod = {hiDrawn: MLR.modelsStats.hiDrawn, drawn: MLR.modelsStats.drawn, hiCount: hi.count, loCount: state().meshesByIndex[ai].count};
      check('LOD: aircraft >= 90 px use the real model', out.lod.hiCount === 4, out.lod);
      check('LOD: smaller aircraft keep the archetype geometry', out.lod.loCount === 6, out.lod);
      check('instancing preserved: one instanced mesh per slot (not one object per aircraft)', hi.isInstancedMesh && state().meshesByIndex[ai].isInstancedMesh);
      // (5) colour mode
      MLR.setModelColourMode('altitude'); check('Altitude mode sets the shader', state().mat.uniforms.uRealistic.value === 0);
      MLR.setModelColourMode('realistic'); check('Realistic mode sets the shader', state().mat.uniforms.uRealistic.value === 1);
      MLR.modelTestPlanes = null; MLR.modelsSelect = sel0;
    }
    // (6) credits line
    const cr = document.getElementById('modelCredits'); out.credits = cr ? cr.textContent : null;
    check('the credits line shows the attribution', !!cr && /Fixture jet by Test \(CC0\)/.test(cr.textContent) && !cr.hidden, out.credits);
    // (4) a broken file is ignored
    mode = 'broken'; MLR.gltfState.indexTried = false; MLR.gltfState.index = null; MLR.gltfState.geos = {}; MLR.gltfState.failed = {}; MLR.gltfState.loading = {};
    const before = state().hiByIndex[ai]; state().hiByIndex[ai] = undefined;
    MLR.gltfAttachAll(state(), T); await w(2500);
    check('a broken GLB is ignored: no mesh attached, failure recorded, no uncaught error', !state().hiByIndex[ai] && !!MLR.gltfStats().failed.narrowbody, MLR.gltfStats());
    state().hiByIndex[ai] = before;
    check('no console.error during the model pipeline', logs.length === 0, logs);
  } catch (e) { failures.push('exception ' + (e && e.stack || e).toString().slice(0, 300)); }
  window.fetch = realFetch; console.error = oe;
  return {failures, out};
})()
