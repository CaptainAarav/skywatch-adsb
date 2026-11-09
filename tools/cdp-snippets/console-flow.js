// Run via CDP: load, select an aircraft, open an airport, open Settings, close everything. Console errors are printed by the harness (log.error / EXC lines).
(async () => {
  const w = ms => new Promise(r => setTimeout(r, ms));
  const pl = g.planesOrdered.find(p => p.position);
  selectPlaneByHex(pl.icao, {follow: false}); await w(1500);
  const sel = document.body.classList.contains('infoOpen');
  document.getElementById('infoblock_close').click(); await w(500);
  await AIRPT.searchAndOpen('EGLL'); await w(2500);
  const ap = document.body.classList.contains('airportOpen');
  AIRPT.close(); await w(500);
  document.querySelector('#layers_button').click(); await w(800);
  const st = !!document.querySelector('#settings_infoblock.settingsOpen, body.settingsOpen, #settings_infoblock:not(.hidden)');
  document.querySelector('#settings_close').click(); await w(600);
  const failures = [];
  if (!sel) failures.push('selecting an aircraft did not open the selected panel');
  if (!ap) failures.push('the airport panel did not open');
  if (!st) failures.push('Settings did not open');
  if (document.body.classList.contains('airportOpen') || document.body.classList.contains('infoOpen')) failures.push('a panel is still open after closing everything');
  return {selected: sel, airport: ap, settings: st, body: document.body.className, failures};
})()
