// Run in the page via CDP (Runtime.evaluate, awaitPromise) at 1440x900, desktop. Assertions on queryRenderedFeatures, layer state and timings.
// 1. which airports are really rendered at zoom 5, 6, 7 and 9.5 over the UK
// 2. per-frame cost at zoom 5, 7, 9 with the airport layers on and off (software GL in headless Chromium: relative numbers only)
// 3. click and hover on a far-zoom dot, and the density setting
// Prints one JSON object {checks, failures, numbers}.
(async () => {
  const w = ms => new Promise(r => setTimeout(r, ms));
  const checks = {}, failures = [], numbers = {};
  const check = (n, v, note) => { checks[n] = !!v; if (!v) failures.push(n + (note !== undefined ? ' ' + JSON.stringify(note) : '')); };
  const m = MLR.map, L = MLR.airportTierLayers();
  for (let i = 0; i < 60 && !MLR._aptDb; i++) await w(500);
  check('airport database loaded into the pin source', !!MLR._aptDb);
  const db = MLR._aptDb, byIcao = new Map(db.a.map((r, i) => [r[0], i]));
  const idle = () => new Promise(r => { m.once('idle', r); m.triggerRepaint(); setTimeout(r, 6000); });
  // jump, then wait until symbol placement has SETTLED: the rendered airport set is identical on two consecutive samples (placement runs a beat after 'idle')
  async function at(zoom, center) {
    m.jumpTo({center, zoom, pitch: 0, bearing: 0}); await idle(); await w(900); await idle();
    let prev = null;
    for (let i = 0; i < 12; i++) { const k = [...new Set(m.queryRenderedFeatures({layers: L}).map(f => f.properties.icao))].sort().join(','); if (k === prev) break; prev = k; await w(700); }
  }
  const rendered = () => { const s = new Set(); for (const f of m.queryRenderedFeatures({layers: L})) s.add(f.properties.icao); return s; };
  const tiersOf = (set) => { const c = {}; for (const i of set) { const t = AIRTIERS.tierOf(db.a[byIcao.get(i)]); c[t] = (c[t] || 0) + 1; } return c; };

  // ---- 1. rendered airports ----
  const UK = [-2.0, 53.0];
  await at(5, UK);
  let r5 = rendered();
  // original expectation (restored): the flag marker shrinks and its padding tightens at far zoom (FAR ramp in airport-pin-style.js) so these all fit
  const want5 = ['EGLL', 'EGKK', 'EGGW', 'EGSS', 'EGCC', 'EGPH', 'EGPF'];
  for (const i of want5) check('zoom 5 renders ' + i, r5.has(i), {present: byIcao.has(i)});
  numbers.z5 = {count: r5.size, tiers: tiersOf(r5), missing: want5.filter(i => !r5.has(i))};

  await at(6, UK);
  const r6 = rendered(); const t6 = tiersOf(r6);
  check('zoom 6: no small airfields', !t6.regional && !t6.field && !t6.water, t6);
  const grass6 = [...r6].filter(i => { const rw = db.a[byIcao.get(i)][11]; return rw.length && rw.every(x => !AIRTIERS.isPaved(x[4])) && db.a[byIcao.get(i)][2] === 2; });
  check('zoom 6: no grass airfields', grass6.length === 0, grass6);
  numbers.z6 = {count: r6.size, tiers: t6};

  await at(7, [-1.5, 52.2]);
  const r7 = rendered();
  const med7 = ['EGGD', 'EGNX', 'EGTC'].filter(i => byIcao.has(i));
  numbers.z7 = {count: r7.size, tiers: tiersOf(r7), candidates: med7.map(i => [i, AIRTIERS.tierOf(db.a[byIcao.get(i)]), r7.has(i)])};
  check('zoom 7 renders at least one nearby airport (EGGD, EGNX or EGTC)', med7.some(i => r7.has(i)), numbers.z7.candidates);

  await at(9.5, [-0.76, 52.04]);
  const r95 = rendered();
  check('zoom 9.5 near Milton Keynes renders EGGW', r95.has('EGGW'));
  check('zoom 9.5 near Milton Keynes renders EGTC', r95.has('EGTC'));
  numbers.z95 = {count: r95.size, tiers: tiersOf(r95)};
  // a grass strip appears only at 10+
  await at(9.5, [-0.76, 52.04]);
  check('zoom 9.5: tiers rendered are only large, medium, regional', Object.keys(tiersOf(r95)).every(t => ['large', 'medium', 'regional'].includes(t)), tiersOf(r95));

  // ---- tier zoom ranges as set on the layers ----
  const o = MLR.airportOpts();
  for (const t of AIRTIERS.ORDER) {
    const lay = m.getLayer('tar-apt-' + t), z = AIRTIERS.tierZooms(t, o);
    check('layer ' + t + ' minzoom = ' + z.dot, Math.abs(lay.minzoom - z.dot) < 0.001, lay.minzoom);
  }
  // Fewer / More shift every tier by +1.5 / -1.5
  MLR.setAirportDensity('fewer'); check('Fewer: large dot at 5', Math.abs(m.getLayer('tar-apt-large').minzoom - 5) < 0.001);
  MLR.setAirportDensity('more'); check('More: large dot at 2', Math.abs(m.getLayer('tar-apt-large').minzoom - 2) < 0.001);
  MLR.setAirportDensity('normal'); check('Normal: large dot at 3.5', Math.abs(m.getLayer('tar-apt-large').minzoom - 3.5) < 0.001);
  check('density persisted in localStorage', (() => { try { return localStorage.getItem('airportLabels') === 'normal'; } catch (e) { return false; } })());

  // ---- never covers aircraft: the airport layers sit below every aircraft layer ----
  const order = m.getStyle().layers.map(l => l.id);
  const lastApt = Math.max(...L.map(id => order.indexOf(id))), firstAc = Math.min(...['tar-plane-glow', 'tar-plane-labels', 'tar-plane-labels-top', 'tar-planes'].filter(id => order.includes(id)).map(id => order.indexOf(id)));
  check('airport dots and labels draw below the aircraft icons and pills', lastApt < firstAc, {lastApt, firstAc});

  // ---- before/after: the same UK views with the PREVIOUS marker layout (24 px circle, 6 px padding, labels from each tier's dot zoom) applied temporarily ----
  {
    const saved = L.map(id => [id, m.getLayoutProperty(id, 'icon-size'), m.getLayoutProperty(id, 'icon-padding'), m.getLayoutProperty(id, 'text-field')]);
    for (const [id, , , tf] of saved) { m.setLayoutProperty(id, 'icon-size', 1); m.setLayoutProperty(id, 'icon-padding', 6); m.setLayoutProperty(id, 'text-field', ['step', ['zoom'], tf[4]].concat(tf.slice(5))); }
    const prev = {};
    for (const [z, c] of [[5, UK], [6, UK], [7, [-1.5, 52.2]]]) { await at(z, c); const s = rendered(); prev['z' + z] = {count: s.size, missingOf5: z === 5 ? want5.filter(x => !s.has(x)) : undefined}; }
    for (const [id, a, b, tf] of saved) { m.setLayoutProperty(id, 'icon-size', a); m.setLayoutProperty(id, 'icon-padding', b); m.setLayoutProperty(id, 'text-field', tf); }
    numbers.previousLayout24px = prev;
    await at(5, UK);
  }
  // ---- marker: flag in a circle, ring = category or neutral, code below, name only at the detail zoom ----
  await at(5, UK);
  const lay = m.getLayer('tar-apt-large');
  // far-zoom ramp: icon-size 0.5 -> 1 and icon-padding 1 -> 6 between zoom 3.5 and 8 (so the close-zoom look is exactly the old 24 px circle with 6 px padding)
  const ramp = (a, b) => JSON.stringify(['interpolate', ['linear'], ['zoom'], AIRPIN.FAR.z0, a, AIRPIN.FAR.full, b]);
  check('marker layout: icon-size ramp 0.5->1, icon padding ramp 0.5->6 (close zoom: 1, 6), text-anchor top, offset [0,1], optional text, text padding 3', JSON.stringify(m.getLayoutProperty('tar-apt-large', 'icon-size')) === ramp(AIRPIN.FAR.size0, 1) && m.getLayoutProperty('tar-apt-large', 'text-anchor') === 'top' && JSON.stringify(m.getLayoutProperty('tar-apt-large', 'text-offset')) === '[0,1]' && m.getLayoutProperty('tar-apt-large', 'text-optional') === true && JSON.stringify(m.getLayoutProperty('tar-apt-large', 'icon-padding')) === ramp(AIRPIN.FAR.pad0, 6) && m.getLayoutProperty('tar-apt-large', 'text-padding') === 3);
  const ids = new Set(); for (const f of m.queryRenderedFeatures({layers: L})) ids.add('flagc-' + f.properties.f + '-' + f.properties.w);
  await w(800);
  const have = [...ids].filter(i => m.hasImage(i));
  check('every rendered marker has its flag-in-circle sprite', have.length === ids.size, {missing: [...ids].filter(i => !m.hasImage(i)).slice(0, 5)});
  const px = (id) => { const im = m.style.getImage(id) || m.style.imageManager.images[id]; const d = im && (im.data.data || im.data); return im && {w: im.data.width, h: im.data.height, d}; };
  const gb = px('flagc-GB-N') || px([...ids][0]);
  if (gb) {
    const at2 = (x, y) => { const i = (y * gb.w + x) * 4; return [gb.d[i], gb.d[i + 1], gb.d[i + 2], gb.d[i + 3]]; };
    const mid = gb.w / 2;
    check('sprite is 48x48 (24 css px at pixelRatio 2)', gb.w === 48 && gb.h === 48, [gb.w, gb.h]);
    check('sprite corner is transparent (circle, not square)', at2(1, 1)[3] === 0);
    check('sprite centre is opaque (flag or dark fill)', at2(mid, mid)[3] === 255);
    check('neutral ring is grey, R=G=B', gb && (() => { const r = at2(mid, 1); return r[3] > 200 && r[0] === r[1] && r[1] === r[2]; })());
  } else check('sprite readable', false);
  MLR._pinCats = {}; const tgt = 'EGLL'; AIRPT.weatherCats = (() => { const o = AIRPT.weatherCats; return () => Object.assign({}, o(), {EGLL: 'IFR'}); })(); MLR.applyPinWeather(); await w(1500); await at(5, UK); await w(1500);
  const ifr = m.queryRenderedFeatures({layers: L}).find(f => f.properties.icao === tgt);
  check('weather update changes only the w property of the airport (IFR)', !!ifr && ifr.properties.w === 'IFR', ifr && ifr.properties.w);
  await w(800); const ip = px('flagc-GB-IFR');
  check('IFR ring sprite uses the IFR colour', !!ip && (() => { const i = (1 * ip.w + ip.w / 2) * 4; return Math.abs(ip.d[i] - 255) < 3 && Math.abs(ip.d[i + 1] - 107) < 3 && Math.abs(ip.d[i + 2] - 107) < 3; })(), ip && [ip.d[(ip.w / 2 + ip.w) * 4], ip.d[(ip.w / 2 + ip.w) * 4 + 1]]);
  // label text: code below the detail zoom, name only from it
  const tf = m.getLayoutProperty('tar-apt-large', 'text-field');
  // no label below AIRPIN.FAR.labelZoom (stop 1), the code from there, code + name from the detail zoom (last stop)
  check('label: none at the far zoom, the code from the label zoom, then code + name at the detail zoom', JSON.stringify(tf).indexOf('"step"') > -1 && tf[2] === '' && Math.abs(tf[3] - AIRPIN.FAR.labelZoom) < 0.001 && JSON.stringify(tf).indexOf('nm') > -1 && Math.abs(tf[tf.length - 2] - 8) < 0.001, tf && [tf[2], tf[3], tf[tf.length - 2]]);

  // ---- 2. per-frame cost (software GL) ----
  async function frame(zoom) {
    await at(zoom, UK);
    const t = [];
    for (let i = 0; i < 30; i++) { const a = performance.now(); m.redraw(); t.push(performance.now() - a); }
    t.sort((a, b) => a - b);
    return {median: +t[15].toFixed(1), p95: +t[28].toFixed(1)};
  }
  numbers.perFrameSoftwareGL = {};
  for (const z of [5, 7, 9]) {
    for (const id of L) m.setLayoutProperty(id, 'visibility', 'visible');
    const on = await frame(z);
    for (const id of L) m.setLayoutProperty(id, 'visibility', 'none');
    const off = await frame(z);
    for (const id of L) m.setLayoutProperty(id, 'visibility', 'visible');
    numbers.perFrameSoftwareGL['z' + z] = {airportLayersOn_ms: on, airportLayersOff_ms: off};
  }

  // ---- 3. click and hover on a far-zoom dot ----
  // pick a dot with no aircraft icon within 30 px, so the click is an airport click (an aircraft under the pointer would win)
  await at(5, UK);
  const icons = m.queryRenderedFeatures({layers: ['tar-planes']}).map(f => m.project(f.geometry.coordinates));
  const dots = m.queryRenderedFeatures({layers: L}).filter(f => ['EGPH', 'EGPF', 'EGCC', 'EGBB', 'EGGD', 'EGLL'].includes(f.properties.icao));
  const dot = dots.find(f => { const p = m.project(f.geometry.coordinates); return icons.every(q => Math.hypot(q.x - p.x, q.y - p.y) > 30); }) || dots[0];
  check('a dot with no aircraft beside it is hit-testable at zoom 5', !!dot);
  if (dot) {
    const icao = dot.properties.icao, rec = db.a[byIcao.get(icao)];
    const pt = m.project(dot.geometry.coordinates), cv = m.getCanvas(), rc = cv.getBoundingClientRect();
    const ev = (type, extra) => cv.dispatchEvent(new MouseEvent(type, Object.assign({bubbles: true, cancelable: true, clientX: rc.left + pt.x, clientY: rc.top + pt.y, button: 0, view: window}, extra)));
    ev('mousemove'); await w(500);
    check('hover on a dot shows the mini card', !!document.querySelector('.apPinCard'));
    const card = document.querySelector('.apPinCard'); numbers.hoverCard = card ? card.textContent.slice(0, 160) : null;
    check('the card names the airport', !!card && card.textContent.includes(icao === 'EGLL' ? 'Heathrow' : rec[3].split(' ')[0]), numbers.hoverCard);
    ev('mousedown'); ev('mouseup'); ev('click'); await w(3000);
    check('click on a dot opens the airport panel', document.body.classList.contains('airportOpen') && AIRPT.state.cur && AIRPT.state.cur.icao === icao, {body: document.body.className, icao});
    const c = m.getCenter(); check('click eases the map to the airport', Math.abs(c.lng - rec[5]) < 0.8 && Math.abs(c.lat - rec[4]) < 0.8, {center: [c.lng, c.lat], airport: [rec[5], rec[4]]});
    numbers.clicked = icao;
    AIRPT.close(); await w(500);
  }
  return {checks, failures, numbers};
})()
