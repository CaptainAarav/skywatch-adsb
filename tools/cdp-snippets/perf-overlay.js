// Performance overlay (DOM test). Off by default and absent from the DOM; PERF.set(true) adds the read-out (pointer-events none) and the separate Copy report
// button (pointer-events auto); the read-out lists fps, frame ms p50/p95, 3D layer CPU, model instances, zoom, pitch, terrain and heap; Copy report copies JSON with those
// numbers; the Settings > Advanced toggle exists and drives it; turning it off removes everything and stops the frame loop and the layer's timing.
(async () => {
  const w = ms => new Promise(r => setTimeout(r, ms));
  const checks = {}, failures = [], numbers = {};
  const check = (n, ok, d) => { checks[n] = !!ok; if (!ok) failures.push(n + (d !== undefined ? ' ' + JSON.stringify(d).slice(0, 220) : '')); };
  for (let i = 0; i < 240 && !((typeof MLR != 'undefined') && MLR.map && MLR.map.loaded() && (typeof PERF != 'undefined')); i++) await w(250);
  check('off by default: no read-out and no copy button in the DOM', !document.getElementById('perfOverlay') && !document.getElementById('perfCopy') && !PERF.isOn());
  const t0 = !!MLR.modelsStats.timing;
  check('off: the 3D layer timing ring is not running because of the overlay', !t0 || !PERF.isOn());
  const tog = document.querySelector('#set_advanced #perfOverlay_toggle, #set_advanced [id*="perfOverlay"]') || [...document.querySelectorAll('#settings_infoblock .setRow, #settings_infoblock .settingsOptionContainer')].find(e => /Performance overlay/.test(e.textContent));
  check('Settings > Advanced has a "Performance overlay" toggle', !!tog && !!tog.closest('#set_advanced'), !!tog);
  let copied = null;
  try { Object.defineProperty(navigator, 'clipboard', {value: {writeText: t => { copied = t; return Promise.resolve(); }}, configurable: true}); } catch (e) { /* keep the real one */ }
  toggles['perfOverlay'].toggle(true); await w(1800);
  const el = document.getElementById('perfOverlay'), btn = document.getElementById('perfCopy');
  check('on: read-out and Copy button exist', !!el && !!btn && PERF.isOn());
  if (el && btn) {
    check('the read-out never takes pointer events; the button does', getComputedStyle(el).pointerEvents === 'none' && getComputedStyle(btn).pointerEvents === 'auto');
    const t = el.textContent;
    numbers.text = t;
    check('the read-out shows fps, frame p50/p95, 3D layer CPU, models, zoom, pitch, terrain and heap', /fps/.test(t) && /frame p50/.test(t) && /p95/.test(t) && /3D layer CPU/.test(t) && /models/.test(t) && /zoom/.test(t) && /pitch/.test(t) && /terrain/.test(t) && /JS heap/.test(t), t);
    check('the 3D layer timing runs while the overlay is on', MLR.modelsStats.timing === true);
    btn.click(); await w(400);
    let j = null; try { j = JSON.parse(copied); } catch (e) { /* not JSON */ }
    numbers.report = j;
    check('Copy report copies a JSON report with the same numbers', !!j && 'fps' in j && 'frameMsP50' in j && 'frameMsP95' in j && 'layerCpuMsP50' in j && 'modelInstances' in j && 'zoom' in j && 'pitch' in j && 'terrain' in j && 'jsHeapMB' in j, copied && copied.slice(0, 120));
    check('the report reflects this map (zoom matches within 0.01)', !!j && Math.abs(j.zoom - MLR.map.getZoom()) < 0.011, j && j.zoom);
  }
  toggles['perfOverlay'].toggle(false); await w(500);
  check('off again: DOM removed, loop stopped, layer timing restored', !document.getElementById('perfOverlay') && !document.getElementById('perfCopy') && !PERF.isOn() && MLR.modelsStats.timing === t0);
  return {checks, failures, numbers};
})()
