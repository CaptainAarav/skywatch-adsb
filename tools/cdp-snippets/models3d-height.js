// True-3D height tests (in-page; no screenshots). Aircraft models stand at their true lon/lat with real height; this checks, with map.project and
// gl.readPixels only:
//  1. REALISTIC: the model-to-shadow screen offset never decreases as zoom increases (zoom 9 up to the camera plane), at pitch 30 and 60;
//  2. COMPRESSED: monotonic in altitude at every zoom, never decreasing with zoom, bounded by the cap;
//  3. the projected point of the 3D model equals the icon / hit target / label anchor (one picking system);
//  4. the model is really drawn where the projection says, also at street-level zoom (readPixels), in both height modes;
//  5. the setting persists. Prints the projection table in numbers.table.
(async () => {
  const w = ms => new Promise(r => setTimeout(r, ms));
  const checks = {}, failures = [], numbers = {table: []};
  const check = (n, ok, d) => { checks[n] = !!ok; if (!ok) failures.push(n + (d !== undefined ? ' ' + JSON.stringify(d).slice(0, 240) : '')); };
  const initialMode = MLR.modelHeightMode();
  const m = MLR.map, gl = m.painter ? m.painter.context.gl : null;
  const idle = () => new Promise(r => { let t = setTimeout(r, 2500); m.once('idle', () => { clearTimeout(t); r(); }); m.triggerRepaint(); });
  // FIXED FIXTURE: one injected aircraft (hex abc123, B738, 36 000 ft, fixed position, no callsign so no route lookup) built through the page's own processAircraft(); it is
  // re-injected every 300 ms so the feed's stale-aircraft cleanup never removes it. The live feed is never used for a measurement (live aircraft far from the fixture are irrelevant).
  const FIX = {hex: 'abc123', type: 'adsb_icao', lat: 51.4700, lon: -0.4543, alt_baro: 36000, alt_geom: 36200, gs: 420, track: 90, t: 'B738', category: 'A3', seen: 0, seen_pos: 0, messages: 100, rssi: -10};
  for (let i = 0; i < 240 && !((typeof MLR != 'undefined') && MLR.map && MLR.map.loaded() && typeof processAircraft === 'function'); i++) await w(250);
  const inject = () => processAircraft(Object.assign({}, FIX), false, false);
  inject(); const injT = setInterval(inject, 300);
  for (let i = 0; i < 120 && !(MLR.planes.get('abc123') && MLR.planes.get('abc123').plane.position && MLR.planes.get('abc123').plane.proj); i++) await w(250);
  if (!MLR.planes.get('abc123')) { clearInterval(injT); return {checks, failures: ['the injected fixture aircraft never appeared in the data layer'], numbers}; }
  const pl = MLR.planes.get('abc123').plane;
  const E = () => MLR.planes.get('abc123');
  const ALT_FT = 36000, ALT_M = ALT_FT * 0.3048;
  m.jumpTo({center: pl.position, zoom: 12}); await idle();
  MLR.setView('3d'); await w(4500); await idle();
  check('3D models are active', MLR.modelsActive());
  MLR.testAltM = ALT_M;
  const at = async (z, pitch, bearing) => { m.jumpTo({center: MLR.baseLL(E()), zoom: z, pitch, bearing: bearing || 0}); m.redraw(); await w(250); m.redraw(); };
  const offset = () => { const ll = MLR.baseLL(E()), sh = m.project(ll), po = MLR.modelPose(E(), ll, performance.now()); return po.ok ? {off: sh.y - po.y, x: po.x - sh.x, w: po.w, clamped: po.clamped} : null; };

  // ---- 1 + 2: tables ----
  for (const mode of ['realistic', 'compressed']) {
    MLR.setModelHeightMode(mode);
    for (const pitch of [30, 60]) {
      let prev = -1, prevZ = null, bad = null;
      for (let z = 9; z <= 20; z++) {
        await at(z, pitch);
        const o = offset(), mpp = MODELS.metresPerPixel(MLR.baseLL(E())[1], z);
        const expectedSin = ALT_M / mpp * Math.sin(pitch * Math.PI / 180), expectedCos = ALT_M / mpp * Math.cos(pitch * Math.PI / 180);
        numbers.table.push([mode, pitch, z, o ? +o.off.toFixed(1) : null, +expectedSin.toFixed(1), +expectedCos.toFixed(1), +(MLR.liftPxAlt(MLR.baseLL(E()), ALT_FT)).toFixed(1)]);
        if (o && !o.clamped && o.off >= 0) { numbers.unclamped = (numbers.unclamped || 0) + 1; if (o.off < prev - 0.5 && !bad) bad = {z, off: o.off, prev, prevZ}; prev = Math.max(prev, o.off); prevZ = z; }
        if (mode === 'compressed') check('compressed ' + pitch + ' z' + z + ': offset bounded by the cap', !o || o.off <= Math.min(LIFT.max, m.getContainer().clientHeight * 0.3) + 1, o && o.off);
      }
      numbers.table.push([mode, pitch, 'last zoom with the true height in front of the camera', prevZ]);
      check(mode + ' pitch ' + pitch + ': model-to-shadow screen offset never decreases as zoom increases (zoom 9 up to the camera plane)', !bad && prevZ >= 12, {bad, prevZ});
    }
  }
  // compressed: monotonic in altitude at several zooms
  MLR.setModelHeightMode('compressed');
  for (const z of [10, 13, 16, 19]) {
    await at(z, 55); let last = -1, ok = true; const seq = [];
    for (const alt of [0, 300, 1500, 4000, 9000, 12000]) { MLR.testAltM = alt; const o = offset(); seq.push(o ? +o.off.toFixed(1) : null); if (!o || o.off < last - 0.5) ok = false; if (o) last = o.off; }
    check('compressed: offset is monotonic in altitude at zoom ' + z, ok, seq);
  }
  MLR.testAltM = ALT_M;

  // ---- 3: one picking system: hit target, icon feature and label anchor all sit at the projected 3D point ----
  await at(13, 55);
  MLR.flush && MLR.flush(true); await w(900);
  numbers.dbg = {active: MLR.modelsActive(), wanted: MLR.modelsWanted(), set: MLR.modelSet.size, has: MLR.modelSet.has(pl.icao), is3D: MLR.is3D, pitch: m.getPitch(), inPlanes: MLR.planes.has(pl.icao), proj: !!pl.proj, pos: !!pl.position, cat: pl.category, e0same: MLR.planes.get(pl.icao) === E()};
  const ll = MLR.baseLL(E()), po = MLR.modelPose(E(), ll, performance.now());
  const anchor = MLR.drawnLL(E()), pa = m.project(anchor);
  check('icon / hit-target anchor projects to the model point (< 1 px)', po.ok && Math.hypot(pa.x - po.x, pa.y - po.y) < 1, [pa.x, pa.y, po.x, po.y]);
  const hit = MLR.closestPlane([po.x, po.y], 6);
  check('hit-testing at the projected model point finds the aircraft', !!hit && hit.icao === pl.icao);
  selectPlaneByHex(pl.icao, {follow: false}); await w(2200);
  MLR.flush(); const f0 = (MLR.planeFeats || []).find(f => f.properties.hex === pl.icao), pf = f0 && m.project(f0.geometry.coordinates);       // the feature the label layer is fed with, built just now
  const cur = MLR.baseLL(E()), po2 = MLR.modelPose(E(), cur, performance.now());
  check('label feature anchor equals the projected 3D point (< 1.5 px)', !!pf && po2.ok && Math.hypot(pf.x - po2.x, pf.y - po2.y) < 1.5, pf && [pf.x, pf.y, po2.x, po2.y]);
  check('the pill sits above the model (negative offset)', !!f0 && (Array.isArray(f0.properties.loff) ? f0.properties.loff : JSON.parse(f0.properties.loff))[1] < 0, f0 && f0.properties.loff);
  document.getElementById('infoblock_close').click(); await w(500);

  // ---- 4: rendered where projected, at every zoom incl. street level (float precision) ----
  const cv = m.getCanvas(), dpr = window.devicePixelRatio || 1, buf = new Uint8Array(4);
  const px = (x, y) => { gl.readPixels(Math.round(x * dpr), Math.round(cv.height - y * dpr), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, buf); return [buf[0], buf[1], buf[2]]; };
  const dist = (a, b) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);
  const HIDE = ['tar-planes', 'tar-planes-sel', 'tar-plane-glow', 'tar-plane-labels', 'tar-plane-labels-top'];
  const hide = on => { for (const id of HIDE) if (m.getLayer(id)) m.setLayoutProperty(id, 'visibility', on ? 'none' : 'visible'); for (const l of m.getStyle().layers) if (/^tar-lift/.test(l.id)) m.setLayoutProperty(l.id, 'visibility', on ? 'none' : 'visible'); };
  hide(true);
  numbers.drawn = {};
  for (const mode of ['compressed', 'realistic']) {
    MLR.setModelHeightMode(mode);
    for (const z of [12, 16, 18, 20]) {
      if (mode === 'realistic' && z > 15) continue;       // true height is above the camera at street level: nothing to see there by design
      MLR.testAltM = mode === 'realistic' ? 200 : ALT_M;
      m.jumpTo({center: MLR.baseLL(E()), zoom: z, pitch: 50, bearing: 0}); MLR.flush && MLR.flush(true); m.redraw(); m.redraw();
      const ll2 = MLR.baseLL(E()), p3 = MLR.modelPose(E(), ll2, performance.now()), d = MLR.modelSet.get(pl.icao);
      if (!p3.ok || !d) { check(mode + ' z' + z + ': aircraft is a model and in front of the camera', false, {ok: p3.ok, d: !!d}); continue; }
      const half = Math.max(5, Math.min(36, d.px * 0.4)), bg = px(Math.min(innerWidth - 4, p3.x + half * 3 + 40), Math.min(innerHeight - 4, p3.y + 120));
      const block = []; for (let i = -half; i <= half; i += 3) for (let j = -half; j <= half; j += 3) block.push(px(p3.x + i, p3.y - half * 0.3 + j));
      const non = block.filter(c => dist(c, bg) > 30).length;
      numbers.drawn[mode + ' z' + z] = non + '/' + block.length;
      check(mode + ' z' + z + ': the model is drawn at its projected point (readPixels)', non >= 6, numbers.drawn[mode + ' z' + z]);
    }
  }
  hide(false); MLR.testAltM = null;

  // ---- 5: persisted setting ----
  MLR.setModelHeightMode('realistic'); check('Realistic is stored', localStorage.getItem('modelHeight') === 'realistic' && MLR.modelHeightMode() === 'realistic');
  MLR.setModelHeightMode('compressed'); check('Compressed is stored', localStorage.getItem('modelHeight') === 'compressed');
  check('Settings > Map has the Aircraft height control with both options', !!document.querySelector('#heightSegmented [data-height="compressed"]') && !!document.querySelector('#heightSegmented [data-height="realistic"]'));
  check('the default is Compressed', initialMode === 'compressed', initialMode);
  clearInterval(injT);
  return {checks, failures, numbers};
})()
