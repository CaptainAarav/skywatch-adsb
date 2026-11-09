// Airport layer cost (software GL in headless Chromium: relative numbers only). TWO measures per state: `submit` = m.redraw() CPU time alone
// (what the earlier 6.0 / 13.6 ms figures were: placement, buffers and GL command submission) and `synced` = redraw plus a 1x1 readPixels, so
// the software rasteriser's work is included (about 200 ms per frame here, so its noise is far above 3 ms). For zoom 5, 7 and 9 over the UK it renders 2 x 60 frames
// with the airport layers on and 2 x 60 with them off (interleaved, so drift hits both equally). Each frame is m.redraw() followed by a 1x1
// gl.readPixels so the GPU work is included. Prints median and 95th percentile of the 120 frames per state, and the added median.
(async () => {
  const w = ms => new Promise(r => setTimeout(r, ms));
  const m = MLR.map, L = MLR.airportTierLayers(), gl = m.getCanvas().getContext('webgl2') || m.getCanvas().getContext('webgl'), buf = new Uint8Array(4);
  const idle = () => new Promise(r => { m.once('idle', r); m.triggerRepaint(); setTimeout(r, 1200); });
  const vis = on => { for (const id of L) m.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none'); };
  async function fast(n) { const t = []; for (let i = 0; i < n; i++) { const a = performance.now(); m.redraw(); t.push(performance.now() - a); await new Promise(r => setTimeout(r, 4)); } return t; }
  async function block(n) { const t = []; for (let i = 0; i < n; i++) { const a = performance.now(); m.redraw(); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, buf); t.push(performance.now() - a); } return t; }
  const stat = t => { t = t.slice().sort((a, b) => a - b); return {median: +t[Math.floor(t.length / 2)].toFixed(2), p95: +t[Math.floor(t.length * 0.95)].toFixed(2), frames: t.length}; };
  const out = {};
  for (const z of (window.PERF_ZOOMS || [5, 7, 9])) {
    m.jumpTo({center: [-2.0, 53.0], zoom: z, pitch: 0, bearing: 0}); await idle(); await w(1200); await idle();
    const on = [], off = [], fon = [], foff = [];
    await block(5); vis(true); await idle();
    const rendered = new Set(m.queryRenderedFeatures({layers: L}).map(f => f.properties.icao)).size;
    for (let r = 0; r < 4; r++) { vis(true); await idle(); fon.push(...await fast(40)); vis(false); await idle(); foff.push(...await fast(40)); }
    if (!window.PERF_NOSYNC) for (let r = 0; r < 2; r++) { vis(true); await idle(); on.push(...await block(30)); vis(false); await idle(); off.push(...await block(30)); }
    vis(true);
    const a = stat(on.length ? on : [0]), b = stat(off.length ? off : [0]), fa = stat(fon), fb = stat(foff);
    out['z' + z] = {submit: {layersOn: fa, layersOff: fb, addedMedianMs: +(fa.median - fb.median).toFixed(2)}, synced: {layersOn: a, layersOff: b, addedMedianMs: +(a.median - b.median).toFixed(2)}, renderedAirports: rendered};
  }
  return {perFrameSoftwareGL: out, layers: L.length, sources: Object.keys(m.getStyle().sources).length};
})()
