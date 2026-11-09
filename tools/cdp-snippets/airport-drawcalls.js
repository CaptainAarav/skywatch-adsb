// Deterministic airport layer cost (no timing noise): GL draw calls and uploaded bytes per redraw with the airport layers on and off, at zoom 5, 7 and 9
// over the UK. Wall-clock frame times in headless software GL on a shared machine vary by more than the effect (95th percentile ~1 s), so the
// draw-call count is the number to compare before and after a change.
(async () => {
  const w = ms => new Promise(r => setTimeout(r, ms));
  const m = MLR.map, L = MLR.airportTierLayers(), gl = m.getCanvas().getContext('webgl2') || m.getCanvas().getContext('webgl');
  const idle = () => new Promise(r => { m.once('idle', r); m.triggerRepaint(); setTimeout(r, 1500); });
  const vis = on => { for (const id of L) m.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none'); };
  let draws = 0, bufBytes = 0;
  for (const k of ['drawElements', 'drawArrays', 'drawElementsInstanced', 'drawArraysInstanced']) { const o = gl[k].bind(gl); gl[k] = function () { draws++; return o.apply(null, arguments); }; }
  for (const k of ['bufferData', 'bufferSubData']) { const o = gl[k].bind(gl); gl[k] = function (t, d) { bufBytes += (d && d.byteLength) || 0; return o.apply(null, arguments); }; }
  const per = async () => { await idle(); draws = 0; bufBytes = 0; for (let i = 0; i < 10; i++) { m.redraw(); await w(30); } return {draws: draws / 10, uploadBytes: bufBytes / 10}; };
  const out = {};
  for (const z of [5, 7, 9]) {
    m.jumpTo({center: [-2.0, 53.0], zoom: z, pitch: 0, bearing: 0}); await idle(); await w(1200); await idle();
    vis(true); const on = await per(); vis(false); const off = await per(); vis(true); await idle();
    out['z' + z] = {drawsOn: on.draws, drawsOff: off.draws, addedDraws: on.draws - off.draws, uploadBytesOn: on.uploadBytes, uploadBytesOff: off.uploadBytes, airports: new Set(m.queryRenderedFeatures({layers: L}).map(f => f.properties.icao)).size};
  }
  const perLayer = {};
  for (const z of [5, 7, 9]) {
    m.jumpTo({center: [-2.0, 53.0], zoom: z, pitch: 0, bearing: 0}); await idle(); await w(1000); await idle();
    vis(false); const base = await per(); perLayer['z' + z] = {};
    for (const id of L) { m.setLayoutProperty(id, 'visibility', 'visible'); const r = await per(); perLayer['z' + z][id.replace('tar-apt-', '')] = +(r.draws - base.draws).toFixed(0); m.setLayoutProperty(id, 'visibility', 'none'); }
    vis(true);
  }
  return {perFrame: out, perLayerAddedDraws: perLayer};
})()
