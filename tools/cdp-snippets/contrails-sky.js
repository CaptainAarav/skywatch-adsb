// Contrails and the 3D sky (Phase 42 Part C), no screenshots. Contrails: OFF by default (setting false, no layer, no source); on in 3D they appear for a FIXTURE aircraft above the altitude
// threshold (fed positions over time) and not for one below it; off in 2D; switching off removes the layer and source. Sky: in 3D at pitch the style has a sky with the dark neutral palette
// and the neutral horizon colour; flat 2D has none; quality level 5+ drops it.
(async () => {
  const w = ms => new Promise(r => setTimeout(r, ms));
  const failures = [], out = {};
  const check = (n, ok, d) => { if (!ok) failures.push(n + (d !== undefined ? ' ' + JSON.stringify(d).slice(0, 200) : '')); };
  for (let i = 0; i < 240 && !((typeof MLR != 'undefined') && MLR.map && MLR.map.loaded() && typeof processAircraft === 'function'); i++) await w(500);
  try { useRouteAPI = false; } catch (e) { /* not defined */ }
  const oa = jQuery.ajax; jQuery.ajax = function (o) { if (!(o && o.url && o.url === routeApiUrl)) return oa.apply(this, arguments); const d = jQuery.Deferred(); setTimeout(() => d.resolve([]), 20); return d.promise(); };   // no route network for fixture callsigns
  const m = MLR.map; window.QUALITY_IGNORE_SOFTWARE = true; MLR.setQualityMode('high');
  check('contrails are off by default', MLR.contrailsOn() === false && !m.getLayer('tar-contrails') && !m.getSource('tar-contrails'));
  const mk = (hex, alt, k) => ({hex, type: 'adsb_icao', flight: 'FIX' + hex.slice(-3), lat: 51.5 + k * 0.01, lon: -0.5 + k * 0.01, alt_baro: alt, alt_geom: alt, gs: 450, track: 45, t: 'B738', category: 'A3', seen: 0, seen_pos: 0, messages: 100, rssi: -10});
  let k = 0; const feed = () => { k++; processAircraft(mk('abc111', 36000, k), false, false); processAircraft(mk('abc222', 8000, k), false, false); };
  MLR.setView('3d'); await w(2500); m.jumpTo({center: [-0.5, 51.5], zoom: 9}); await w(800);
  jQuery('#contrails').length; const tog = toggles && toggles['contrails']; check('the setting exists', !!tog);
  if (tog) tog.toggle ? tog.toggle() : tog.setState && tog.setState(true);
  MLR.contrailsSync();
  for (let i = 0; i < 7; i++) { feed(); await w(150); MLR.contrailsStep(true); }
  const src = m.getSource('tar-contrails');
  const n = MLR.contrailsStats ? MLR.contrailsStats.lines : -1;
  out.contrails = {on: MLR.contrailsOn(), layer: !!m.getLayer('tar-contrails'), features: n};
  check('on in 3D: the layer exists', !!m.getLayer('tar-contrails') && MLR.contrailsOn(), out.contrails);
  const ic = (MLR.contrailsStats && MLR.contrailsStats.icaos) || [];
  check('the fixture above the threshold has a contrail, the one below does not', ic.includes('abc111') && !ic.includes('abc222'), ic.slice(0, 5));
  MLR.setView('2d'); await w(1500);
  check('off in 2D: no layer', !m.getLayer('tar-contrails'));
  MLR.setView('3d'); await w(2000);
  if (tog) tog.toggle ? tog.toggle() : tog.setState && tog.setState(false);
  MLR.contrailsSync();
  check('off again: layer and source removed', !m.getLayer('tar-contrails') && !m.getSource('tar-contrails'));
  // sky
  m.jumpTo({pitch: 55}); m.fire('pitchend'); await w(500);
  const sky = m.getSky ? m.getSky() : null; out.sky = sky;
  check('3D at pitch has a sky', !!sky && /^#?[0-9a-f]{6}$/i.test(String(sky['horizon-color']).replace('#', '')) || (sky && sky['horizon-color']), sky);
  if (sky) {
    const hex = c => { const s = String(c); return /^#/.test(s) ? s : s; };
    const neutral = c => { const h = hex(c).replace('#', ''); const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16); return Math.max(r, g, b) - Math.min(r, g, b); };
    check('sky and fog colours are neutral greys', neutral(sky['sky-color']) <= 2 && neutral(sky['fog-color']) <= 2, [sky['sky-color'], sky['fog-color']]);
    check('the horizon band is a neutral grey too (spread <= 2)', neutral(sky['horizon-color']) <= 2, sky['horizon-color']);
  }
  MLR.setQualityMode('high'); const lvl5 = QUALITY.settings(5); check('level 5 drops the sky (setting)', lvl5.level === 5);
  m.jumpTo({pitch: 0}); MLR.setView('2d'); m.fire('pitchend'); await w(800);
  check('2D has no sky', !m.getSky || !m.getSky());
  jQuery.ajax = oa;
  return {failures, out};
})()
