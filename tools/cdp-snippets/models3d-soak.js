// 3D zoom soak: zoom 5 -> 20 -> 5 in 3D, ten times, with real aircraft and models active. The driver fails the snippet on any console.error,
// uncaught exception or log.error; this snippet also fails if the models layer reported a failure or the map lost its 3D view.
(async () => {
  const w = ms => new Promise(r => setTimeout(r, ms));
  for (let i = 0; i < 240 && !((typeof MLR != 'undefined') && MLR.map && MLR.map.loaded() && [...MLR.planes.values()].some(e => e.plane.position && e.plane.proj)); i++) await w(500);
  const m = MLR.map, failures = [], numbers = {};
  const pl = [...MLR.planes.values()].map(e => e.plane).find(p => p.position && p.proj);
  m.jumpTo({center: pl.position, zoom: 12}); await w(500);
  MLR.setView('3d'); await w(4500);
  if (!MLR.modelsActive()) failures.push('models are not active at start');
  const st = MLR.modelsStats; let maxDrawn = 0;
  const step = (z, ms) => new Promise(r => { m.easeTo({zoom: z, duration: ms}); m.once('moveend', () => r()); setTimeout(r, ms + 3000); });
  for (let k = 0; k < 10; k++) {
    await step(20, 700); maxDrawn = Math.max(maxDrawn, st.drawn);
    await step(5, 700);
  }
  numbers.cycles = 10; numbers.maxDrawn = maxDrawn; numbers.frames = st.frames;
  if (MLR.map.getPitch() < 5) failures.push('3D view lost (pitch ' + MLR.map.getPitch() + ')');
  if (!MLR.modelsActive()) failures.push('models stopped being active during the soak');
  return {failures, numbers};
})()
