// 3D model frame-cost PROFILE (measurement, not a pass/fail check; the pass/fail budget is models3d-budget.js). In-page, no screenshots.
// For zoom 11/14/16/18/20 x 1/20/100/300 aircraft x terrain off/on it alternates "models on" and "models off" blocks of 30 frames inside ONE page load
// (>= 300 frames each) and reports p50 / p95 of
//   - the layer's own CPU time per frame (prepare = placement and buffer writes, render = three.js submit), from MLR.modelsStats.ring;
//   - the whole m.redraw() submit time with models on vs off;
//   - GPU time from EXT_disjoint_timer_query_webgl2 when the browser has it (software GL does not);
//   - the load average is recorded by the caller. Software GL numbers are RELATIVE only: rasterisation happens outside JS.
// Synthetic aircraft are laid out on a screen grid around the centre (MLR.modelTestPlanes) so N are in view at every zoom; the real planes are untouched.
// window.PROF = {zooms, counts, terrain: [false, true], frames: 300, block: 30}. Prints {rows, gpu, noise}.
(async () => {
  const w = ms => new Promise(r => setTimeout(r, ms));
  const P = Object.assign({zooms: [11, 14, 16, 18, 20], counts: [1, 20, 100, 300], terrain: [false, true], frames: 300, block: 30}, window.PROF || {});
  for (let i = 0; i < 240 && !((typeof MLR != 'undefined') && MLR.map && MLR.map.loaded() && [...MLR.planes.values()].some(e => e.plane.position && e.plane.proj)); i++) await w(500);
  const m = MLR.map, rows = [], failures = [];
  const idle = () => new Promise(r => { let t = setTimeout(r, 3000); m.once('idle', () => { clearTimeout(t); r(); }); m.triggerRepaint(); });
  const pct = (a, q) => { if (!a.length) return null; const s = Array.from(a).sort((x, y) => x - y); return +s[Math.min(s.length - 1, Math.floor(s.length * q))].toFixed(2); };
  const TYPES = ['A320', 'B738', 'B77W', 'E190', 'C172', 'AT72', 'A388', 'C56X', 'EC35', 'PA34'];
  function build(N) {
    const map = new Map(), arr = [], W = m.getContainer().clientWidth, H = m.getContainer().clientHeight, cols = Math.max(1, Math.ceil(Math.sqrt(N * W / H))), rowsN = Math.ceil(N / cols);
    for (let i = 0; i < N; i++) {
      const sx = W * 0.1 + ((i % cols) + 0.5) * (W * 0.8 / cols), sy = H * 0.45 + (Math.floor(i / cols) + 0.5) * (H * 0.5 / rowsN);
      const u = m.unproject([sx, sy]), ll = [u.lng, u.lat], code = TYPES[i % TYPES.length];
      const plane = {icao: 'tst' + i, proj: mapgeo.fromLonLat(ll), position: ll, altitude: 3000 + (i * 97) % 30000, alt_geom: 3200 + (i * 97) % 30000, icaoType: code, true_heading: (i * 37) % 360, track: (i * 37) % 360, gs: 240, category: 'A3'};
      const arch = MODELS.archetypeFor(code, {category: 'A3'}), dm = MODELS.dimsFor(code, arch), f = MODELS.scaleFactor(dm.length, ll[1], m.getZoom(), 28), mpp = MODELS.metresPerPixel(ll[1], m.getZoom());
      map.set(plane.icao, {plane, dLL: ll, fillColor: '#8899cc', sel: false});
      arr.push({icao: plane.icao, arch, ai: MODELS.ARCHETYPES.indexOf(arch), span: dm.span, length: dm.length, f, px: dm.length * f / mpp});
    }
    return {map, arr};
  }
  const sel0 = MLR.modelsSelect; MLR.modelsSelect = function () {};             // the harness owns the model set while it runs
  const pl = [...MLR.planes.values()].map(e => e.plane).find(p => p.position && p.proj);
  m.jumpTo({center: pl.position, zoom: 12}); await idle();
  MLR.setView('3d'); await w(4500); await idle();
  if (!MLR.modelsActive()) failures.push('models are not active');
  const st = MLR.modelsStats; st.timing = true;
  const gl = m.painter.context.gl;
  const buf = new Uint8Array(4);
  const out = {gpuExt: !!gl.getExtension('EXT_disjoint_timer_query_webgl2'), renderer: (() => { try { const x = gl.getExtension('WEBGL_debug_renderer_info'); return x ? gl.getParameter(x.UNMASKED_RENDERER_WEBGL) : 'unknown'; } catch (e) { return 'unknown'; } })()};
  for (const terrainOn of P.terrain) {
    try { window.terrain3d = terrainOn; MLR.terrainSync(); } catch (e) { /* terrain unavailable */ }
    await w(terrainOn ? 6000 : 500);
    for (const z of P.zooms) for (const N of P.counts) {
      m.jumpTo({center: pl.position, zoom: z, pitch: 55, bearing: 0}); await w(400);
      const set = build(N); MLR.modelTestPlanes = set.map;
      const onA = [], offA = [], prep = [], rend = []; let drawn = 0, culled = 0;
      const blocks = Math.ceil(P.frames / P.block);
      st.ring.n = 0;
      for (let b = 0; b < blocks; b++) {
        for (const on of [true, false]) {
          MLR.modelArr = on ? set.arr : []; MLR.modelSet.clear();
          for (let i = 0; i < 3; i++) m.redraw();                                  // settle
          const n0 = st.ring.n;
          for (let i = 0; i < P.block; i++) { const t = performance.now(); m.redraw(); (on ? onA : offA).push(performance.now() - t); }
          if (on) { drawn = st.drawn; culled = st.culled; }
          if (on) for (let i = n0; i < st.ring.n; i++) { prep.push(st.ring.prep[i % 1024]); rend.push(st.ring.rend[i % 1024]); }
        }
      }
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, buf);
      const row = {terrain: terrainOn, zoom: z, aircraft: N, drawn, culled, frames: onA.length,
        redrawOn: [pct(onA, .5), pct(onA, .95)], redrawOff: [pct(offA, .5), pct(offA, .95)], layerPrep: [pct(prep, .5), pct(prep, .95)], layerRender: [pct(rend, .5), pct(rend, .95)]};
      row.addedP50 = +(row.redrawOn[0] - row.redrawOff[0]).toFixed(2);
      row.layerCpuP50 = +((row.layerPrep[0] || 0) + (row.layerRender[0] || 0)).toFixed(2);
      row.noiseP95 = row.redrawOff[1];
      if (st.gpuSamples && st.gpuSamples.length) { row.gpuMs = [pct(st.gpuSamples, .5), pct(st.gpuSamples, .95)]; st.gpuSamples.length = 0; }
      rows.push(row);
    }
  }
  MLR.modelTestPlanes = null; MLR.modelsSelect = sel0; st.timing = false; try { window.terrain3d = false; MLR.terrainSync(); } catch (e) { /* ignore */ }
  out.gpuState = st.gpuState; out.tris = st.trisByArchetype; out.liftCostMs = window.LIFT && LIFT.cost;
  return {failures, rows, out};
})()
