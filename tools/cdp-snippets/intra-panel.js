// INTRA-PANEL layout test (DOM geometry only, no screenshots). The floating-control collision test only compares controls against panel content; it cannot see
// elements colliding INSIDE a panel (a chip running into a timestamp). For every visible container inside the panels it asserts:
//   1. no two visible sibling elements that contain text or are interactive overlap (more than 4 px^2 of intersection);
//   2. no child extends outside its container horizontally (or vertically where the container clips, i.e. overflow hidden/clip), unless the container scrolls;
//   3. no text element is clipped: overflow hidden/clip (or text-overflow: ellipsis, or a line clamp) with scrollWidth/Height > client size, unless the full text
//      stays available through its title / aria-label (an intentional, disclosed truncation).
// States: aircraft selected; airport open with VFR / MVFR / IFR / LIFR METAR fixtures (wx.json is stubbed, so no live dependence), each also with a very long
// timestamp and a very long airport name; replay bar open; every Settings page. Run at 1440x900, 1100x800, 900x800, 780x800 and the six phone sizes.
// Returns {viewport, phone, states, findings (per state), failures}.
(async () => {
  const w = ms => new Promise(r => setTimeout(r, ms));
  const VW = innerWidth, VH = innerHeight, phone = document.body.classList.contains('phone');
  const failures = [], perState = {}, seen = new Set();
  for (let i = 0; i < 240 && !((typeof MLR != 'undefined') && MLR.map && (typeof AIRPT != 'undefined') && g.planesOrdered && g.planesOrdered.length); i++) await w(500);
  const ROOTS = ['#selected_infoblock', '#airport_panel', '#settings_infoblock', '#phoneSheet', '#replayBar', '.histBar', '#sidebar_container'];
  const vis = e => { for (let n = e; n && n !== document.documentElement; n = n.parentElement) { const cs = getComputedStyle(n); if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) === 0 || n.hidden || n.getAttribute('aria-hidden') === 'true') return false; } const b = e.getBoundingClientRect(); return b.width > 2 && b.height > 2; };      // 1x1 screen-reader-only text is not visible
  const interactive = e => e.matches('button, a[href], input, select, textarea, summary, [role=button], [tabindex]:not([tabindex="-1"])');
  const hasText = e => { for (const n of e.childNodes) if (n.nodeType === 3 && n.textContent.trim()) return true; return (e.textContent || '').trim().length > 0 && !e.querySelector(':scope > svg:only-child'); };
  const sel = e => { const p = []; for (let n = e; n && n.nodeType === 1 && p.length < 4; n = n.parentElement) p.push((n.id ? '#' + n.id : n.tagName.toLowerCase()) + (typeof n.className === 'string' && n.className.trim() ? '.' + n.className.trim().split(/\s+/).slice(0, 2).join('.') : '')); return p.reverse().join(' > '); };
  const box = b => [Math.round(b.left), Math.round(b.top), Math.round(b.width), Math.round(b.height)];
  const flowOnly = e => { const p = getComputedStyle(e).position; return p !== 'fixed'; };
  function audit(stateName) {
    const found = [];
    const add = (kind, el, extra) => { const key = kind + '|' + sel(el) + '|' + (extra && extra.other || ''); if (seen.has(stateName + key)) return; seen.add(stateName + key); found.push(Object.assign({kind, el: sel(el), box: box(el.getBoundingClientRect())}, extra)); };
    const roots = ROOTS.map(s => document.querySelector(s)).filter(r => r && vis(r));
    for (const root of roots) {
      const all = [root, ...root.querySelectorAll('*')].filter(e => !/^(SCRIPT|STYLE|SVG|PATH|G|CIRCLE|LINE|RECT|POLYGON|OPTION|BR)$/i.test(e.tagName) && !e.closest('svg') && vis(e));
      for (const c of all) {
        const cs = getComputedStyle(c), cb = c.getBoundingClientRect();
        const kids = [...c.children].filter(k => !/^(SCRIPT|STYLE|BR)$/i.test(k.tagName) && !k.closest('svg') && vis(k) && flowOnly(k));
        // 1. sibling overlap
        // Not compared: elements that are overlays by construction (position sticky: content scrolls under a sticky bar; fixed is already excluded), inline
        // elements are compared by their LINE FRAGMENTS (getClientRects), not their union box, and the sheet drag
        // handle (.psHandle, a gesture surface whose 44 px hit area deliberately extends over the sheet's top edge; disclosed exemption).
        const subst = kids.filter(k => (interactive(k) || hasText(k)) && !k.matches('.visuallyHidden, .sr-only, .psHandle') && getComputedStyle(k).position !== 'sticky');
        // interactive elements compare by their box (the tap area is what a finger hits); text blocks compare by the rects of the text they hold (a padded or full-width block whose
        // glyphs are nowhere near a neighbour is not a collision), inline elements by their line fragments
        const frags = e => {
          let r;
          if (interactive(e)) r = [...e.getClientRects()];
          else { const g = document.createRange(); g.selectNodeContents(e); r = [...g.getClientRects()]; }
          // what is visible: clip each rect to every scrolling/clipping ancestor (a scroll area's off-screen content is not on screen)
          const clips = []; for (let n = e; n && n !== document.documentElement; n = n.parentElement) { const q = getComputedStyle(n); if (/(hidden|clip|auto|scroll)/.test(q.overflowX + q.overflowY)) clips.push(n.getBoundingClientRect()); }
          r = r.map(b => { let L = b.left, T = b.top, R = b.right, B = b.bottom; for (const c of clips) { L = Math.max(L, c.left); T = Math.max(T, c.top); R = Math.min(R, c.right); B = Math.min(B, c.bottom); } return {left: L, top: T, right: R, bottom: B, width: R - L, height: B - T}; });
          r = r.filter(b => b.width > 1 && b.height > 1);
          return r.length ? r : (e.getClientRects().length ? [] : [e.getBoundingClientRect()]);
        };
        for (let i = 0; i < subst.length; i++) for (let j = i + 1; j < subst.length; j++) {
          let hit = null;
          for (const a of frags(subst[i])) for (const b of frags(subst[j])) {
            const ix = Math.min(a.right, b.right) - Math.max(a.left, b.left), iy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
            if (ix > 1 && iy > 1 && ix * iy > 4 && (!hit || ix * iy > hit.ix * hit.iy)) hit = {ix, iy, b, a};
          }
          if (hit) add('overlap', subst[i], {other: sel(subst[j]), otherBox: box(hit.b), ownBox: box(hit.a), overlapPx: [Math.round(hit.ix), Math.round(hit.iy)]});
          // 1b. touching: a boxed element (chip, pill, button: it has a fill or a border) flush against a text sibling on the same line, less than 3 px apart
          if (!hit) {
            const boxed = e => { const q = getComputedStyle(e); return (q.backgroundColor !== 'rgba(0, 0, 0, 0)' && q.backgroundColor !== 'transparent') || parseFloat(q.borderLeftWidth) > 0; };
            if (boxed(subst[i]) !== boxed(subst[j]) && !subst[i].closest('.segmented') && !subst[j].closest('.segmented')) {   // boxed vs plain text only; joined .segmented controls are flush by design (disclosed exemption)
              let tch = null;
              for (const a of frags(subst[i])) for (const b of frags(subst[j])) {
                const vy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top), gap = Math.max(b.left - a.right, a.left - b.right);
                if (vy > 4 && gap > -1 && gap < 3 && Math.min(a.width, b.width) > 8) tch = {gap, b};
              }
              if (tch) add('touching', subst[i], {other: sel(subst[j]), otherBox: box(tch.b), gapPx: Math.round(tch.gap)});
            }
          }
        }
        // 2. child outside container
        const scrollX = /(auto|scroll)/.test(cs.overflowX), scrollY = /(auto|scroll)/.test(cs.overflowY), clipX = /(hidden|clip)/.test(cs.overflowX), clipY = /(hidden|clip)/.test(cs.overflowY);
        // in-flow children must stay inside their container; an absolutely positioned child (a bubble, a badge) is only required to stay inside the PANEL ROOT.
        // One disclosed exemption: .hBubble, the scrubber's time tooltip, is placed above its bar on purpose.
        if (!scrollX) for (const k of kids) {
          const kb = k.getBoundingClientRect(), abs = getComputedStyle(k).position === 'absolute', ref = abs ? root.getBoundingClientRect() : cb;
          if (k.matches('.hBubble')) continue;
          if (kb.right > ref.right + 1.5 || kb.left < ref.left - 1.5) add(clipX && !abs ? 'clipped-child' : 'outside-container', k, {container: abs ? sel(root) : sel(c), containerBox: box(ref)});
        }
        // The peek sheet is a deliberate clip window (it shows the header strip only): there the test requires the HEADER to be fully inside, not the whole panel.
        if (c.id === 'phoneSheetBody' && document.body.dataset.snap === 'peek') {
          const hd = c.querySelector('.ibHead'); if (hd && hd.getBoundingClientRect().bottom > cb.bottom + 1.5) add('peek-header-cut', hd, {container: sel(c), containerBox: box(cb)});
        } else if (clipY && !scrollY) for (const k of kids) { const kb = k.getBoundingClientRect(); if (kb.bottom > cb.bottom + 1.5 && hasText(k)) add('clipped-child-vertical', k, {container: sel(c), containerBox: box(cb)}); }
        // 3. clipped text
        if (hasText(c) && c !== root && !c.matches('select, input, textarea') && !(c.id === 'phoneSheetBody' && document.body.dataset.snap === 'peek')) {   // peek window: see the peek-header-cut rule above
          const clipping = /(hidden|clip)/.test(cs.overflowX) || cs.textOverflow === 'ellipsis';
          const clampV = (cs.webkitLineClamp && cs.webkitLineClamp !== 'none') || /(hidden|clip)/.test(cs.overflowY);
          const wide = c.scrollWidth > c.clientWidth + 1 && clipping, tall = c.scrollHeight > c.clientHeight + 1 && clampV && cs.display !== 'inline' && /^(?!0)/.test(String(c.clientHeight)) && c.clientHeight > 0;
          if ((wide || tall) && !((c.getAttribute('title') || c.getAttribute('data-tip') || c.getAttribute('aria-label') || '').trim())) add('clipped-text', c, {scroll: [c.scrollWidth, c.scrollHeight], client: [c.clientWidth, c.clientHeight], text: (c.textContent || '').trim().slice(0, 40)});
        }
      }
    }
    return found;
  }
  const record = async (name, fn) => {
    try { await fn(); await w(700); } catch (e) { failures.push(name + ': state not reachable: ' + String(e && e.message).slice(0, 100)); return; }
    const f = audit(name); perState[name] = f.length;
    for (const x of f.slice(0, 12)) failures.push(name + ' | ' + x.kind + ' | ' + x.el + ' ' + JSON.stringify(x.box) + (x.other ? ' x ' + x.other + ' ' + JSON.stringify(x.otherBox) : '') + (x.container ? ' in ' + x.container : '') + (x.text ? ' "' + x.text + '"' : '') + (x.ownBox ? ' ownText ' + JSON.stringify(x.ownBox) : '') + (x.overlapPx ? ' overlapPx ' + JSON.stringify(x.overlapPx) : '') + (x.gapPx != null ? ' gapPx ' + x.gapPx : ''));
    if (f.length > 12) failures.push(name + ' | ... ' + (f.length - 12) + ' more');
  };

  // ---- fixtures: wx.json is stubbed (the recorder file is not needed and nothing live is involved) ----
  const nowS = () => Math.floor(Date.now() / 1000);
  const CASES = {
    VFR:  {vis: 10,  clouds: [['FEW', 4500]], wdir: 60, wspd: 11},
    MVFR: {vis: 4,   clouds: [['BKN', 2500]], wdir: 240, wspd: 9, wgst: 21},
    IFR:  {vis: 2,   clouds: [['OVC', 700]], wdir: 180, wspd: 14},
    LIFR: {vis: 0.5, clouds: [['OVC', 200]], wdir: 90, wspd: 4},
  };
  let wxMode = null;
  const wxFeed = () => { const c = CASES[wxMode.cat]; return {fetched_at: nowS(), stations: {EGLL: {m: Object.assign({obs: nowS() - wxMode.ageMin * 60, temp: 12, dew: 9, qnh: 1015, raw: 'EGLL ' + wxMode.cat + ' 31013KT 9999 FEW045 12/09 Q1015 NOSIG'}, c), t: {issue: new Date().toISOString().slice(0, 14) + '00:00Z', f: [], raw: 'TAF EGLL 091100Z 0912/1018 06011KT 9999 FEW045'}}}}; };
  const fetch0 = window.fetch;
  window.fetch = function (u, o) { if (typeof u === 'string' && /skywatch\/wx\.json/.test(u) && wxMode) return Promise.resolve(new Response(JSON.stringify(wxFeed()), {status: 200, headers: {'Content-Type': 'application/json'}})); return fetch0.apply(this, arguments); };
  if (typeof airportWeather !== 'undefined') airportWeather = true;

  const pl = g.planesOrdered.find(p => p.position);
  // phone: a selected aircraft shows at the half snap
  await record('aircraft selected', async () => { selectPlaneByHex(pl.icao, {follow: false}); await w(2200); if (phone && (typeof PHONE != 'undefined') && PHONE.goto) PHONE.goto(1); await w(600); });
  await record('aircraft selected (full snap / expanded)', async () => { if (phone && (typeof PHONE != 'undefined') && PHONE.goto) { PHONE.goto(2); document.body.classList.add('sheetFull'); } await w(500); });
  document.body.classList.remove('sheetFull');
  deselectAllPlanes(); await w(500);

  for (const cat of ['VFR', 'MVFR', 'IFR', 'LIFR']) {
    wxMode = {cat, ageMin: 31};
    await record('airport ' + cat, async () => { await AIRPT.refreshWx(); await AIRPT.searchAndOpen('EGLL'); await w(2200); if (phone && (typeof PHONE != 'undefined') && PHONE.goto) PHONE.goto(2); await w(500); });
    if (cat === 'VFR') {
      await record('airport VFR, 1 h 31 min old METAR', async () => { wxMode = {cat, ageMin: 91}; await AIRPT.refreshWx(); AIRPT.state.cur && AIRPT.open && AIRPT.searchAndOpen('EGLL'); await w(1500); });
      await record('airport VFR, very long timestamp and very long names', async () => {
        wxMode = {cat, ageMin: 31}; await AIRPT.refreshWx(); await AIRPT.searchAndOpen('EGLL'); await w(1500);
        for (const a of document.querySelectorAll('#airport_panel .age')) a.textContent = 'yesterday 20:50Z · 1 day 3 h 31 min ago';
        const nm = document.querySelector('#airport_panel .apName, #airport_panel .apHead h2, #airport_panel h2'); if (nm) nm.textContent = 'London Heathrow International Airport and Aerodrome of the Royal Borough';
        for (const t of document.querySelectorAll('#airport_panel .ibTile b')) t.textContent = 'Broken 2,500 ft · Overcast 3,400 ft · Few 4,500 ft cumulonimbus';
      });
    }
    AIRPT.close && AIRPT.close(); await w(400);
  }
  // wider glyphs than the headless fallback font (a real device renders Inter at its own metrics, and the user saw an overlap this test did not): +0.06em letter-spacing
  for (const cat of ['VFR', 'LIFR']) {
    wxMode = {cat, ageMin: 31};
    await record('airport ' + cat + ', wide font (+0.06em)', async () => {
      await AIRPT.refreshWx(); await AIRPT.searchAndOpen('EGLL'); await w(1800);
      const st = document.createElement('style'); st.id = 'wideFontProbe'; st.textContent = '#airport_panel, #airport_panel * , #selected_infoblock, #selected_infoblock * { letter-spacing: 0.06em !important; }'; document.head.appendChild(st); await w(500);
    });
    const pr = document.getElementById('wideFontProbe'); if (pr) pr.remove();
    AIRPT.close && AIRPT.close(); await w(300);
  }
  window.fetch = fetch0; wxMode = null;

  await record('replay open', async () => { if (typeof showReplayBar == 'function') showReplayBar(); await w(1200); });
  if (typeof showReplayBar == 'function') { try { document.getElementById('replayStop') && document.getElementById('replayStop').click(); } catch (e) { /* closed below */ } }
  await w(400);

  for (const sec of ['map', 'aircraft', 'table', 'units', 'photos', 'alerts', 'advanced', 'about']) {
    await record('settings: ' + sec, async () => { openSettings(sec, null); if (phone && (typeof PHONE != 'undefined') && PHONE.settingsPage) PHONE.settingsPage('page'); await w(600); });
  }
  return {viewport: [VW, VH], phone, states: perState, failures};
})()
