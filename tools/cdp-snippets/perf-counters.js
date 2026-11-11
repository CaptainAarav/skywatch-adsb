// Device-independent render counters in 3D (Phase 42 Part B), no timing, no screenshots. For zoom 10/13/16/19 x terrain off/on x models off/on with 100 synthetic aircraft laid out on a screen
// grid (MLR.modelTestPlanes; the real planes are untouched) it records the PERFC snapshot (draw calls, triangles, uploads, tiles in flight, symbol layers, query rates, canvas size) after the
// map has been idle for a while, prints the table, and asserts the budgets (window.BUDGET overrides). Also checks the throttles: a burst of 300 mousemove events must cause at most one
// aircraft/pin pass per animation frame and none while the camera moves; terrain elevation queries per second stay under the cap with 100 aircraft; the pixel ratio cap holds.
(async () => {
  const w = ms => new Promise(r => setTimeout(r, ms));
  const failures = [], rows = [];
  const B = Object.assign({drawCallsP95: 1700, tilesInFlight: 24, queryRenderedPerSec: 60, queryTerrainPerSec: 120, canvasMP: 4.2, uploadsPerFrame: 8}, window.BUDGET || {});
  for (let i = 0; i < 240 && !((typeof MLR != 'undefined') && MLR.map && MLR.map.loaded() && [...MLR.planes.values()].some(e => e.plane.position && e.plane.proj)); i++) await w(500);
  const m = MLR.map, TYPES = ['A320', 'B738', 'B77W', 'E190', 'C172', 'AT72', 'A388', 'C56X', 'EC35', 'PA34'];
  const idle = () => new Promise(r => { let t = setTimeout(r, 4000); m.once('idle', () => { clearTimeout(t); r(); }); m.triggerRepaint(); });
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
  const sel0 = MLR.modelsSelect; MLR.modelsSelect = function () {};
  const pl = [...MLR.planes.values()].map(e => e.plane).find(p => p.position && p.proj);
  window.QUALITY_IGNORE_SOFTWARE = true; MLR.setQualityMode('high');                       // the counters are measured at the full level, not whatever Auto picked on this host
  m.jumpTo({center: pl.position, zoom: 12}); await idle();
  MLR.setView('3d'); await w(4500); await idle();
  PERFC.start(m);
  try {
    for (const terrainOn of [false, true]) {
      try { window.terrain3d = terrainOn; MLR.terrainSync(); } catch (e) { /* unavailable */ }
      await w(terrainOn ? 6000 : 500);
      for (const modelsOn of [false, true]) {
        MLR.setModelsWanted(modelsOn); await w(modelsOn ? 2500 : 600);
        for (const z of [10, 13, 16, 19]) {
          m.jumpTo({center: pl.position, zoom: z, pitch: 55, bearing: 0}); await w(300);
          const set = build(100); MLR.modelTestPlanes = set.map; MLR.modelArr = modelsOn ? set.arr : []; MLR.modelSet.clear();
          await idle(); for (let i = 0; i < 6; i++) { m.triggerRepaint(); await w(120); }
          PERFC.reset();                                              // measure only the 24 frames below, not the tile/style warm-up after the jump
          for (let i = 0; i < 24; i++) { m.redraw(); await w(30); }
          const s = PERFC.snapshot(), inflight = s.tiles.vector.inFlight + s.tiles.raster.inFlight + s.tiles.dem.inFlight;
          const row = {terrain: terrainOn, models: modelsOn, zoom: z, draws: s.drawCallsP50, drawsP95: s.drawCallsP95, tris: s.trianglesP50, uploads: +s.textureUploadsPerFrame.toFixed(2), tiny: +s.tinyUploadsPerFrame.toFixed(1), vecTiles: s.tiles.vector.loaded, rasTiles: s.tiles.raster.loaded, demTiles: s.tiles.dem.loaded,
            inFlight: inflight, symLayers: s.symbolLayersDrawn, symInst: s.tiles.symbolInstances, canvasMP: s.canvasMP, ratio: s.pixelRatio};
          rows.push(row);
          if (s.drawCallsP95 > B.drawCallsP95) failures.push('draw calls p95 over budget ' + JSON.stringify(row));
          if (inflight > B.tilesInFlight) failures.push('tiles in flight over budget ' + JSON.stringify(row));
          if (s.canvasMP > B.canvasMP) failures.push('canvas over ' + B.canvasMP + ' MP ' + JSON.stringify(row));
          if (s.textureUploadsPerFrame > B.uploadsPerFrame) failures.push('texture uploads per frame over budget ' + JSON.stringify(row));
        }
      }
    }
    // terrain elevation queries per second with terrain on, 100 aircraft, models on, over a 4 s window
    window.terrain3d = true; MLR.terrainSync(); MLR.setModelsWanted(true); await w(3000);
    m.jumpTo({center: pl.position, zoom: 14, pitch: 55}); const set = build(100); MLR.modelTestPlanes = set.map; MLR.modelArr = set.arr; MLR.modelSet.clear(); await idle();
    const q0 = PERFC.snapshot(); await w(4000); for (let i = 0; i < 20; i++) { m.redraw(); await w(100); }
    const q1 = PERFC.snapshot();
    const terrQ = q1.queryTerrainElevationPerSec; const qr = q1.queryRenderedFeaturesPerSec;
    if (terrQ > B.queryTerrainPerSec) failures.push('terrain elevation queries per second ' + terrQ + ' > ' + B.queryTerrainPerSec);
    // terrain elevation cache: 2000 lookups of aircraft in the same few ground cells within one frame must reach the map at most a handful of times
    const tq0 = (() => { let n = 0; const o = m.queryTerrainElevation; m.queryTerrainElevation = function () { n++; return o.apply(this, arguments); }; return {get n() { return n; }, restore() { m.queryTerrainElevation = o; }}; })();
    MLR.terrainElevCacheClear(); for (let i = 0; i < 2000; i++) MLR.terrainElev([pl.position[0] + (i % 8) * 0.0001, pl.position[1] + (i % 5) * 0.0001]);
    const cacheCalls = tq0.n; tq0.restore();
    if (cacheCalls > 40) failures.push('terrain elevation cache: ' + cacheCalls + ' map queries for 2000 lookups in 40 ground cells');
    // hover: 300 mousemove events in one task; the handlers must do at most one pass per animation frame and nothing while the camera moves
    const cv = m.getCanvas(), r = cv.getBoundingClientRect(); let frames = 0; const fr = () => { frames++; requestAnimationFrame(fr); }; requestAnimationFrame(fr);
    const before = PERFC.snapshot().queryRenderedFeaturesPerSec; await w(1100);
    const rq0 = performance.now(); let calls0 = 0; const oq = m.queryRenderedFeatures; m.queryRenderedFeatures = function () { calls0++; return oq.apply(this, arguments); };
    const f0 = frames;
    for (let i = 0; i < 300; i++) cv.dispatchEvent(new MouseEvent('mousemove', {clientX: r.left + 200 + (i % 50), clientY: r.top + 300, bubbles: true}));
    await w(1500); const burstCalls = calls0, burstFrames = frames - f0;
    if (burstCalls > Math.max(4, burstFrames * 2)) failures.push('hover: ' + burstCalls + ' queryRenderedFeatures for 300 events in ' + burstFrames + ' frames (not throttled)');
    calls0 = 0; m.easeTo({center: [pl.position[0] + 0.05, pl.position[1]], duration: 800});
    await w(100); for (let i = 0; i < 300; i++) cv.dispatchEvent(new MouseEvent('mousemove', {clientX: r.left + 200 + (i % 50), clientY: r.top + 300, bubbles: true}));
    const during = calls0; await w(1200); m.queryRenderedFeatures = oq;
    if (during > 0) failures.push('hover work ran while the camera moved: ' + during + ' queries');
    // the pixel ratio cap: a 3x device on a big canvas never exceeds 4 MP in 3D
    const cap = QUALITY.pixelRatio(0, 3, m.getContainer().clientWidth, m.getContainer().clientHeight);
    const mp = m.getContainer().clientWidth * m.getContainer().clientHeight * cap * cap / 1e6;
    if (mp > 4.2 + 1e-9 && cap > 1) failures.push('pixel ratio cap allows ' + mp.toFixed(2) + ' MP');
    window.__counters = {cacheCalls, terrQ, qr, burstCalls, burstFrames, duringMove: during, capRatio: cap, capMP: +mp.toFixed(2), renderer: MLR.gpuRenderer(), software: MLR.qualityInfo().software, tier: MLR.qualityInfo().tier};
  } catch (e) { failures.push('exception ' + (e && e.stack || e).toString().slice(0, 300)); }
  MLR.modelTestPlanes = null; MLR.modelsSelect = sel0; PERFC.stop(); MLR.setQualityMode('auto');
  return {failures, budget: B, rows, extra: window.__counters};
})()
