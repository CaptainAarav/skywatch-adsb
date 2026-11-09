// Run in the page via CDP at 1440x900 (desktop) and again in a phone emulation (390x844). Selects an aircraft and prints the selected-aircraft
// panel's component tree: data-component / data-part attributes, class names and element ids of every instrument card. Desktop and phone
// must print the SAME signature (one implementation; only layout and density differ).
(async () => {
  const w = ms => new Promise(r => setTimeout(r, ms));
  const pl = g.planesOrdered.find(p => p.position && typeof p.altitude == 'number' && typeof p.track == 'number' && typeof p.gs == 'number') || g.planesOrdered.find(p => p.position);
  selectPlaneByHex(pl.icao, {follow: false}); await w(1800);
  const root = document.querySelector('#selected_infoblock');
  const nodes = [...root.querySelectorAll('[data-component], [data-part]')];
  const sig = nodes.map(e => [e.dataset.component || '', e.dataset.part || '', e.tagName.toLowerCase(), e.className.split(' ').filter(c => c && !/^(on|na|hidden)$/.test(c)).sort().join('.')].join('/'));
  const ids = [...root.querySelectorAll('.ibInstGrid [id]')].map(e => e.id);
  return {signature: sig.join('|'), count: nodes.length, ids: ids.join(','), body: document.body.className, vw: innerWidth};
})()
