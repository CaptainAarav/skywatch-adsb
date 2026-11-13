// END-TO-END SMOKE against the real, live aircraft.json (no fixtures, no injected aircraft). Run in the page via CDP at 1440x900.
// It must catch "the site shows 0 aircraft while the receiver sees some":
//   1. aircraft.json (fetched with cache bypass) has aircraft; if it has none the check FAILS with SOURCE EMPTY (the feed itself is down: alert, don't hide it)
//   2. the page's aircraft counter (TrackedAircraft) and the plane list are > 0 and match the JSON within a small tolerance
//   3. the map's aircraft source (tar-planes) holds > 0 features and the count is within tolerance of the JSON aircraft that have a position
//   4. freshness: the page's `now` is within 10 s of the server's `now` and of the local clock
// Prints {checks, failures, numbers}.
(async () => {
  const w = ms => new Promise(r => setTimeout(r, ms));
  const checks = {}, failures = [], numbers = {};
  const check = (n, v, note) => { checks[n] = !!v; if (!v) failures.push(n + (note !== undefined ? ' ' + JSON.stringify(note) : '')); };
  const fetchJson = async () => { const r = await fetch('data/aircraft.json?smoke=' + Date.now(), {cache: 'no-store'}); return {status: r.status, j: await r.json()}; };
  let src;
  try { src = await fetchJson(); } catch (e) { check('aircraft.json loads', false, String(e)); return {checks, failures, numbers}; }
  check('aircraft.json HTTP 200', src.status === 200, src.status);
  const list = src.j.aircraft || [], withPos = list.filter(a => typeof a.lat == 'number' && typeof a.lon == 'number' && (a.seen_pos == null || a.seen_pos < 60)).length;
  numbers.json = {aircraft: list.length, withPos, now: src.j.now};
  check('SOURCE EMPTY: aircraft.json contains aircraft (if not, the receiver/feed is down, not the page)', list.length > 0, numbers.json);
  for (let i = 0; i < 120 && !((typeof MLR != 'undefined') && MLR.map && MLR.map.loaded() && typeof TrackedAircraft != 'undefined' && TrackedAircraft > 0); i++) await w(500);
  await w(2500);
  const fresh = await fetchJson(), freshList = fresh.j.aircraft || [];
  const wp = freshList.filter(a => typeof a.lat == 'number' && typeof a.lon == 'number' && (a.seen_pos == null || a.seen_pos < 60)).length;
  const tol = Math.max(4, Math.round(0.2 * Math.max(wp, 1)));                  // aircraft come and go between the two reads
  const counter = TrackedAircraft, onMap = (MLR.planeFeats || []).length;
  let srcN = -1;                                                              // public API: features the aircraft source really holds (unique by hex, tiles can repeat a point)
  try { srcN = new Set(MLR.map.querySourceFeatures('tar-planes').map(f => f.properties.hex)).size; } catch (e) { /* stays -1 */ }
  numbers.page = {counter, positions: typeof TrackedAircraftPositions != 'undefined' ? TrackedAircraftPositions : null, planeFeats: onMap, sourceFeatures: srcN, jsonAircraft: freshList.length, jsonWithPos: wp, tol};
  if (freshList.length > 0) {
    check('page aircraft counter > 0', counter > 0, numbers.page);
    check('page aircraft counter within tolerance of aircraft.json', Math.abs(counter - freshList.length) <= Math.max(tol, 5), numbers.page);
    check('map aircraft source has features (> 0)', srcN > 0, numbers.page);
    // querySourceFeatures only returns features in the loaded tiles around the viewport, so aircraft far outside the view are not in it: expect  inView - tol <= source <= withPos + tol
    const bnd = MLR.map.getBounds(), inView = freshList.filter(a => typeof a.lat == 'number' && typeof a.lon == 'number' && (a.seen_pos == null || a.seen_pos < 60) && bnd.contains([a.lon, a.lat])).length;
    numbers.page.inView = inView;
    check('map aircraft source count matches aircraft with a position (in view - tol <= source <= with position + tol)', srcN >= inView - tol && srcN <= wp + tol, numbers.page);
    check('the page draws every aircraft with a position (planeFeats within tolerance of aircraft.json)', Math.abs(onMap - wp) <= tol, numbers.page);
  }
  const pageNow = typeof now != 'undefined' ? now : 0, local = Date.now() / 1000;
  numbers.fresh = {pageNow, serverNow: fresh.j.now, local};
  check('data freshness: page now within 10 s of the server now', Math.abs(fresh.j.now - pageNow) <= 10, numbers.fresh);
  check('data freshness: server now within 10 s of the local clock', Math.abs(local - fresh.j.now) <= 10, numbers.fresh);
  return {checks, failures, numbers};
})()
