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
  const md = MLR.modelSet.get(pl.icao); numbers.archetype = md && md.arch; numbers.screenPx = md && Math.round(md.px);
  numbers.drawn = MLR.modelsStats.drawn; numbers.byArchetype = MLR.modelsStats.byArchetype;

  // ---- gl.readPixels at the aircraft's projected position: models on vs off, icons hidden in both so only the model can be there ----
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
  check('3D toggle off: the layer is gone and the same position is background', !m.getLayer('tar-models3d') && offNon * 3 < Math.max(onNon, 3), numbers.nonBackgroundPixelsOff);
  check('3D toggle off: icons are the aircraft again (no model term hides them)', JSON.stringify(m.getPaintProperty('tar-planes', 'icon-opacity')).indexOf('"m"') < 0);
  check('toggle off: GPU resources disposed', MLR.modelsStats.disposals >= 1 && !MLR.modelsStats.loaded);
  MLR.setModelsWanted(true); await w(1500); await idle();
  check('toggle on again: layer back', !!m.getLayer('tar-models3d'));
  hideIcons(false);

  // ---- selecting a model aircraft: click goes through the icon hit target (closestPlane over the model size) ----
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
