// Airport click reliability (Part A of Phase 42), no screenshots. For BOTH entry points (a map marker click through MLR.onClick, and the route block's airport button) it checks, after
// the camera's own 'moveend', that: the airport panel is open for the right airport, the camera ended where the ONE fly policy says (airport at the free-area centre within 14 px, zoom >=
// the planned zoom), and follow is OFF (restored by the Back chip). States: aircraft selected with follow ON and OFF, 2D / 3D / Globe, pitch 0 and 60, during another flyTo, immediately after
// selecting an aircraft, airport already open, marker hidden by label collision (pin layers hidden: the hit test must use the airport DATA), an aircraft sitting on the marker (the airport must
// win), mid-transition (a second click while the first fly runs). Fixed fixture aircraft abc123, route stubbed to EGLL-ZZZZ.
(async () => {
  const w = ms => new Promise(r => setTimeout(r, ms));
  const failures = [], table = [];
  const check = (n, ok, d) => { if (!ok) failures.push(n + (d !== undefined ? ' ' + JSON.stringify(d).slice(0, 200) : '')); };
  for (let i = 0; i < 240 && !((typeof MLR != 'undefined') && MLR.map && MLR.map.loaded() && typeof processAircraft === 'function' && (typeof AIRPT != 'undefined')); i++) await w(250);
  await AIRPT.load();
  const m = MLR.map, $ = id => document.getElementById(id);
  const EGLL = [-0.461941, 51.4706], FIX = {hex: 'abc123', type: 'adsb_icao', flight: 'RUK1SX', lat: 51.9, lon: 0.3, alt_baro: 36000, alt_geom: 36200, gs: 420, track: 90, t: 'B738', category: 'A3', seen: 0, seen_pos: 0, messages: 100, rssi: -10};
  const inject = () => processAircraft(Object.assign({}, FIX), false, false);
  inject(); const injT = setInterval(inject, 300);
  const ROUTE = {callsign: 'RUK1SX', airline_code: 'RUK', number: '1SX', plausible: true, airport_codes: 'EGLL-ZZZZ', _airport_codes_iata: 'LHR-ZZZ',
    _airports: [{icao: 'EGLL', iata: 'LHR', name: 'London Heathrow Airport', location: 'London', countryiso2: 'GB', lat: 51.4706, lon: -0.461941, alt_feet: 83, alt_meters: 25.3}, {icao: 'ZZZZ', iata: '', name: 'Nowhere', location: 'N', countryiso2: 'GB', lat: 52, lon: -1, alt_feet: 1, alt_meters: 0}]};
  const oa = jQuery.ajax;
  jQuery.ajax = function (o) { if (!(o && o.url && o.url === routeApiUrl)) return oa.apply(this, arguments); const body = JSON.parse(o.data), d = jQuery.Deferred(); setTimeout(() => d.resolve(body.planes.map(p => Object.assign({}, ROUTE, {callsign: p.callsign}))), 30); return d.promise(); };
  const moveend = (ms) => new Promise(r => { let done = false; const f = () => { if (!done) { done = true; r(true); } }; m.once('moveend', () => setTimeout(f, 80)); setTimeout(() => { if (!done) { done = true; r(false); } }, ms); });
  const settle = async () => { for (let i = 0; i < 40 && (m.isMoving() || m.isEasing()); i++) await w(250); await w(200); };
  const closeApt = async () => { if (AIRPT.state.cur) { AIRPT.close(); await w(200); } };
  const pinIds = () => MLR.airportTierLayers().filter(id => m.getLayer(id));
  for (let i = 0; i < 60 && !(g.planes['abc123'] && g.planes['abc123'].position); i++) await w(250);
  check('fixture aircraft exists', !!g.planes['abc123']);
  g.route_cache = {}; g.route_check_todo = {}; g.route_check_checking = null; g.route_check_in_flight = false; g.route_last_lookup = 0;

  async function viewFar(pitch) { m.jumpTo({center: [EGLL[0] + 0.45, EGLL[1] + 0.3], zoom: 9.5, pitch: pitch || 0, bearing: 0}); await settle(); }
  function pinPoint() { const q = m.project(EGLL); return {x: q.x, y: q.y}; }
  async function viaMarker() { const p = pinPoint(); MLR.onClick({point: p, lngLat: m.unproject(p), preventDefault() {}}, false); }
  async function viaRoute() {
    const e = $('ib_route_from_e'); for (let t = 0; t < 20 && !(e && e.classList.contains('ibRouteLink') && e.offsetParent); t++) await w(250);
    if (e && e.classList.contains('ibRouteLink') && e.offsetParent) e.click();      // the real button when its panel is showing
    else AIRPT.openFromAircraft({icao: 'EGLL', iata: 'LHR'}, 'abc123', 'RUK1SX');   // panel hidden (airport already open) or not rendered yet: the same handler the button calls
  }
  function expectOpen(name, entry, followBefore) {
    const c = AIRPT.state.cur, f = AIRPT.state.lastFly, o = {name, entry};
    check(name + ': airport panel open for EGLL', c && c.icao === 'EGLL', c && c.icao);
    check(name + ': follow is off', typeof FollowSelected != 'undefined' && !FollowSelected, FollowSelected);
    if (f) {
      const q = m.project(f.center), W = m.getContainer().clientWidth, H = m.getContainer().clientHeight, ex = W / 2 + f.offset[0], ey = H / 2 + f.offset[1];
      o.errPx = Math.round(Math.hypot(q.x - ex, q.y - ey)); o.zoom = +m.getZoom().toFixed(2); o.planZoom = f.zoom; o.tier = f.tier;
      check(name + ': camera ended at the airport (free-area centre)', o.errPx <= 14, o);
      check(name + ': zoom reached the plan', m.getZoom() >= f.zoom - 0.1, o);
    } else check(name + ': a fly was issued', false);
    table.push(o);
  }
  async function run(name, setup, entry, opts) {
    opts = opts || {};
    await closeApt();
    if (opts.view !== undefined) { MLR.setView(opts.view); await settle(); }
    await viewFar(opts.pitch);
    selectPlaneByHex('abc123', {follow: !!opts.follow});
    if (opts.follow) toggleFollow(true);
    if (setup) await setup();
    if (!opts.noSettle) await settle();
    const ev = moveend(9000);
    if (entry === 'marker') await viaMarker(); else await viaRoute();
    if (opts.secondClick) { await w(300); if (entry === 'marker') await viaMarker(); else await viaRoute(); }
    await ev; if (opts.secondClick) await w(900); await settle();
    expectOpen(name, entry);
  }
  try {
    for (const entry of ['marker', 'route']) {
      await run('follow OFF 2D ' + entry, null, entry, {view: '2d'});
      await run('follow ON 2D ' + entry, null, entry, {view: '2d', follow: true});
      await run('pitch 60 follow OFF ' + entry, null, entry, {view: '2d', pitch: 60});
      await run('immediately after select ' + entry, null, entry, {view: '2d', noSettle: true});
      await run('during another flyTo ' + entry, async () => { m.flyTo({center: [EGLL[0] + 1.5, EGLL[1] - 1], zoom: 8, duration: 4000}); await w(300); }, entry, {view: '2d', noSettle: true});
      await run('airport already open (other airport) ' + entry, async () => { await AIRPT.open('EGKK', null, 'api'); await settle(); await viewFar(0); }, entry, {view: '2d'});
      await run('airport already open (same airport) ' + entry, async () => { await AIRPT.open('EGLL', null, 'api'); await settle(); await viewFar(0); }, entry, {view: '2d'});
      await run('second click while the first fly runs ' + entry, null, entry, {view: '2d', secondClick: true, noSettle: true});
      await run('3D follow ON ' + entry, null, entry, {view: '3d', follow: true});
      await run('3D follow OFF pitch 60 ' + entry, null, entry, {view: '3d', pitch: 60});
      if (typeof MAP_GLOBE != 'undefined' && MAP_GLOBE) await run('globe ' + entry, null, entry, {view: 'globe'});
    }
    // marker hidden by label collision: the pin layers are hidden, the data hit test must still open it
    await run('marker hidden by collision (pins not rendered)', async () => { for (const id of pinIds()) m.setLayoutProperty(id, 'visibility', 'none'); }, 'marker', {view: '2d'});
    for (const id of pinIds()) m.setLayoutProperty(id, 'visibility', 'visible');
    // an aircraft sitting on the marker: the airport must win inside its own hit area
    await closeApt(); MLR.setView('2d'); await settle(); m.jumpTo({center: EGLL, zoom: 10, pitch: 0}); await settle();
    FIX.lat = EGLL[1]; FIX.lon = EGLL[0]; inject(); await w(1500);
    selectPlaneByHex('abc123', {follow: false});
    let ev = moveend(9000); await viaMarker(); await ev; await settle();
    check('aircraft on the marker: the airport wins the click', AIRPT.state.cur && AIRPT.state.cur.icao === 'EGLL', AIRPT.state.cur && AIRPT.state.cur.icao);
    // Back restores follow
    await closeApt(); FIX.lat = 51.9; FIX.lon = 0.3; inject(); await viewFar(0);
    selectPlaneByHex('abc123', {follow: false}); toggleFollow(true); await settle();
    await viaRoute(); await settle();
    check('route entry ended follow', !FollowSelected);
    const bk = document.querySelector('#airport_panel .apBack'); if (bk) { bk.click(); await w(800); }
    check('Back restores follow', !!FollowSelected && !!SelectedPlane && SelectedPlane.icao === 'abc123', [FollowSelected]);
    // the URL entry and search use the same open()
    await closeApt(); await AIRPT.open('EGLL', null, 'url'); await w(300);
    check('open(code) opens by ICAO', AIRPT.state.cur && AIRPT.state.cur.icao === 'EGLL');
    check('there is one flyTo policy (fly) used by open()', typeof AIRPT.fly === 'function' && typeof AIRPT.flyPlan === 'function');
  } catch (e) { failures.push('exception ' + (e && e.stack || e).toString().slice(0, 300)); }
  clearInterval(injT); jQuery.ajax = oa;
  return {failures, table};
})()
