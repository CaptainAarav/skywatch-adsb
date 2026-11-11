// Deterministic proxy for the airport layers' cost (the wall-clock cost is below the noise floor in software GL on a shared machine, see Bug B/D6).
// Counts, not milliseconds: it does NOT claim a frame-time target. Asserts
//   * the airport pins are a fixed small number of symbol layers on ONE source;
//   * queryRenderedFeatures count over the UK at zoom 5 / 7 / 9 stays under a per-zoom cap (the label-collision work is proportional to it);
//   * on an idle map nothing airport-related runs: zero source setData calls and at most one updateData call (weather refresh) in 15 s
//     (map renders are reported, not gated: aircraft motion repaints the map), so weather-ring updates per minute is at most the refresh rate and never per frame.
(async () => {
  const w = ms => new Promise(r => setTimeout(r, ms));
  for (let i = 0; i < 240 && !((typeof MLR != 'undefined') && MLR.map && MLR.map.loaded() && MLR._aptDb); i++) await w(500);
  const m = MLR.map, failures = [], numbers = {}, checks = {};
  const check = (n, v, note) => { checks[n] = !!v; if (!v) failures.push(n + (note !== undefined ? ' ' + JSON.stringify(note) : '')); };
  const L = MLR.airportTierLayers();
  numbers.symbolLayers = L.length;
  check('airport pins are 1-6 symbol layers', L.length >= 1 && L.length <= 6, L.length);
  check('every pin layer reads the one source tar-apts', L.every(id => m.getLayer(id) && m.getLayer(id).source === 'tar-apts'), L);
  const idle = () => new Promise(r => { m.once('idle', r); m.triggerRepaint(); setTimeout(r, 6000); });
  const caps = {5: 120, 7: 160, 9: 220};
  numbers.rendered = {};
  for (const z of [5, 7, 9]) {
    m.jumpTo({center: [-2, 53], zoom: z, pitch: 0, bearing: 0}); await idle(); await w(900); await idle();
    const n = new Set(m.queryRenderedFeatures({layers: L}).map(f => f.properties.icao)).size;
    numbers.rendered[z] = n;
    check('zoom ' + z + ' UK: rendered airports <= ' + caps[z], n <= caps[z], n);
  }
  // idle activity
  const src = m.getSource('tar-apts'); let sd = 0, ud = 0, renders = 0;
  const sd0 = src.setData, ud0 = src.updateData;
  src.setData = function () { sd++; return sd0.apply(this, arguments); };
  src.updateData = function () { ud++; return ud0.apply(this, arguments); };
  const onR = () => { renders++; }; m.on('render', onR);
  await idle(); await w(500); renders = 0; sd = 0; ud = 0;
  await w(15000);
  m.off('render', onR); src.setData = sd0; src.updateData = ud0;
  numbers.idle15s = {setData: sd, updateData: ud, renders, weatherUpdatesPerMinuteMax: ud * 4};
  check('idle map: no airport source setData in 15 s', sd === 0, sd);
  check('idle map: at most one weather updateData in 15 s', ud <= 1, ud);
  // renders are NOT gated: live aircraft motion repaints the map (65 renders in 15 s measured); they are reported only. Per-frame airport work would
  // show up as source updates, which are gated above.
  return {failures, checks, numbers};
})()
