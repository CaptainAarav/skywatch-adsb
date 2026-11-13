// 2D aircraft icon colour test (ImageData assertions, no screenshots). Run at 1440x900 desktop against a page with live or fake aircraft.
// For every combination of  2D "Aircraft colour" (white / altitude)  x  3D "Aircraft colour" (realistic / altitude)  x  3D models wanted (off / on, view stays 2D)
// x  3D height (compressed / realistic)  x  dim-others state (off; it only applies while an aircraft is selected)  it reads the bitmap MapLibre really holds for each aircraft's icon (map.getImage) and asserts:
//   - 2D white (the default): the icon fill is pure white (or the stale grey #8f8f8f for a stale position, or the emergency colour), never a mid grey, in EVERY 3D setting;
//   - 2D altitude: the icon fill equals the altitude gradient colour of that aircraft (hslToRgb(getMarkerColor()));
//   - the 3D-only setting never changes a 2D icon bitmap (bitmaps identical across the 3D settings for the same 2D setting);
//   - the layer's icon-opacity paint is 1 when nothing is selected (no leaked 3D fade or dimming).
// Prints {checks, failures, numbers}.
(async () => {
  const w = ms => new Promise(r => setTimeout(r, ms));
  const checks = {}, failures = [], numbers = {rows: []};
  const check = (n, v, note) => { checks[n] = !!v; if (!v) failures.push(n + (note !== undefined ? ' ' + JSON.stringify(note) : '')); };
  for (let i = 0; i < 120 && !((typeof MLR != 'undefined') && MLR.map && MLR.map.loaded() && MLR.planes.size > 3); i++) await w(500);
  const m = MLR.map;
  check('enough aircraft on the map', MLR.planes.size > 3, MLR.planes.size);
  if (MLR.is3D) MLR.setView('2d');
  await w(500);
  const hex = c => { const s = String(c); const mm = /^#([0-9a-f]{6})$/i.exec(s); if (mm) return [0, 2, 4].map(i => parseInt(mm[1].slice(i, i + 2), 16)); const r = /rgba?\((\d+)[, ]+(\d+)[, ]+(\d+)/.exec(s); return r ? [+r[1], +r[2], +r[3]] : null; };
  // dominant opaque colour of an icon bitmap (outline pixels are darker and fewer; the fill is the most common opaque colour that is not the outline)
  const dominant = img => { const d = img.data, cnt = new Map(); for (let i = 0; i < d.length; i += 4) { if (d[i + 3] < 250) continue; const k = (d[i] >> 2) + ',' + (d[i + 1] >> 2) + ',' + (d[i + 2] >> 2); cnt.set(k, (cnt.get(k) || 0) + 1); }
    let best = null, n = 0; for (const [k, c] of cnt) if (c > n) { n = c; best = k; } return best ? best.split(',').map(x => (+x << 2) + 2) : null; };
  const near = (a, b, t) => a && b && Math.abs(a[0] - b[0]) <= t && Math.abs(a[1] - b[1]) <= t && Math.abs(a[2] - b[2]) <= t;
  const sig = {};                                                              // 2D setting -> icon signature across the 3D settings
  // what is really DRAWN: copy the canvas right after a redraw and take the brightest pixel in a small box around each aircraft (catches paint-side leaks: opacity, halo, tint)
  const probe = () => { m.redraw(); const cv = m.getCanvas(), c = document.createElement('canvas'); c.width = cv.width; c.height = cv.height; const x = c.getContext('2d', {willReadFrequently: true}); x.drawImage(cv, 0, 0);
    const r = cv.width / cv.clientWidth, out = []; const taken = [];
    const fc = new Map((MLR.planeFeats || []).map(f => [f.properties.hex, f.geometry.coordinates]));       // where the icon is DRAWN (smoothed), not the raw position
    for (const [icao, e] of MLR.planes) { const p = e.plane; if (!p.position || e.sel || !fc.has(icao)) continue; const pt = m.project(fc.get(icao)); if (pt.x < 30 || pt.y < 90 || pt.x > cv.clientWidth - 30 || pt.y > cv.clientHeight - 60) continue;
      const hit = document.elementFromPoint(pt.x, pt.y); if (!hit || hit !== cv) continue;                  // under a panel, the control stack or a popup: not a map pixel
      if (taken.some(t => Math.hypot(t[0] - pt.x, t[1] - pt.y) < 40)) continue; taken.push([pt.x, pt.y]);
      const bx = Math.round((pt.x - 8) * r), by = Math.round((pt.y - 8) * r), bw = Math.round(16 * r), d = x.getImageData(bx, by, bw, bw).data; let best = 0;
      for (let i = 0; i < d.length; i += 4) best = Math.max(best, Math.min(d[i], d[i + 1], d[i + 2]));
      const wb = Math.round(40 * r), wx = Math.max(0, Math.round(pt.x * r) - wb), wy = Math.max(0, Math.round(pt.y * r) - wb), ww = Math.min(2 * wb, cv.width - wx), wh = Math.min(2 * wb, cv.height - wy), dd = x.getImageData(wx, wy, ww, wh).data; let bestW = 0, at = null;
      for (let i = 0; i < dd.length; i += 4) { const v = Math.min(dd[i], dd[i + 1], dd[i + 2]); if (v > bestW) { bestW = v; at = [((i / 4) % ww + wx) / r - pt.x, Math.floor(i / 4 / ww + wy) / r - pt.y]; } }
      out.push({icao, best, stale: p.seen_pos > 15, wide: bestW, off: at && at.map(Math.round), shape: p.shape && p.shape.name, icon: e.icon && e.icon.slice(0, 20), pt: [Math.round(pt.x), Math.round(pt.y)]}); if (out.length >= 8) break; }
    return out; };
  const opacityOf = () => m.getPaintProperty('tar-planes', 'icon-opacity');
  const origColour = aircraftColor;
  for (const c2 of ['white', 'altitude']) for (const mc of ['realistic', 'altitude']) for (const mw of [false, true]) for (const hm of ['compressed', 'realistic']) {
    const dim = false;
    aircraftColor = c2; MLR.setModelColourMode(mc); MLR.setModelsWanted(mw); try { MLR.setModelHeightMode && MLR.setModelHeightMode(hm); } catch (e) {} MLR.setDimOthers(dim);
    for (const p of g.planesOrdered) { try { p.updateIcon(); } catch (e) { /* no shape yet */ } }
    MLR.touch('planes'); await w(450); m.triggerRepaint();
    let n = 0, bad = [], seen = [];
    for (const [icao, e] of MLR.planes) {
      if (!e.icon || !m.hasImage(e.icon)) continue;
      const img = m.getImage(e.icon); if (!img || !img.data) continue;
      const dom = dominant(img.data), p = e.plane; n++;
      const stale = !globeIndex && p.dataSource != 'adsc' && p.seen_pos > 15, emerg = atcStyle && ['7700', '7600', '7500'].includes(p.squawk);
      if (c2 === 'white') { const okWhite = near(dom, [255, 255, 255], 6), okStale = stale && near(dom, [143, 143, 143], 6), okEmerg = emerg; if (!(okWhite || okStale || okEmerg)) bad.push([icao, dom, e.fillColor, p.seen_pos]); }
      else { const want = hex(hslToRgb(p.getMarkerColor())); if (!near(dom, want, 8)) bad.push([icao, dom, want]); }
      seen.push(icao + ':' + dom.join('/'));
    }
    const key = [c2, mc, mw, hm, dim].join('|'), op = opacityOf();
    if (c2 === 'white') { const pr = probe().filter(q => !q.stale); check('rendered 2D white icons are bright (>= 225 min channel) : ' + key, pr.length > 0 && pr.every(q => q.best >= 225), pr.filter(q => q.best < 225).slice(0, 3)); numbers.probe = pr.length; }
    numbers.rows.push({key, icons: n, bad: bad.length});
    check('icons checked: ' + key, n > 0, n);
    check('2D ' + c2 + ' fill correct with 3D colour=' + mc + ' models=' + mw + ' height=' + hm + ' dim=' + dim, bad.length === 0, bad.slice(0, 3));
    check('icon-opacity is 1 with nothing selected: ' + key, op === 1, op);
    (sig[c2] = sig[c2] || []).push(seen.sort().join(';'));
  }
  // a round trip through the 3D view (models on, realistic) must leave the 2D icons exactly as they were
  aircraftColor = 'white'; MLR.setModelColourMode('realistic'); MLR.setModelsWanted(true);
  for (const v of ['3d', '2d']) { MLR.setView(v); await w(v === '3d' ? 4000 : 2500); }
  for (const p of g.planesOrdered) { try { p.updateIcon(); } catch (e) { /* no shape yet */ } }
  MLR.touch('planes'); await w(600);
  const back = probe().filter(q => !q.stale), op2 = opacityOf();
  check('after a 3D round trip the view is 2D', !MLR.is3D, MLR.is3D);
  check('after a 3D round trip the icon-opacity paint is back to 1', op2 === 1, op2);
  const bad1 = back.find(q => q.best < 225); if (bad1) { const e = MLR.planes.get(bad1.icao), p = e.plane, pt = m.project(p.position), f = (MLR.planeFeats || []).find(q => q.properties.hex === bad1.icao); numbers.bad = {icao: bad1.icao, icon: e.icon, hasImg: m.hasImage(e.icon), feat: !!f, fprops: f && f.properties, fcoord: f && f.geometry.coordinates, pos: p.position, pt: [pt.x, pt.y], shape: p.shape && p.shape.name, sel: e.sel, vis: p.visible, ontop: e.z}; }
  numbers.back = {pitch: m.getPitch(), bearing: m.getBearing(), active: MLR.modelsActive(), set: MLR.modelSet && MLR.modelSet.size, feats: (MLR.planeFeats || []).slice(0, 6).map(f => [f.properties.hex, f.properties.m, f.properties.sel]), lift: [...MLR.planes.values()].slice(0, 4).map(e => [e.mo, e.m, e.lift])};
  check('after a 3D round trip the drawn 2D icons are bright', back.length > 0 && back.every(q => q.best >= 225), [back.slice(0, 8), numbers.bad]);
  for (const c2 of Object.keys(sig).filter(k => k === 'white')) check('the 3D-only settings never change a 2D ' + c2 + ' icon bitmap', sig[c2].every(s => s === sig[c2][0]), 'bitmaps differ');
  aircraftColor = origColour; MLR.setModelsWanted(false);
  return {checks, failures, numbers: {combos: numbers.rows.length, sample: numbers.rows.slice(0, 3)}};
})()
