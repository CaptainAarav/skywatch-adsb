// Primary-control regression test (DOM only). Run via CDP at 1440x900 and in phone emulation at each phone size. For every primary control it asserts:
// it exists exactly once, is visible, sits inside the viewport, is not covered (elementFromPoint at its centre returns it or a child), and is in its
// expected region of the screen. A control that has been moved to a new place fails the region check.
//   desktop: search and settings in the top bar (right), view pill and replay in the top bar (centre), the map-control column on the right edge,
//            credits bottom right.
//   phone:   the one floating cluster on the right edge above the open bottom surface (replay, layers/settings, view mode, credits, locate, compass),
//            search in the bottom sheet.
// Returns {viewport, phone, rows, failures}.
(async () => {
  const w = ms => new Promise(r => setTimeout(r, ms));
  const VW = innerWidth, VH = innerHeight, phone = document.body.classList.contains('phone');
  const failures = [], rows = [];
  const $$ = s => [...document.querySelectorAll(s)];
  const vis = e => { for (let n = e; n && n !== document.documentElement; n = n.parentElement) { const cs = getComputedStyle(n); if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) === 0 || n.hidden) return false; } const b = e.getBoundingClientRect(); return b.width > 4 && b.height > 4; };
  const region = {
    right: b => b.left + b.width / 2 > VW * 0.85,
    topBarCentre: b => b.top + b.height / 2 < 90 && b.left + b.width / 2 > VW * 0.25 && b.left + b.width / 2 < VW * 0.75,
    topBarRight: b => b.top + b.height / 2 < 90 && b.left + b.width / 2 > VW * 0.5,
    bottomRight: b => b.left + b.width / 2 > VW * 0.5 && b.top + b.height / 2 > VH * 0.5,
    clusterRight: b => b.left + b.width / 2 > VW * 0.8 && b.top + b.height / 2 > VH * 0.2,
    bottomHalf: b => b.top + b.height / 2 > VH * 0.5,
  };
  const check = (name, sel, regionKey) => {
    const els = $$(sel);
    const r = {control: name, selector: sel, count: els.length};
    if (els.length !== 1) failures.push(name + ': expected exactly one ' + sel + ', found ' + els.length);
    const e = els[0];
    if (e) {
      r.visible = vis(e);
      if (!r.visible) failures.push(name + ': not visible');
      else {
        const b = e.getBoundingClientRect(); r.box = [Math.round(b.left), Math.round(b.top), Math.round(b.width), Math.round(b.height)];
        if (b.left < -0.5 || b.top < -0.5 || b.right > VW + 0.5 || b.bottom > VH + 0.5) failures.push(name + ': outside the viewport ' + JSON.stringify(r.box));
        const cx = b.left + b.width / 2, cy = b.top + b.height / 2, hit = document.elementFromPoint(cx, cy);
        r.hit = hit ? (hit.id || hit.className.toString().slice(0, 24) || hit.tagName) : null;
        if (!hit || !(e === hit || e.contains(hit))) failures.push(name + ': covered at its centre by ' + r.hit);
        if (!region[regionKey](b)) failures.push(name + ': not in its expected region (' + regionKey + ') ' + JSON.stringify(r.box));
      }
    }
    rows.push(r);
  };
  await w(1500);
  MLR.map.jumpTo({bearing: 35}); await w(900);
  const pl = g.planesOrdered.find(p => p.position);
  if (phone) {
    check('layers (settings opener)', '#layers_button', 'clusterRight');
    check('settings', '#layers_button', 'clusterRight');
    check('locate', '#H', 'clusterRight');
    check('north/compass', '#north_up', 'clusterRight');
    check('replay', '#RP', 'clusterRight');
    check('2D/3D/Globe', '#view_cycle', 'clusterRight');
    check('search', '.psSearch', 'bottomHalf');
    check('info (credits)', '#attr_button', 'clusterRight');
  } else {
    check('layers (settings opener)', '#layers_button', 'right');
    check('settings', '#settingsCog', 'topBarRight');
    check('locate', '#H', 'right');
    check('north/compass', '#north_up', 'right');
    check('replay', '#RP', 'topBarCentre');
    check('2D/3D/Globe', '#view_cycle', 'right');
    check('search', '#search_form', 'topBarRight');
    check('info (credits)', '.ol-attribution.ol-control', 'bottomRight');
  }
  selectPlaneByHex(pl.icao, {follow: false}); await w(1800);
  check('follow (aircraft selected)', '#follow_button', phone ? 'clusterRight' : 'right');
  document.getElementById('infoblock_close').click(); await w(600);
  const rp = document.getElementById('RP');
  if (rp) {
    const inPill = !!rp.closest('#viewPill'), inStack = !!rp.closest('#controlStack');
    if (phone ? !inStack : !inPill) failures.push('replay: parent is ' + (rp.parentElement && rp.parentElement.id) + ', expected ' + (phone ? '#controlStack' : '#viewPill'));
    if (!rp.hasAttribute('onclick') || !/showReplayBar/.test(rp.getAttribute('onclick'))) failures.push('replay: the one handler (showReplayBar) is missing');
  }
  return {viewport: [VW, VH], phone, rows, failures};
})()
