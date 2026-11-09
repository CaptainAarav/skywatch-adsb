// Layout-collision test (DOM bounding boxes only). Run via CDP in a phone emulation at the viewport under test (and once desktop).
// For every UI state it asserts:
//  1. no two visible floating controls overlap;
//  2. no floating control overlaps the content box of any text node or interactive element inside an open panel;
//  3. no label/button is clipped (scrollWidth > clientWidth under overflow hidden, ellipsis text excepted unless it is a button);
//  4. every visible panel text/interactive element is inside the viewport horizontally.
// Prints {viewport, states, failures}.
(async () => {
  const w = ms => new Promise(r => setTimeout(r, ms));
  const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
  const VW = innerWidth, VH = innerHeight, failures = [], states = [];
  const shown = e => { for (let n = e; n && n.nodeType === 1; n = n.parentElement) { const cs = getComputedStyle(n); if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity === 0 || n.hidden) return false; } return true; };
  const ov = (a, b) => a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5;
  const clipRect = (e, r) => {
    let out = {left: Math.max(r.left, 0), top: Math.max(r.top, 0), right: Math.min(r.right, VW), bottom: Math.min(r.bottom, VH)};
    for (let n = e.parentElement; n && n !== document.body; n = n.parentElement) {
      const cs = getComputedStyle(n);
      if (/(hidden|auto|scroll|clip)/.test(cs.overflowX + cs.overflowY)) { const b = n.getBoundingClientRect(); out = {left: Math.max(out.left, b.left), top: Math.max(out.top, b.top), right: Math.min(out.right, b.right), bottom: Math.min(out.bottom, b.bottom)}; }
    }
    return out.right > out.left && out.bottom > out.top ? out : null;
  };
  const PANELS = '#phoneSheet, #replayBar, #historyBar, #settings_infoblock, #airport_panel, .palBox, .sk-dialog, #filterPopover, #columnsPopover';
  const floating = () => $$('#controlStack button, .ol-attribution.ol-control, #phoneInfoCard').filter(e => shown(e) && e.getBoundingClientRect().width > 0 && !e.closest('#viewMenu'));
  const label = e => (e.id ? '#' + e.id : e.tagName.toLowerCase() + '.' + String(e.className).split(' ')[0]) + (e.textContent ? '"' + e.textContent.trim().slice(0, 14) + '"' : '');
  function contentBoxes(panel) {
    const out = [];
    const walker = document.createTreeWalker(panel, NodeFilter.SHOW_TEXT);
    for (let t; (t = walker.nextNode());) {
      if (!t.nodeValue.trim() || !t.parentElement || !shown(t.parentElement) || t.parentElement.closest('script,style')) continue;
      const rg = document.createRange(); rg.selectNodeContents(t);
      for (const rc of rg.getClientRects()) { const c = clipRect(t.parentElement, rc); if (c && rc.width > 1) out.push({el: t.parentElement, r: c}); }
    }
    for (const e of panel.querySelectorAll('button, a[href], input, select, [role=slider], [role=tab]')) { if (!shown(e)) continue; const c = clipRect(e, e.getBoundingClientRect()); if (c) out.push({el: e, r: c}); }
    return out;
  }
  function audit(name) {
    const f = [], fl = floating();
    const rects = fl.map(e => ({e, r: e.getBoundingClientRect()}));
    for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) if (ov(rects[i].r, rects[j].r) && !rects[i].e.contains(rects[j].e) && !rects[j].e.contains(rects[i].e)) f.push('floating ' + label(rects[i].e) + ' overlaps ' + label(rects[j].e));
    const seen = new Set();
    for (const p of $$(PANELS)) {
      if (!shown(p) || p.getBoundingClientRect().width < 20) continue;
      for (const c of contentBoxes(p)) {
        if (seen.has(c.el)) continue;
        for (const x of rects) { if (c.el === x.e || x.e.contains(c.el) || c.el.contains(x.e)) continue; if (ov(c.r, x.r)) { seen.add(c.el); f.push('floating ' + label(x.e) + ' covers ' + label(c.el)); break; } }
        const full = c.el.getBoundingClientRect();
        if (full.left < -0.5 || full.right > VW + 0.5) { if (!c.el.closest('.psBody, #sidebar_canvas, .ibScroll')) f.push(label(c.el) + ' outside viewport horizontally'); }
      }
      for (const e of p.querySelectorAll('*')) {
        if (!shown(e)) continue; const cs = getComputedStyle(e);
        if (!/(hidden|clip)/.test(cs.overflowX) || e.scrollWidth <= e.clientWidth + 1 || e.clientWidth <= 2) continue;
        const isBtn = /^(BUTTON|A)$/.test(e.tagName) || e.getAttribute('role') === 'tab' || e.classList.contains('tb');
        if (cs.textOverflow === 'ellipsis' && !isBtn) continue;
        if (!isBtn && !e.textContent.trim() && !e.children.length) continue;
        if (!isBtn && !e.textContent.trim()) continue;
        if (e.closest('.ibCard, .hbody, .histTrack, .hrail, .hticks, svg')) { if (!isBtn) continue; }
        f.push('clipped ' + label(e) + ' ' + e.scrollWidth + '>' + e.clientWidth);
      }
    }
    states.push({state: name, floating: fl.length, problems: f.length});
    for (const m of f) failures.push(name + ': ' + m);
  }
  const closeAll = async () => {
    try { PALETTE.close && PALETTE.close(); } catch (e) {}
    if ($('#replayBar') && getComputedStyle($('#replayBar')).display !== 'none') { const s = $('#replayStop'); if (s) s.click(); }
    if (document.body.classList.contains('airportOpen')) AIRPT.close();
    if (document.body.classList.contains('infoOpen')) $('#infoblock_close').click();
    if (document.body.classList.contains('settingsOpen') && $('#settings_close')) $('#settings_close').click();
    (document.activeElement && document.activeElement.blur && document.activeElement.blur());
    const t1 = $('.psTab:nth-child(1)'); if (t1) t1.click();
    await w(500);
  };
  const phone = document.body.classList.contains('phone');
  const snaps = async (name, n) => { if (!phone) { audit(name); return; } for (let i = 0; i < n; i++) { PHONE.goto(i); await w(450); audit(name + ' snap' + i); } };

  const replayChecks = () => {
    const bar = $('#replayBar'), br = bar.getBoundingClientRect(), f = [];
    const inV = (e, n) => { const r = e.getBoundingClientRect(); if (r.left < br.left - 0.5 || r.right > br.right + 0.5 || r.right > VW + 0.5 || r.left < -0.5) f.push(n + ' outside the replay panel'); if (e.scrollWidth > e.clientWidth + 1) f.push(n + ' clipped'); };
    const live = $('#replayLive'); inV(live, 'LIVE pill'); if (live.textContent.trim() !== 'LIVE') f.push('LIVE pill text is "' + live.textContent.trim() + '"');
    $$('#replaySpeeds button').forEach(b => inV(b, 'speed ' + (b.dataset.speed || 'stop')));
    if ($$('#replaySpeeds button[data-speed]').length < 4) f.push('fewer than 4 speed options');
    const hint = $('#replayTimeHint'); if (hint && hint.textContent.trim().length < 5) f.push('time text empty or short: "' + hint.textContent + '"');
    const cl = $('#controlStack').getBoundingClientRect(); if (phone && cl.bottom > br.top + 1) f.push('cluster bottom ' + Math.round(cl.bottom) + ' is below the replay panel top ' + Math.round(br.top));
    for (const m of f) failures.push('replay: ' + m);
    states.push({state: 'replay checks', problems: f.length});
  };
  await closeAll(); await w(400); audit('default');
  if (phone) { $('.psTab:nth-child(2)').click(); await w(700); await snaps('list', 3); await closeAll(); }
  const pl = g.planesOrdered.find(p => p.position && typeof p.altitude == 'number' && typeof p.track == 'number');
  selectPlaneByHex(pl.icao, {follow: false}); await w(1600); await snaps('selected', 3); await closeAll();
  await AIRPT.searchAndOpen('EGLL'); await w(2500); await snaps('airport', 3); await closeAll();
  $('#RP').style.display = ''; showReplayBar(); await w(1200); audit('replay'); replayChecks();
  await closeAll();
  if (phone) { $('.psTab:nth-child(4)').click(); await w(800); audit('settings root'); }
  else { $('#layers_button').click(); await w(800); audit('settings'); }
  for (const b of $$('#settings_infoblock .setNavBtn')) { if (!shown(b)) continue; b.click(); await w(500); audit('settings page ' + (b.dataset.sec || b.textContent.trim().slice(0, 10))); const back = $('#settings_infoblock .setBack'); if (back && shown(back)) { back.click(); await w(300); } }
  await closeAll();
  try { PALETTE.show(); await w(700); audit('search focused'); } catch (e) {}
  await closeAll();
  return {viewport: [VW, VH], phone, states, failures};
})()
