// Run in the page via CDP (Runtime.evaluate, awaitPromise) in a phone emulation (touch, mobile) at the viewport under test.
// DOM-only assertions (no images): peek/half/full geometry, chrome replaced on selection, exits for every surface, same component tree.
// Prints one JSON object {viewport, checks:{name:bool}, notes:{...}, failures:[...]}.
(async () => {
  const w = ms => new Promise(r => setTimeout(r, ms));
  const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
  const R = e => { const b = e.getBoundingClientRect(); return {x: b.x, y: b.y, r: b.right, b: b.bottom, w: b.width, h: b.height}; };
  const vis = e => { if (!e) return false; const cs = getComputedStyle(e); if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity === 0) return false; const b = e.getBoundingClientRect(); return b.width > 0 && b.height > 0; };
  const VW = innerWidth, VH = innerHeight, ok = {}, notes = {}, fail = [];
  const check = (n, v, note) => { ok[n] = !!v; if (!v) fail.push(n + (note !== undefined ? ' ' + JSON.stringify(note) : '')); };
  const inside = r => r.x >= -0.5 && r.y >= -0.5 && r.r <= VW + 0.5 && r.b <= VH + 0.5;
  const overlap = (a, b) => a.x < b.r - 0.5 && b.x < a.r - 0.5 && a.y < b.b - 0.5 && b.y < a.b - 0.5;
  const snapTo = async i => { PHONE.goto(i); await w(450); };
  const px = (type, t, x, y, id) => t.dispatchEvent(new PointerEvent(type, {bubbles: true, cancelable: true, pointerId: id || 7, clientX: x, clientY: y, button: 0, isPrimary: true}));

  // ---- exactly one search affordance per tab ----
  const searchCount = () => $$('.psSearch, #list_filter, #search_input, input[type=search], input[type=text][placeholder*=earch]').filter(vis).length;
  $('.psTab:nth-child(1)').click(); await w(500); notes.searchMap = searchCount();
  $('.psTab:nth-child(2)').click(); await w(700); notes.searchList = searchCount();
  check('Aircraft tab has exactly one search field', notes.searchList === 1, notes.searchList);
  $('.psTab:nth-child(1)').click(); await w(500);
  check('Map tab has exactly one search affordance', notes.searchMap === 1, notes.searchMap);
  const land0 = () => [MLR.map.getPaintProperty('background', 'background-color'), MLR.map.getPaintProperty('landuse_residential', 'fill-color'), MLR.map.getPaintProperty('landcover_wood', 'fill-color'), MLR.map.getPaintProperty('landuse_park', 'fill-color')];
  const before = land0();
  // FIXED FIXTURE aircraft with a complete set of fields (position, altitude, speeds, track, heading, wind), injected through the page's own processAircraft() and refreshed every 300 ms:
  // the compass and tape cards only render for an aircraft that has the data, so a live aircraft with gaps made the half-snap compass checks flaky.
  const FIXAC = {hex: 'abc123', type: 'adsb_icao', flight: 'FIX123', lat: 51.4700, lon: -0.4543, alt_baro: 36000, alt_geom: 36200, gs: 420, tas: 450, ias: 280, mach: 0.78, track: 90, true_heading: 92, mag_heading: 90, wd: 250, ws: 40, baro_rate: 0, t: 'B738', category: 'A3', seen: 0, seen_pos: 0, messages: 100, rssi: -10};
  processAircraft(Object.assign({}, FIXAC), false, false); const fixT = setInterval(() => processAircraft(Object.assign({}, FIXAC), false, false), 300);
  for (let i = 0; i < 40 && !(g.planes['abc123'] && g.planes['abc123'].position); i++) await w(250);
  const pl = g.planes['abc123'];
  if (!pl) { clearInterval(fixT); return {viewport: [VW, VH], err: 'the fixture aircraft did not appear'}; }
  selectPlaneByHex(pl.icao, {follow: false}); await w(1600);
  const after = land0();
  check('map land paint identical before/after selecting', JSON.stringify(before) === JSON.stringify(after), {before, after});

  // ---- chrome replaced by the sheet ----
  check('search pill and tab bar hidden on selection', !vis($('.psSearch')) && !vis($('.psTabs')));
  check('close X present, visible, >=44px', vis($('#infoblock_close')) && R($('#infoblock_close')).w >= 44 && R($('#infoblock_close')).h >= 44);
  check('share present', vis($('#ib_p_share')));

  // ---- peek ----
  await snapTo(0);
  check('snap attribute peek', document.body.dataset.snap === 'peek', document.body.dataset.snap);
  const head = R($('#selected_infoblock .ibHead')), bar = R($('#infoActions')), sums = $$('#selected_infoblock .ibInstGrid .ibSum').map(R), sheet = R($('#phoneSheet'));
  check('peek: header inside viewport', inside(head), head);
  check('peek: three summaries inside viewport', sums.length === 3 && sums.every(inside), sums);
  check('peek: action bar inside viewport', inside(bar), bar);
  check('peek: sheet bottom at viewport bottom', Math.abs(sheet.b - VH) < 1.5, sheet.b);
  check('peek: header, summaries and bar do not overlap', !overlap(head, bar) && sums.every(s => !overlap(s, bar) && !overlap(s, head)));
  check('peek: summaries in one row', Math.max(...sums.map(s => s.y)) - Math.min(...sums.map(s => s.y)) < 2);
  const clipped = $$('#selected_infoblock .ibInstGrid .ibSum *').filter(e => vis(e) && e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).overflow === 'visible' && e.children.length === 0);
  check('peek: summaries do not overflow their cards', $$('#selected_infoblock .ibInstGrid > .ibCard').every(c => c.scrollWidth <= c.clientWidth + 1), $$('#selected_infoblock .ibInstGrid > .ibCard').map(c => [c.scrollWidth, c.clientWidth]));
  check('peek: summary values stay on one line', $$('#selected_infoblock .ibInstGrid .ibBigV > span:first-child').every(e => e.getBoundingClientRect().height < 30), $$('#selected_infoblock .ibInstGrid .ibBigV > span:first-child').map(e => e.getBoundingClientRect().height));
  check('peek: details hidden', !vis($('#ib_details_card')) && !vis($('#ib_alt_tape')) && !vis($('#ib_compass')));
  check('peek: status sentence shown', vis($('#ib_status')) && $('#ib_status').textContent.length > 3, $('#ib_status').textContent);
  check('peek: no status pill beside speed', !$('#ib_speed_status') && !$('.ibStatus'));
  notes.peekHeight = Math.round(sheet.h); notes.statusText = $('#ib_status').textContent;
  check('floating buttons ride above the sheet', (() => { const c = $('#controlStack'); return c && R(c).b <= sheet.y + 1; })());

  // ---- half ----
  await snapTo(1);
  const sb = $('#phoneSheetBody');
  const cards = ['altitude', 'speed', 'direction'].map(n => $('#selected_infoblock [data-component=' + n + ']'));
  cards.forEach(c => c && c.scrollIntoView({block: 'nearest'})); await w(150);
  const comp = $('#ib_compass svg'); comp.scrollIntoView({block: 'center'}); await w(250);
  const cr = R(comp), cc = R($('#selected_infoblock [data-component=direction]')), sr = R(sb);
  check('half: instrument cards rendered with details', cards.every(vis) && vis($('#ib_alt_tape')) );
  check('half: compass fully inside its card', cr.x >= cc.x - 0.5 && cr.r <= cc.r + 0.5 && cr.y >= cc.y - 0.5 && cr.b <= cc.b + 0.5, {cr, cc});
  check('half: compass >=150px', cr.w >= 150 && cr.h >= 150, [cr.w, cr.h]);
  check('half: compass visible in the sheet viewport', cr.y >= sr.y - 0.5 && cr.b <= sr.b + 0.5, {cr, sr});
  notes.compassPx = Math.round(cr.w);

  // ---- full ----
  await snapTo(2);
  sb.scrollTop = sb.scrollHeight; await w(250);
  const last = $('#ib_details_card'), lastR = R(last), barR = R($('#infoActions')), sbR = R(sb);
  check('full: end of content clears the pinned action bar by >=16px', barR.y - lastR.b >= 16, {gap: barR.y - lastR.b});
  check('full: action bar sticks to the sheet bottom', Math.abs(barR.b - sbR.b) < 1.5, [barR.b, sbR.b]);
  check('full: action bar 48px buttons', $$('#infoActions .act').every(b => R(b).h >= 47.5), $$('#infoActions .act').map(b => R(b).h));
  check('full: action labels do not wrap', $$('#infoActions .act').every(b => b.scrollHeight <= b.clientHeight + 1 && b.scrollWidth <= b.clientWidth + 1));
  check('full: Follow, Isolate, More only', $$('#infoActions > .act').map(b => b.id).join() === 'F,I,act_more');
  const ac = R($('#ib_aircraft')); const facts = $$('#ib_facts > div').filter(vis);
  check('aircraft card: titled Aircraft', /^aircraft$/i.test($('#ib_aircraft .ibTypeName,#ib_aircraft .ibCardTitle,#ib_aircraft .lbl').textContent.trim()), $('#ib_aircraft .ibTypeName,#ib_aircraft .ibCardTitle,#ib_aircraft .lbl').textContent);
  const cols = new Set(facts.map(f => Math.round(R(f).x))); check('aircraft card: two-column left-aligned grid', cols.size <= 2 && facts.every(f => getComputedStyle(f).textAlign !== 'right'), [...cols]);
  check('only one compact chip row', $$('#selected_infoblock .ibChips').filter(vis).length <= 1 && $$('#selected_infoblock .ibChips .chip, #selected_infoblock .ibChips > *').length <= 3);
  check('Details card collapsed by default', !$('#ib_details_card').open);
  const order = ['.ibInstGrid', '#ib_aircraft', '#ib_route', '#ib_details_card'].map(s => { const e = $('#selected_infoblock ' + s); return e && vis(e) ? R(e).y : null; }).filter(v => v != null);
  check('section order: instruments, aircraft, route, details', order.every((v, i) => i === 0 || v >= order[i - 1]), order);

  // ---- no horizontal overflow, tap targets ----
  check('no horizontal overflow', document.documentElement.scrollWidth <= VW && sb.scrollWidth <= sb.clientWidth + 1, [document.documentElement.scrollWidth, sb.scrollWidth, sb.clientWidth]);
  const small = $$('#phoneSheet button, #controlStack button').filter(vis).filter(b => { const r = R(b); return r.w < 43.5 || r.h < 43.5; }).map(b => (b.id || b.className) + ':' + Math.round(R(b).w) + 'x' + Math.round(R(b).h));
  check('tap targets >=44px', small.length === 0, small);

  // ---- close, back, swipe ----
  const sel = () => document.body.classList.contains('infoOpen');
  const chromeBack = () => vis($('.psSearch')) && vis($('.psTabs'));
  await snapTo(0);
  px('pointerdown', $('#selected_infoblock .ibHead'), VW / 2, VH - sheet.h + 40); px('pointermove', $('#selected_infoblock .ibHead'), VW / 2, VH - sheet.h + 100); px('pointermove', $('#selected_infoblock .ibHead'), VW / 2, VH - sheet.h + 180); px('pointerup', $('#selected_infoblock .ibHead'), VW / 2, VH - sheet.h + 180);
  await w(500);
  check('swipe down from peek deselects', !sel());
  check('pill and tab bar return on deselect', chromeBack());
  selectPlaneByHex(pl.icao, {follow: false}); await w(1200); check('reselect', sel());
  history.back(); await w(700); check('browser back deselects', !sel());
  selectPlaneByHex(pl.icao, {follow: false}); await w(1200);
  $('#infoblock_close').click(); await w(500); check('X deselects', !sel() && chromeBack());
  selectPlaneByHex(pl.icao, {follow: false}); await w(1200);
  document.dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape', bubbles: true})); await w(500); check('Esc deselects', !sel());

  // ---- exits for every full-screen or modal surface ----
  const mapState = () => !sel() && !document.body.classList.contains('settingsOpen') && !document.body.classList.contains('airportOpen') && !document.querySelector('.sk-backdrop') && !(typeof PALETTE != 'undefined' && PALETTE.isOpen()) && $('#graphsOverlay').hidden;
  const surfacesDef = [
    ['settings', () => $('.psTab:nth-child(4)').click(), () => document.body.classList.contains('settingsOpen'), '#settings_close'],
    ['alerts', () => $('.psTab:nth-child(3)').click(), () => document.body.classList.contains('settingsOpen'), '#settings_close'],
    ['layers', () => $('#layers_button').click(), () => document.body.classList.contains('settingsOpen'), '#settings_close'],
    ['about', () => { openSettings('about', null); PHONE.settingsPage('page'); }, () => document.body.classList.contains('settingsOpen'), '#settings_close'],
    ['airport', () => AIRPT.searchAndOpen('EGGW'), () => document.body.classList.contains('airportOpen'), '#airport_panel .sk-x'],
    ['graphs', () => graphsToggle(true), () => !$('#graphsOverlay').hidden, '#graphsOverlay .sk-x'],
    ['palette', () => PALETTE.show(), () => PALETTE.isOpen(), '.palBox .sk-x'],
    ['dialog', () => { window.__dlg = SKYUI.dialog({title: 'Test', body: 'Body', ok: 'OK'}); }, () => !!$('.sk-backdrop'), '.sk-dialog .sk-x'],
    ['replay', () => { $('#RP').style.display = ''; showReplayBar(); }, () => getComputedStyle($('#replayBar')).display !== 'none', '#replayStop'],
  ];
  const exits = {};
  for (const [name, open, isOpen, closeSel] of surfacesDef) {
    const res = {};
    for (const how of ['x', 'esc', 'back']) {
      try { open(); } catch (e) { res.err = String(e); break; }
      await w(900);
      if (how === 'x') {
        const c = $(closeSel); const r = c && vis(c) ? R(c) : null;
        res.present = !!r; res.size = r && [Math.round(r.w), Math.round(r.h)]; res.rect = r && [Math.round(r.x), Math.round(r.y), Math.round(r.r), Math.round(r.b)]; res.big = !!r && r.w >= 43.5 && r.h >= 43.5;
        res.topRight = !!r && r.r > VW * 0.5 && inside(r) && (['dialog', 'replay', 'airport', 'palette'].includes(name) || r.y < 100);
        if (c) c.click();
      } else if (how === 'esc') (document.activeElement || document).dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape', bubbles: true, cancelable: true}));
      else history.back();
      await w(800);
      res[how] = !isOpen() ;
      if (isOpen()) { try { if (name === 'palette') PALETTE.close(); else if (name === 'dialog') document.dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape', bubbles: true})); else if (name === 'graphs') graphsToggle(false); else if (name === 'replay') $('#replayStop').click(); else if (name === 'airport') AIRPT.close(); else closeSettings(); } catch (e) {} await w(500); }
    }
    res.backToMap = mapState() || name === 'replay';
    exits[name] = res;
    check('exit ' + name, res.present && res.big && res.topRight && res.x && res.esc && res.back && res.backToMap, res);
  }
  notes.exits = exits;
  // settings use a solid black background
  openSettings(null, null); await w(500);
  const sbg = getComputedStyle($('#settings_infoblock')).backgroundColor; check('settings background solid #000', sbg === 'rgb(0, 0, 0)', sbg);
  closeSettings(); await w(400);

  // ---- same component tree as desktop (compare via notes; the desktop run records the same signature) ----
  notes.componentSignature = $$('#selected_infoblock [data-component], #selected_infoblock [data-part]').map(e => (e.dataset.component || '') + '/' + (e.dataset.part || '') + '/' + e.className.split(' ')[0]).join('|');
  const errs = (window.__errs || []);
  clearInterval(fixT);
  return {viewport: [VW, VH], checks: ok, failures: fail, notes};
})()
