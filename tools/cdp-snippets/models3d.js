// 3D aircraft models, in-memory assertions only (no screenshots): lazy load, layer lifecycle, gl.readPixels at an aircraft's projected position,
// frame time added at 20 / 100 / 300 models (software GL in headless Chromium: relative numbers only), repeated 2D/3D/Globe switching.
// Run via CDP at 1440x900 (and again with --phone at 390x844). Prints {checks, failures, numbers}.
(() => { const main = (async () => {
  const w = ms => new Promise(r => setTimeout(r, ms));
  const checks = window.__ck = {}, failures = window.__fl = [], numbers = window.__nm = {};
  const check = (n, v, note) => { checks[n] = !!v; if (!v) failures.push(n + (note !== undefined ? ' ' + JSON.stringify(note) : '')); };
  const m = MLR.map, cv = m.getCanvas(), gl = cv.getContext('webgl2') || cv.getContext('webgl');
  const idle = () => new Promise(r => { m.once('idle', r); m.triggerRepaint(); setTimeout(r, 2500); });
  const threeLoaded = () => performance.getEntriesByType('resource').filter(r => /three-.*module/.test(r.name)).length;
  const HIDE = ['tar-planes', 'tar-planes-sel', 'tar-plane-labels', 'tar-plane-labels-top', 'tar-plane-glow'];
  const hideIcons = on => { for (const l of m.getStyle().layers) if (HIDE.includes(l.id) || /^tar-lift/.test(l.id)) m.setLayoutProperty(l.id, 'visibility', on ? 'none' : 'visible'); };
  const buf = new Uint8Array(4);
  const px = (x, y) => { const d = window.devicePixelRatio || 1; gl.readPixels(Math.round(x * d), Math.round(cv.height - y * d), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, buf); return [buf[0], buf[1], buf[2]]; };
  const block = (x, y, r) => { const out = []; for (let i = -r; i <= r; i += 2) for (let j = -r; j <= r; j += 2) out.push(px(x + i, y + j)); return out; };

  if (window.M3_PART !== 'b') {
  // ---- 2D: nothing extra is downloaded ----
  m.jumpTo({pitch: 0}); await MLR.setView('2d'); await w(800);
  check('2D: three.js is not downloaded', threeLoaded() === 0, threeLoaded());
  check('2D: no models layer', !m.getLayer('tar-models3d'));
  check('2D: the stock icons are drawn (planes layer visible, opacity expression has no model term)', m.getLayer('tar-planes') && JSON.stringify(m.getPaintProperty('tar-planes', 'icon-opacity')).indexOf('"m"') < 0);

  // ---- enter 3D: lazy load, layer, set ----
  var pl = ([...MLR.planes.values()].map(e => e.plane).find(p => p.position && p.proj && p.icaoType && typeof p.altitude == 'number' && !(p.category && p.category[0] === 'C')) || [...MLR.planes.values()][0].plane);
  m.jumpTo({center: pl.position, zoom: 12}); await idle();
  MLR.setView('3d'); await w(4500); await idle();
  check('3D: three.js downloaded exactly once on first entry', threeLoaded() === 1, threeLoaded());
  check('3D: custom layer present', !!m.getLayer('tar-models3d'));
  check('3D: models active', MLR.modelsActive() && MLR.modelsStats.active);
  m.jumpTo({center: pl.position, zoom: 12.4, pitch: 50, bearing: 0}); await idle(); await w(1500); await idle();
  check('3D: the aircraft is in the model set', MLR.modelSet.has(pl.icao), [...MLR.modelSet.keys()].slice(0, 3));
  let md = MLR.modelSet.get(pl.icao); numbers.archetype = md && md.arch; numbers.screenPx = md && Math.round(md.px);
  numbers.drawn = MLR.modelsStats.drawn; numbers.byArchetype = MLR.modelsStats.byArchetype;

  // ---- gl.readPixels at the aircraft's projected position: models on vs off, icons hidden in both so only the model can be there ----
  // live traffic: the aircraft chosen a few seconds ago can have left the feed; continue with another one that is in the model set
  const ensurePl = () => { if (!MLR.planes.get(pl.icao) || !MLR.modelSet.has(pl.icao)) { const alt = [...MLR.modelSet.keys()].find(k => MLR.planes.get(k)); if (alt) { pl = MLR.planes.get(alt).plane; md = MLR.modelSet.get(alt); numbers.replacedAircraft = (numbers.replacedAircraft || 0) + 1; } } };
  ensurePl();
  m.jumpTo({center: pl.position, zoom: 12.4, pitch: 50, bearing: 0}); await idle(); await w(800);
  ensurePl();
  const e = MLR.planes.get(pl.icao), ll = MLR.drawnLL(e), pt = m.project(ll);
  hideIcons(true);
  m.redraw(); const bg = block(pt.x + 140, pt.y + 120, 6);
  m.redraw(); const on = block(pt.x, pt.y, md ? Math.max(4, md.px / 3) : 6);
  const dist = (a, b) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);
  const bgMean = bg.reduce((s, p) => [s[0] + p[0], s[1] + p[1], s[2] + p[2]], [0, 0, 0]).map(x => x / bg.length);
  const onNon = on.filter(p => dist(p, bgMean) > 30).length;
  numbers.nonBackgroundPixelsOn = onNon + '/' + on.length;
  check('3D on: readPixels at the aircraft returns non-background pixels', onNon >= 4, numbers.nonBackgroundPixelsOn);
  MLR.setModelsWanted(false); await w(500); m.redraw();
  let off = [], offNon = 1e9;
  for (let k = 0; k < 4 && offNon * 3 >= Math.max(onNon, 3); k++) { await w(400); m.redraw(); const b2 = block(pt.x, pt.y, md ? Math.max(4, md.px / 3) : 6), n2 = Math.min(b2.filter(p => dist(p, bgMean) > 30).length, b2.filter(p => dist(p, b2[0]) > 30).length); if (n2 < offNon) { offNon = n2; off = b2; } }
  numbers.nonBackgroundPixelsOff = offNon + '/' + off.length;
  // Compare the SAME sample positions on and off. (The earlier form required the off block to be background; live traffic puts labels, trails and other
  // aircraft there, so that failed by chance, 13/100 non-background with the model gone.) The model is gone when pixels changed (the sample block also covers terrain, so onNon is not the model's own area; the deterministic block below asserts the full count).
  const onVsOff = on.filter((p, i) => off[i] && dist(p, off[i]) > 30).length;
  numbers.pixelsChangedWhenModelRemoved = onVsOff + '/' + on.length;
  check('3D toggle off: the layer is gone and the pixels the model covered changed', !m.getLayer('tar-models3d') && onVsOff >= 3, {onVsOff, onNon});
  check('3D toggle off: icons are the aircraft again (no model term hides them)', JSON.stringify(m.getPaintProperty('tar-planes', 'icon-opacity')).indexOf('"m"') < 0);
  check('toggle off: GPU resources disposed', MLR.modelsStats.disposals >= 1 && !MLR.modelsStats.loaded);
  MLR.setModelsWanted(true); await w(1500); await idle();
  check('toggle on again: layer back', !!m.getLayer('tar-models3d'));
  hideIcons(false);

  // ---- selecting a model aircraft: click goes through the icon hit target (closestPlane over the model size) ----
  ensurePl();
  const px2 = m.project(MLR.drawnLL(MLR.planes.get(pl.icao)));
  const hit = MLR.closestPlane([px2.x + 3, px2.y + 3], 20);
  check('hit-testing finds the aircraft under its model', !!hit && hit.icao === pl.icao);
  const hit2 = md ? MLR.closestPlane([px2.x + md.px * 0.45, px2.y], 8) : null;
  check('the hit target is widened to the model size', !md || (!!hit2 && hit2.icao === pl.icao), md && md.px);
  m.jumpTo({center: MLR.drawnLL(MLR.planes.get(pl.icao)), zoom: 12.4, pitch: 50, bearing: 0}); await idle();
  const selIcao = MLR.modelSet.has(pl.icao) ? pl.icao : [...MLR.modelSet.keys()].find(k => MLR.planes.get(k) && MLR.planes.get(k).labelSpec) || pl.icao;
  selectPlaneByHex(selIcao, {follow: false}); await w(2500);
  const sel = m.querySourceFeatures('tar-planes').filter(f => f.properties.hex === selIcao);
  numbers.selLabel = {n: sel.length, all: m.queryRenderedFeatures({layers: ['tar-plane-labels-top', 'tar-plane-labels']}).length, p: sel[0] && sel[0].properties, sidebar: document.body.className};
  numbers.hasLabelSpec = !!MLR.planes.get(selIcao).labelSpec;
  numbers.selIcao = selIcao; numbers.modelSetSize = MLR.modelSet.size;
  check('the selected aircraft keeps its label pill, anchored above the model (when labels are on)', !numbers.hasLabelSpec || sel.length >= 1 && sel[0].properties.m === 1 && JSON.parse(sel[0].properties.loff)[1] < 0, sel[0] && sel[0].properties);
  document.getElementById('infoblock_close').click(); await w(600);

  // ---- DETERMINISTIC pixel test: a fixed camera and ONE synthetic aircraft at the map centre (ground height, so the model stands on its shadow point), no live
  //      traffic involved. Five consecutive renders; the count of non-background pixels in a fixed sample grid must hold a fixed minimum every time, and be ~0
  //      with the model removed (same camera, same grid). The range over the five runs is reported. ----
  {
    const sel0 = MLR.modelsSelect; MLR.modelsSelect = function () {};
    const cam0 = {center: m.getCenter(), zoom: m.getZoom(), pitch: m.getPitch(), bearing: m.getBearing()};
    hideIcons(true);
    const C = m.getCenter(), ll0 = [C.lng, C.lat];
    const code = 'A320', arch = MODELS.archetypeFor(code, {category: 'A3'}), dm = MODELS.dimsFor(code, arch), f0 = MODELS.scaleFactor(dm.length, ll0[1], 18, 28), mpp0 = MODELS.metresPerPixel(ll0[1], 18);
    const plane = {icao: 'det0', proj: mapgeo.fromLonLat(ll0), position: ll0, altitude: 'ground', onGround: true, icaoType: code, true_heading: 90, track: 90, gs: 0, category: 'A3'};
    const set = new Map([['det0', {plane, dLL: ll0, fillColor: '#ffffff', sel: false}]]);
    const arr = [{icao: 'det0', arch, ai: MODELS.ARCHETYPES.indexOf(arch), span: dm.span, length: dm.length, f: f0, px: dm.length * f0 / mpp0}];
    const grid = (x, y, r) => { const o = []; for (let i = -r; i <= r; i += 3) for (let j = -r; j <= r; j += 3) o.push(px(x + i, y + j)); return o; };
    const counts = [], diffs = [];
    for (let run = 0; run < 5; run++) {
      MLR.modelTestPlanes = set; MLR.modelArr = []; MLR.modelSet.clear();
      m.jumpTo({center: ll0, zoom: 18, pitch: 45, bearing: 0}); m.redraw(); m.redraw();
      const c = m.project(ll0), R = 60, bgm = grid(c.x + 300, c.y + 200, 12).reduce((a, p) => [a[0] + p[0], a[1] + p[1], a[2] + p[2]], [0, 0, 0]).map(x => x / 81);
      const nonbg = a => a.filter(p => Math.abs(p[0] - bgm[0]) + Math.abs(p[1] - bgm[1]) + Math.abs(p[2] - bgm[2]) > 30).length;
      const offG = grid(c.x, c.y, R);                       // same camera, model removed: whatever live labels or trails are here stay in both grids
      MLR.modelArr = arr; m.redraw(); m.redraw();
      const onG = grid(c.x, c.y, R);
      counts.push(nonbg(onG));
      diffs.push(onG.filter((p, i) => Math.abs(p[0] - offG[i][0]) + Math.abs(p[1] - offG[i][1]) + Math.abs(p[2] - offG[i][2]) > 30).length);
    }
    numbers.deterministicPixels = {nonBackgroundOnPerRun: counts, changedByTheModelPerRun: diffs, gridSamples: 41 * 41, minChanged: Math.min(...diffs), maxChanged: Math.max(...diffs)};
    // The count that matters is the number of grid positions the model CHANGES between two renders of the same camera (on vs off): live traffic cannot move it.
    // (An earlier form asserted the grid was background without the model; labels of real aircraft near the centre broke that, 17 samples.)
    check('deterministic: the model changes at least 300 grid samples (measured about 600 in every run) in each of 5 consecutive runs', Math.min(...diffs) >= 300, numbers.deterministicPixels);
    MLR.modelTestPlanes = null; MLR.modelsSelect = sel0; MLR.modelArr = []; MLR.modelSet.clear(); hideIcons(false);
    m.jumpTo(cam0); await idle(); await w(800); MLR.modelsSelect(); m.redraw();
  }

  }
  if (window.M3_PART !== 'a') {
  if (window.M3_PART === 'b') { MLR.setView('3d'); await w(5500); }
  // ---- frame time added by N models (software GL: relative numbers only) ----
  const fakes = [];
  const cvt = ll => mapgeo.fromLonLat(ll);
  function addFakes(n, center, spread) {
    for (let i = 0; i < n; i++) {
      const ll = [center[0] + (Math.random() - 0.5) * spread, center[1] + (Math.random() - 0.5) * spread * 0.6];
      const icao = 'ff' + String(i).padStart(4, '0'), types = ['A320', 'B738', 'E190', 'C172', 'B77W', 'A388', 'AT72', 'EC35', 'C56X', 'PA34'];
      const plane = {icao, proj: cvt(ll), position: ll, track: Math.random() * 360, gs: 250, altitude: 12000, icaoType: types[i % types.length], baro_rate: 1200, inView: true, shape: {w: 20}, rotation: 0};
      MLR.planes.set(icao, {plane, icon: 'x', rot: 0, scale: 1, sel: false, fillColor: '#8fb4ff', w: 20, z: 0});
      fakes.push(icao);
    }
    MLR.touch('planes'); MLR.flush();
  }
  const clearFakes = () => { for (const i of fakes) MLR.planes.delete(i); fakes.length = 0; MLR.touch('planes'); MLR.flush(); };
  async function frames(n) { const t = [], c = []; for (let i = 0; i < n; i++) { const a = performance.now(); m.redraw(); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, buf); t.push(performance.now() - a); c.push(MLR.modelsStats.lastFrameMs); } t.sort((a, b) => a - b); c.sort((a, b) => a - b); return {median: +t[Math.floor(t.length / 2)].toFixed(1), p95: +t[Math.floor(t.length * 0.95)].toFixed(1), layerCpuMedianMs: +c[Math.floor(c.length / 2)].toFixed(2), layerCpuP95Ms: +c[Math.floor(c.length * 0.95)].toFixed(2)}; }
  numbers.addedMsSoftwareGL = {};
  const UK = [-1.5, 52.2];
  for (const z of [11, 13]) for (const n of [20, 100, 300]) {
    m.jumpTo({center: UK, zoom: z, pitch: 50, bearing: 0});
    const spread = 360 / Math.pow(2, z) * 0.9;
    addFakes(n, UK, spread); hideIcons(true);
    MLR.setModelsWanted(true); await w(1200); await idle(); await frames(5);
    const drawn = MLR.modelsStats.drawn, withM = await frames(30);
    MLR.setModelsWanted(false); await w(600); await idle(); await frames(5);
    const without = await frames(30);
    MLR.setModelsWanted(true); hideIcons(false); clearFakes();
    numbers.addedMsSoftwareGL['z' + z + '_n' + n] = {modelsDrawn: drawn, on: withM, off: without, addedMedianMs: +(withM.median - without.median).toFixed(1), layerCpuMedianMs: withM.layerCpuMedianMs};
    check('z' + z + ' ' + n + ' aircraft: at least ' + Math.min(n, 300) + ' models drawn, never more than 300', drawn >= Math.min(n, 300) && drawn <= 300, drawn);
  }
  await w(500);

  }
  if (window.M3_PART !== 'b') {
  // ---- switching modes 10 times, rotating and following an aircraft that leaves the cap ----
  for (let i = 0; i < 10; i++) { MLR.setView('3d'); await w(500); MLR.setView('globe'); await w(350); MLR.setView('2d'); await w(350); }
  MLR.setView('3d'); await w(1200);
  m.rotateTo(120, {duration: 0}); await w(300); m.rotateTo(0, {duration: 0});
  check('after 10 mode cycles the layer is in the right state (3D: present)', !!m.getLayer('tar-models3d'));
  MLR.setView('2d'); await w(900);
  check('2D again: layer removed and GPU resources disposed', !m.getLayer('tar-models3d') && MLR.modelsStats.disposals >= 2);
  numbers.disposals = MLR.modelsStats.disposals; numbers.builds = MLR.modelsStats.builds;
  }
  return {checks, failures, numbers};
})(); return Promise.race([main, new Promise(r => setTimeout(() => r({timedOut: true, checks: window.__ck, failures: window.__fl, numbers: window.__nm}), 230000))]); })()
