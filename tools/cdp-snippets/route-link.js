// Route block airports are links (DOM test, no screenshots). A FIXED fixture aircraft (hex abc123, callsign RUK1SX) is injected through the page's own processAircraft(), and the
// route service is stubbed with a fixture route EGLL (in the airport database) -> ZZZZ (not in it), so no live aircraft and no route network are involved. Asserts:
//  - the origin is a button (role, tabindex, accessible name), the destination, which is not in the database, is plain text (no role, no tabindex, no link class);
//  - on a phone the link is at least 44 x 44 px;
//  - clicking the origin opens EGLL's airport panel exactly as a marker click does (AIRPT.state.cur), the aircraft STAYS selected, its panel is hidden behind the airport panel,
//    and a Back chip reads "‹ RUK1SX" and is a keyboard-reachable button;
//  - the Back chip returns to the aircraft panel (airport closed, the same aircraft selected and shown); Enter on the focused link does the same as a click; the airport's own close
//    control also leaves the aircraft selected and shown.
(async () => {
  const w = ms => new Promise(r => setTimeout(r, ms));
  const checks = {}, failures = [], numbers = {};
  const check = (n, ok, d) => { checks[n] = !!ok; if (!ok) failures.push(n + (d !== undefined ? ' ' + JSON.stringify(d).slice(0, 220) : '')); };
  for (let i = 0; i < 240 && !((typeof MLR != 'undefined') && MLR.map && MLR.map.loaded() && typeof processAircraft === 'function' && (typeof AIRPT != 'undefined')); i++) await w(250);
  const phone = document.body.classList.contains('phone');
  const FIX = {hex: 'abc123', type: 'adsb_icao', flight: 'RUK1SX', lat: 51.47, lon: -0.4543, alt_baro: 36000, alt_geom: 36200, gs: 420, track: 90, t: 'B738', category: 'A3', seen: 0, seen_pos: 0, messages: 100, rssi: -10};
  const inject = () => processAircraft(Object.assign({}, FIX), false, false);
  inject(); const injT = setInterval(inject, 300);
  const ROUTE = {callsign: 'RUK1SX', airline_code: 'RUK', number: '1SX', plausible: true, airport_codes: 'EGLL-ZZZZ', _airport_codes_iata: 'LHR-ZZZ',
    _airports: [{icao: 'EGLL', iata: 'LHR', name: 'London Heathrow Airport', location: 'London', countryiso2: 'GB', lat: 51.4706, lon: -0.461941, alt_feet: 83, alt_meters: 25.3},
                {icao: 'ZZZZ', iata: '', name: 'Nowhere Field', location: 'Nowhere', countryiso2: 'GB', lat: 52.0, lon: -1.0, alt_feet: 100, alt_meters: 30}]};
  const oa = jQuery.ajax;
  jQuery.ajax = function (o) {
    if (!(o && o.url && o.url === routeApiUrl)) return oa.apply(this, arguments);
    const body = JSON.parse(o.data), d = jQuery.Deferred();
    setTimeout(() => d.resolve(body.planes.map(p => Object.assign({}, ROUTE, {callsign: p.callsign}))), 30);
    return d.promise();
  };
  const vis = e => { if (!e) return false; for (let n = e; n && n !== document.documentElement; n = n.parentElement) { const c = getComputedStyle(n); if (c.display === 'none' || c.visibility === 'hidden' || n.hidden) return false; } const b = e.getBoundingClientRect(); return b.width > 0 && b.height > 0; };
  const $ = id => document.getElementById(id);
  try {
    await AIRPT.load();
    for (let i = 0; i < 60 && !(g.planes['abc123'] && g.planes['abc123'].position); i++) await w(250);
    check('the injected fixture aircraft exists', !!g.planes['abc123']);
    g.route_cache = {}; g.route_check_todo = {}; g.route_check_checking = null; g.route_check_in_flight = false; g.route_last_lookup = 0;
    selectPlaneByHex('abc123', {follow: false});
    if (phone) { await w(800); PHONE.goto(1); }
    for (let t = 0; t < 30 && !(vis($('ib_route')) && $('ib_route_from').textContent); t++) await w(500);
    check('the route card shows the fixture route', $('ib_route_from').textContent === 'LHR' && $('ib_route_to').textContent === 'ZZZZ', [$('ib_route_from').textContent, $('ib_route_to').textContent]);
    for (let t = 0; t < 20 && !$('ib_route_from_e').classList.contains('ibRouteLink'); t++) await w(300);
    const from = $('ib_route_from_e'), to = $('ib_route_to_e');
    check('origin (in the database) is a button', from.getAttribute('role') === 'button' && from.tabIndex === 0 && from.classList.contains('ibRouteLink') && /Open airport/.test(from.getAttribute('aria-label') || ''), [from.getAttribute('role'), from.tabIndex, from.getAttribute('aria-label')]);
    check('destination (not in the database) is plain text, not a dead button', !to.hasAttribute('role') && !to.hasAttribute('tabindex') && !to.classList.contains('ibRouteLink') && !to.closest('button, a'), [to.getAttribute('role'), to.tabIndex]);
    if (phone) { const b = from.getBoundingClientRect(); check('phone: the link is at least 44 x 44 px', b.width >= 43.5 && b.height >= 43.5, [b.width, b.height]); }
    // click -> airport panel, aircraft stays selected, Back chip
    from.click(); await w(1500);
    for (let t = 0; t < 20 && !document.body.classList.contains('airportOpen'); t++) await w(300);
    check('click opens the airport panel (as a marker click does)', document.body.classList.contains('airportOpen') && AIRPT.state.cur && AIRPT.state.cur.icao === 'EGLL', AIRPT.state.cur && AIRPT.state.cur.icao);
    check('the aircraft stays selected', !!SelectedPlane && SelectedPlane.icao === 'abc123');
    check('the aircraft panel is hidden behind the airport panel, which is visible', !vis($('selected_infoblock')) && vis($('airport_panel')));
    let bk = document.querySelector('#airport_panel .apBack');
    check('a Back chip reads "‹ RUK1SX" and is a button', !!bk && bk.tagName === 'BUTTON' && bk.textContent.trim() === '‹ RUK1SX', bk && bk.textContent);
    if (bk && phone) { const b = bk.getBoundingClientRect(); check('phone: the Back chip is at least 44 px tall', b.height >= 43.5, b.height); }
    if (bk) { bk.focus(); check('the Back chip takes keyboard focus', document.activeElement === bk); bk.click(); await w(900); }
    check('Back returns to the aircraft panel with the airport closed', !document.body.classList.contains('airportOpen') && vis($('selected_infoblock')) && !!SelectedPlane && SelectedPlane.icao === 'abc123');
    // keyboard: Enter on the focused link
    const fr = $('ib_route_from_e'); fr.focus();
    fr.dispatchEvent(new KeyboardEvent('keydown', {key: 'Enter', bubbles: true, cancelable: true})); await w(1500);
    check('Enter on the focused link opens the airport panel', document.body.classList.contains('airportOpen') && AIRPT.state.cur && AIRPT.state.cur.icao === 'EGLL');
    // the airport's own close control also leaves the aircraft selected and shown
    const x = document.querySelector('#airport_panel .sk-x'); if (x) { x.click(); await w(900); }
    check('closing the airport panel leaves the aircraft selected and shown', !document.body.classList.contains('airportOpen') && vis($('selected_infoblock')) && !!SelectedPlane && SelectedPlane.icao === 'abc123');
    // a normal open (not from a route) still closes the aircraft panel
    await AIRPT.searchAndOpen('EGLL'); await w(1200);
    check('opening an airport directly still deselects the aircraft (unchanged behaviour)', !SelectedPlane && document.body.classList.contains('airportOpen') && !document.querySelector('#airport_panel .apBack'));
  } finally { clearInterval(injT); jQuery.ajax = oa; }
  return {checks, failures, numbers};
})()
