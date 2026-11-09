// Route display regression test with a RECORDED response (tools/test/fixtures/route-response.json, real adsb.im answers), no live route network.
// The runner passes the fixture in as window.ROUTE_FIXTURE. jQuery.ajax is stubbed for the route service only: 'ok' answers every requested callsign
// with a recorded route; 'fail' rejects. For live aircraft with callsigns it asserts, at the viewport under test (and in the wide panel on desktop):
//  - the route card is visible with the origin and destination codes, names and flags (shared flag assets);
//  - the route-line source is non-empty (remaining great circle + the part already flown);
//  - a failed lookup renders "Route unavailable" (no codes), logs one console.debug, caches 5 minutes, and leaves the photo-lookup state alone.
// On a phone the route sits below the instruments, so the sheet is opened to its half snap first (at peek only the instruments show).
// Console errors fail the run in the runner. Returns {checks, failures, numbers}.
(async () => {
  const w = ms => new Promise(r => setTimeout(r, ms));
  const checks = {}, failures = [], numbers = {};
  const check = (n, ok, d) => { checks[n] = !!ok; if (!ok) failures.push(n + (d !== undefined ? ' ' + JSON.stringify(d).slice(0, 220) : '')); };
  const FIX = window.ROUTE_FIXTURE || [];
  check('fixture loaded', FIX.length >= 3, FIX.length);
  let mode = 'ok'; const asked = []; const debugs = [];
  const od = console.debug; console.debug = function () { debugs.push(String(arguments[0])); return od.apply(console, arguments); };
  const oa = jQuery.ajax;
  jQuery.ajax = function (o) {
    if (!(o && o.url && o.url === routeApiUrl)) return oa.apply(this, arguments);
    const body = JSON.parse(o.data), d = jQuery.Deferred(); asked.push(body.planes.map(p => p.callsign));
    setTimeout(() => {
      if (mode === 'fail') d.reject({status: 0}, 'error', '');
      else d.resolve(body.planes.map((p, i) => Object.assign({}, FIX[asked.length + i - 1 + (i % 1)] || FIX[i % FIX.length], {callsign: p.callsign})));
    }, 40);
    return d.promise();
  };
  const reset = () => { g.route_cache = {}; g.route_check_todo = {}; g.route_check_checking = null; g.route_check_in_flight = false; g.route_last_lookup = 0; };
  const callsigned = () => g.planesOrdered.filter(p => p.position && p.name && p.name !== 'no callsign' && p.name !== p.registration && /^[A-Z]{3}[0-9A-Z]{1,4}$/.test(p.name.trim()));
  const vis = id => { const e = document.getElementById(id); return !!e && !e.hidden && getComputedStyle(e).display !== 'none' && e.getBoundingClientRect().width > 0; };
  check('route lookup is on by default', useRouteAPI === true);
  const phone = document.body.classList.contains('phone');
  const modes = phone ? ['compact'] : ['compact', 'wide'];
  const used = new Set();
  const pick = () => callsigned().find(p => !used.has(p.icao));

  for (const view of modes) {
    if (!phone) { try { toggles['wideInfoblock'].toggle(view === 'wide'); } catch (e) {} await w(500); }
    check(view + ': the panel is in the ' + view + ' state', phone || document.body.classList.contains('infoWide') === (view === 'wide'));
    reset(); mode = 'ok';
    for (let i = 0; i < 3; i++) {
      const p = pick(); if (!p) { check(view + ': 3 aircraft with callsigns available', false, i); break; }
      used.add(p.icao);
      selectPlaneByHex(p.icao, {follow: false});
      if (phone) { await w(800); PHONE.goto(1); }
      for (let t = 0; t < 14 && !vis('ib_route'); t++) await w(1000);
      const key = normalized_callsign(p.name), r = g.route_cache[key], a = r && r._airports;
      const tag = view + ' ' + p.name + ': ';
      check(tag + 'recorded route cached', !!a && a.length >= 2, r && Object.keys(r));
      check(tag + 'route card visible', vis('ib_route'));
      const from = document.getElementById('ib_route_from').textContent, to = document.getElementById('ib_route_to').textContent;
      check(tag + 'origin and destination codes shown', !!a && from === (a[0].iata || a[0].icao) && to === (a[a.length - 1].iata || a[a.length - 1].icao), [from, to]);
      check(tag + 'airport names shown', !!document.getElementById('ib_route_from_n').textContent && !!document.getElementById('ib_route_to_n').textContent);
      const ff = document.getElementById('ib_route_from_f'), tf = document.getElementById('ib_route_to_f');
      check(tag + 'both flags use the shared flag assets', !ff.hidden && !tf.hidden && /^flags\/3x2\/[A-Z]{2}\.svg$/.test(ff.getAttribute('src')) && /^flags\/3x2\/[A-Z]{2}\.svg$/.test(tf.getAttribute('src')));
      check(tag + 'no "Route unavailable" while a route exists', !vis('ib_route_none'));
      await w(1500);
      const rd = MLR.selRouteData, f = rd && rd.features || [];
      check(tag + 'route line source is non-empty', f.length >= 1 && f[0].geometry.coordinates.length > 10, f.length);
      check(tag + 'remaining and already-flown parts both present', f.some(x => x.properties.done === 0) && f.some(x => x.properties.done === 1));
      check(tag + 'route layers exist', !!MLR.map.getLayer('tar-route') && !!MLR.map.getLayer('tar-route-done'));
      const card = document.getElementById('ib_route').getBoundingClientRect();
      check(tag + 'card is inside the viewport width', card.left >= 0 && card.right <= innerWidth + 1, [card.left, card.right]);
    }
  }

  reset(); mode = 'fail';
  const photoBefore = sessionStorage.getItem('photoFailedAt'); const dbg0 = debugs.length;
  for (let i = 0; i < 2; i++) {
    const p = pick(); if (!p) { check('aircraft available for the failure case', false); break; }
    used.add(p.icao);
    selectPlaneByHex(p.icao, {follow: false});
    if (phone) { await w(800); PHONE.goto(1); }
    for (let t = 0; t < 14 && !vis('ib_route_none'); t++) await w(1000);
    const tag = 'failure ' + p.name + ': ';
    check(tag + '"Route unavailable" shown', vis('ib_route_none') && /Route unavailable/.test(document.getElementById('ib_route_none').textContent));
    check(tag + 'no origin/destination codes shown', !vis('ib_route_from') && !vis('ib_route_to'));
    const e = g.route_cache[normalized_callsign(p.name)], left = e && e.tarNextUpdate - Date.now() / 1000;
    check(tag + 'failure cached for 5 minutes', !!e && e.failed === true && left > 280 && left <= 301, left);
    await w(1200);
    check(tag + 'no route line drawn', !MLR.selRouteData || !MLR.selRouteData.features.length);
  }
  const routeDebugs = debugs.slice(dbg0).filter(s => /route lookup unavailable/.test(s));
  numbers.routeDebugLines = routeDebugs.length; numbers.requests = asked.length;
  check('failed lookups logged only quiet debug lines (one per failed batch)', routeDebugs.length >= 1 && routeDebugs.length <= asked.length);
  check('a failed route lookup does not touch the photo-lookup state', sessionStorage.getItem('photoFailedAt') === photoBefore);
  const again = asked.length; await w(4000);
  check('no immediate retry storm after a failure', asked.length - again <= 1, asked.length - again);
  jQuery.ajax = oa; console.debug = od;
  return {checks, failures, numbers};
})()
