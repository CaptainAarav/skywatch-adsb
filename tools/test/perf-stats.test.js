// The maths behind the performance overlay: nearest-rank percentiles, the 120-frame ring, fps over a window, the report and the read-out lines.
const assert = require('assert');
const P = require('../../html/ui/perf-stats.js');
// percentile: nearest rank
assert.strictEqual(P.percentile([], .5), null);
assert.strictEqual(P.percentile([5], .5), 5);
assert.strictEqual(P.percentile([1, 2, 3, 4], .5), 2);          // ceil(0.5*4)=2nd value
assert.strictEqual(P.percentile([1, 2, 3, 4], .95), 4);
const hundred = Array.from({length: 100}, (_, i) => i + 1);
assert.strictEqual(P.percentile(hundred, .5), 50);
assert.strictEqual(P.percentile(hundred, .95), 95);
assert.strictEqual(P.percentile(hundred, 1), 100);
assert.strictEqual(P.percentile(hundred, 0), 1);
// ring: keeps the last N, oldest first
const r = P.makeRing(4);
assert.deepStrictEqual(r.values(), []);
[1, 2, 3].forEach(v => r.push(v)); assert.deepStrictEqual(r.values(), [1, 2, 3]); assert.strictEqual(r.count(), 3);
[4, 5, 6].forEach(v => r.push(v)); assert.deepStrictEqual(r.values(), [3, 4, 5, 6]); assert.strictEqual(r.count(), 4);
r.clear(); assert.deepStrictEqual(r.values(), []);
// 120-frame window
const w = P.makeRing(120); for (let i = 0; i < 300; i++) w.push(i);
assert.strictEqual(w.count(), 120); assert.strictEqual(w.values()[0], 180); assert.strictEqual(w.values()[119], 299);
// summarize: fps is frames per second over the window; 60 frames of 16.667 ms = 60 fps; a slow outlier lowers fps and raises p95 / max but not p50
const even = Array(60).fill(1000 / 60), s1 = P.summarize(even);
assert.ok(Math.abs(s1.fps - 60) < 1e-9); assert.ok(Math.abs(s1.p50 - 1000 / 60) < 1e-9); assert.strictEqual(s1.n, 60);
const mixed = Array(99).fill(10).concat([210]), s2 = P.summarize(mixed);
assert.strictEqual(s2.p50, 10); assert.strictEqual(s2.p95, 10); assert.strictEqual(s2.max, 210);
assert.ok(Math.abs(s2.fps - 1000 * 100 / 1200) < 1e-9);            // 1200 ms for 100 frames
assert.deepStrictEqual(P.summarize([]), {n: 0, fps: null, p50: null, p95: null, max: null});
// report: rounding, nulls and units
const rep = P.buildReport({when: 'T', frames: mixed, layer: [1, 2, 3, 4, 100], instances: 42, zoom: 13.456, pitch: 55.04, terrain: true, heapBytes: 50 * 1048576, viewport: [1440, 900], dpr: 2});
assert.strictEqual(rep.fps, 83.3); assert.strictEqual(rep.frameMsP50, 10); assert.strictEqual(rep.frameMsP95, 10); assert.strictEqual(rep.frameSamples, 100);
assert.strictEqual(rep.layerCpuMsP50, 3); assert.strictEqual(rep.layerCpuMsP95, 100); assert.strictEqual(rep.layerSamples, 5);
assert.strictEqual(rep.modelInstances, 42); assert.strictEqual(rep.zoom, 13.46); assert.strictEqual(rep.pitch, 55); assert.strictEqual(rep.terrain, true); assert.strictEqual(rep.jsHeapMB, 50);
const none = P.buildReport({});
assert.strictEqual(none.fps, null); assert.strictEqual(none.layerCpuMsP50, null); assert.strictEqual(none.jsHeapMB, null); assert.strictEqual(none.terrain, null); assert.strictEqual(none.modelInstances, null);
// read-out
const L = P.lines(rep); assert.strictEqual(L.length, 4);
assert.ok(/fps 83.3/.test(L[0]) && /p50 10 ms/.test(L[0]) && /p95 10 ms/.test(L[0]));
assert.ok(/3D layer CPU p50 3 ms/.test(L[1]) && /models 42/.test(L[1]));
assert.ok(/zoom 13.46/.test(L[2]) && /terrain on/.test(L[2])); assert.ok(/JS heap 50 MB/.test(L[3]));
assert.ok(P.lines(none).every(l => /-/.test(l)));
// Phase 42: counters and quality tier in the report and the read-out (absent -> null and no extra lines)
assert.strictEqual(rep.counters, null); assert.strictEqual(rep.quality, null);
const C = {drawCallsP50: 120, drawCallsP95: 150, trianglesP50: 90000, trianglesP95: 95000, textureUploadsPerFrame: 0.25, tiles: {vector: {loaded: 20, inFlight: 2}, raster: {loaded: 6, inFlight: 0}, dem: {loaded: 9, inFlight: 1}, symbolInstances: 1500},
  symbolLayersDrawn: 14, queryRenderedFeaturesPerSec: 30, queryTerrainElevationPerSec: 5, jsAllocMBps: 1.5, canvasPx: [2880, 1800], canvasMP: 5.18, pixelRatio: 2};
const rep2 = P.buildReport({frames: mixed, counters: C, quality: {mode: 'auto', level: 2, tier: 'no shadows', software: true, renderer: 'llvmpipe', junk: 1}});
assert.deepStrictEqual(rep2.quality, {mode: 'auto', level: 2, tier: 'no shadows', software: true, renderer: 'llvmpipe'}); assert.strictEqual(rep2.counters.drawCallsP50, 120);
const L2 = P.lines(rep2); assert.ok(L2.length > 4);
assert.ok(L2.some(l => /quality auto \/ no shadows \(level 2\)\s+SOFTWARE RENDERER/.test(l)), 'tier and software flag are shown');
assert.ok(L2.some(l => /draws p50 120 p95 150/.test(l)) && L2.some(l => /tiles vec 20\+2/.test(l) && /symbols 14\/1500/.test(l)) && L2.some(l => /queries\/s rendered 30 terrain 5/.test(l)) && L2.some(l => /canvas 2880x1800 \(5.18 MP\) ratio 2/.test(l)));
console.log('perf-stats: ok');
