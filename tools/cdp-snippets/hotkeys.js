// Hotkey and button check (DOM/state assertions). Every key and button must CHANGE the state it controls; for the two that depend on the
// starting state (#view_list, #north_up) the app is first put in the OPPOSITE state, then the control is used and the new state asserted.
(async () => { try {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const key = (k) => document.body.dispatchEvent(new KeyboardEvent('keydown', {key: k, bubbles: true}));
  const cls = id => document.querySelector(id) && document.querySelector(id).classList.contains('activeButton');
  const out = {};
  const chk = async (k, get, n=1) => { const a = JSON.stringify(get()); key(k); await sleep(250); const b = JSON.stringify(get()); out[k] = (a !== b ? 'OK ' : 'NOCHANGE ') + a + ' -> ' + b; };
  await chk('l', () => [g.enableLabels, cls('#L')]);
  await chk('o', () => [g.extendedLabels, cls('#O')]);
  await chk('k', () => [trackLabels, cls('#K')]);
  await chk('t', () => [SelectedAllPlanes, cls('#T')]);
  key('t'); await sleep(200);
  await chk('p', () => [noVanish, cls('#P')]);
  await chk('m', () => [multiSelect, cls('#M')]);
  key('m'); await sleep(200);
  await chk('u', () => [onlyMilitary, cls('#U')]);
  key('u'); await sleep(200);
  await chk('b', () => [toggles['MapDim'].state, cls('#B')]);
  await chk('v', () => [tableInView, cls('#V')]);
  await chk('r', () => [SelectedPlane && SelectedPlane.icao]);
  await chk('f', () => [FollowSelected, cls('#F')]);
  await chk('i', () => [onlySelected, cls('#I')]);
  key('i'); await sleep(200);
  await chk('c', () => [SelectedPlane && SelectedPlane.icao]);
  await chk('e', () => [mapa.getZoom().toFixed(2)]);
  await chk('q', () => [mapa.getZoom().toFixed(2)]);
  await chk('+', () => [mapa.getZoom().toFixed(2)]);
  await chk('-', () => [mapa.getZoom().toFixed(2)]);
  for (const k of ['w','a','s','d','ArrowUp']) await chk(k, () => mapa.getCenterProj().map(v=>v.toFixed(0)));
  await chk('h', () => mapa.getCenterProj().map(v=>v.toFixed(0)));
  await chk('T', () => [filterTISB]);
  key('T'); await sleep(100);
  await chk('G', () => [nogpsOnly]);
  key('G'); await sleep(100);
  await chk('L', () => [toggles['lastLeg'] && toggles['lastLeg'].state]);
  key('L'); await sleep(100);
  await chk('H', () => [hideButtons, document.body.classList.contains('buttonsHidden'), getComputedStyle(document.getElementById('toolbar')).display]);
  key('H'); await sleep(100);
  await chk('Y', () => [getComputedStyle(document.getElementById('replayBar')).display, document.getElementById('RP').classList.contains('on')]);
  key('Y'); await sleep(300);
  await chk('/', () => [document.activeElement && document.activeElement.id]);
  document.activeElement.blur();
  // r again then Escape deselect
  key('r'); await sleep(400);
  await chk('Escape', () => [SelectedPlane && SelectedPlane.icao]);
  // buttons by click
  const clickChk = async (id, get) => { const a = JSON.stringify(get()); document.querySelector(id).click(); await sleep(250); out['click ' + id] = (a !== JSON.stringify(get()) ? 'OK ' : 'NOCHANGE ') + a + ' -> ' + JSON.stringify(get()); };
  await clickChk('#L', () => [g.enableLabels, cls('#L')]);
  const failures = [];
  document.querySelector('#view_map').click(); await sleep(400);
  const listBefore = document.body.classList.contains('listOpen');
  document.querySelector('#view_list').click(); await sleep(400);
  const listAfter = document.body.classList.contains('listOpen');
  out['#view_list from map view'] = listBefore === false && listAfter === true ? 'OK map -> list' : 'BAD ' + listBefore + ' -> ' + listAfter;
  document.querySelector('#view_map').click(); await sleep(400);
  out['#view_map from list view'] = document.body.classList.contains('listOpen') === false ? 'OK list -> map' : 'BAD still listOpen';
  await clickChk('#filters_button', () => [document.getElementById('filterPopover').hidden]);
  await clickChk('#hide_panels_button', () => [document.body.className]);
  MLR.map.jumpTo({bearing: 40}); await sleep(600);
  const b0 = MLR.map.getBearing();
  document.querySelector('#north_up').click(); await sleep(1500);
  const b1 = MLR.map.getBearing();
  out['#north_up from bearing 40'] = Math.abs(b0 - 40) < 1 && Math.abs(b1) < 1 ? 'OK 40 -> 0' : 'BAD ' + b0 + ' -> ' + b1;
  for (const k of Object.keys(out)) if (!out[k].startsWith('OK')) failures.push(k + ': ' + out[k]);
  return {failures, keys: Object.keys(out).length, out};
} catch(e) { return {failures: ['exception ' + e + ' ' + (e.stack||'').split('\n').slice(0,4).join('|')]}; }
})()
