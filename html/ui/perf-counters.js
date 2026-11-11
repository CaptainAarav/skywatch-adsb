"use strict";
// Skywatch ADS-B: device-independent render counters (Phase 42). Host GPU time cannot be measured on every machine, so this counts WORK instead: WebGL draw calls,
// triangles and texture uploads per frame (the gl methods are wrapped on the map's one context, which three.js shares), tiles loaded and in flight by kind, symbol layers
// and symbol instances in view, expensive queries per second, JS heap growth, canvas pixels. Zero cost until start(); stop() restores every wrapped method.
// Pure maths (percentile) comes from PERFSTATS. Used by the ?perf=1 overlay, its JSON report, and tools/cdp-snippets/perf-counters.js.
const PERFC = (function () {
    const RING = 240;
    let map = null, gl = null, on = false, orig = null, onRender = null, heapT = 0;
    const cur = {draws: 0, tris: 0, uploads: 0, tiny: 0};
    const ring = {draws: new Float64Array(RING), tris: new Float64Array(RING), uploads: new Float64Array(RING), tiny: new Float64Array(RING), n: 0};
    const q = {rendered: [], terrain: []};      // timestamps (ms) of the last second
    const heap = {last: 0, grown: 0, since: 0, mbps: 0};
    function trisOf(mode, count) { return mode === 4 ? (count / 3) | 0 : (mode === 5 || mode === 6) ? Math.max(0, count - 2) : 0; }
    function wrapGL() {
        orig = {};
        const w = (name, fn) => { const f = gl[name]; if (typeof f !== 'function') return; orig[name] = f; gl[name] = function () { fn.apply(null, arguments); return f.apply(this, arguments); }; };
        w('drawElements', (mode, count) => { cur.draws++; cur.tris += trisOf(mode, count); });
        w('drawArrays', (mode, first, count) => { cur.draws++; cur.tris += trisOf(mode, count); });
        w('drawElementsInstanced', (mode, count, type, off, inst) => { cur.draws++; cur.tris += trisOf(mode, count) * (inst || 1); });
        w('drawArraysInstanced', (mode, first, count, inst) => { cur.draws++; cur.tris += trisOf(mode, count) * (inst || 1); });
        w('drawRangeElements', (mode, s, e, count) => { cur.draws++; cur.tris += trisOf(mode, count); });
        // uploads: a texture image of a real size. 1x1 placeholders (MapLibre creates a few every frame) are counted apart, they cost almost nothing.
        w('texImage2D', function () { (arguments.length >= 9 && arguments[3] <= 1 && arguments[4] <= 1) ? cur.tiny++ : cur.uploads++; });
        w('texSubImage2D', function () { (arguments.length >= 9 && arguments[4] <= 1 && arguments[5] <= 1) ? cur.tiny++ : cur.uploads++; });
        for (const n of ['texImage3D', 'texSubImage3D', 'compressedTexImage2D', 'compressedTexSubImage2D']) w(n, () => { cur.uploads++; });
    }
    function wrapQueries() {
        const m = map, add = (name, list) => { const f = m[name]; if (typeof f !== 'function') return; orig['m.' + name] = f; m[name] = function () { list.push(performance.now()); return f.apply(this, arguments); }; };
        add('queryRenderedFeatures', q.rendered); add('queryTerrainElevation', q.terrain);
    }
    function perSec(list) { const t = performance.now(); while (list.length && t - list[0] > 1000) list.shift(); return list.length; }
    function tiles() {
        const out = {vector: {loaded: 0, inFlight: 0}, raster: {loaded: 0, inFlight: 0}, dem: {loaded: 0, inFlight: 0}, symbolInstances: 0};
        try {
            const sc = map.style && (map.style.tileManagers || map.style.sourceCaches);
            for (const id in sc) {
                const c = sc[id], src = c._source || c.source, t = src && src.type, k = t === 'vector' ? 'vector' : t === 'raster' ? 'raster' : t === 'raster-dem' ? 'dem' : null;
                if (!k) continue;
                const tl = c._inViewTiles || c._tiles || {};
                for (const key in tl) {
                    const tile = tl[key];
                    if (tile.state === 'loaded' || tile.state === 'reloading') out[k].loaded++;
                    if (tile.state === 'loading' || tile.state === 'reloading') out[k].inFlight++;
                    if (k === 'vector' && tile.buckets) for (const b in tile.buckets) { const x = tile.buckets[b]; if (x && x.symbolInstances) out.symbolInstances += x.symbolInstances.length; }
                }
            }
        } catch (e) { /* private API shape changed: leave zeros */ }
        return out;
    }
    function symbolLayers() {
        let n = 0;
        try { const z = map.getZoom(); for (const l of map.getStyle().layers) if (l.type === 'symbol' && !(l.layout && l.layout.visibility === 'none') && (l.minzoom == null || z >= l.minzoom) && (l.maxzoom == null || z < l.maxzoom)) n++; } catch (e) { /* style loading */ }
        return n;
    }
    function sampleHeap(now) {
        if (!performance.memory) return;
        const h = performance.memory.usedJSHeapSize;
        if (heap.last && h > heap.last) heap.grown += h - heap.last;      // growth between samples; a GC drop is not counted
        heap.last = h;
        if (!heap.since) heap.since = now;
        if (now - heap.since >= 1000) { heap.mbps = heap.grown / 1048576 / ((now - heap.since) / 1000); heap.grown = 0; heap.since = now; }
    }
    function start(m) {
        if (on) return;
        map = m || MLR.map; if (!map) return;
        gl = map.painter && map.painter.context && map.painter.context.gl; if (!gl) return;
        on = true; wrapGL(); wrapQueries();
        onRender = () => {
            const i = ring.n % RING; ring.draws[i] = cur.draws; ring.tris[i] = cur.tris; ring.uploads[i] = cur.uploads; ring.tiny[i] = cur.tiny; ring.n++;
            cur.draws = cur.tris = cur.uploads = cur.tiny = 0;
            sampleHeap(performance.now());
        };
        map.on('render', onRender);
    }
    function stop() {
        if (!on) return;
        on = false; map.off('render', onRender);
        for (const k in orig) { if (k.indexOf('m.') === 0) map[k.slice(2)] = orig[k]; else gl[k] = orig[k]; }
        orig = null; ring.n = 0; cur.draws = cur.tris = cur.uploads = cur.tiny = 0;
    }
    function window_(arr) { const c = Math.min(ring.n, RING), out = new Array(c); for (let i = 0; i < c; i++) out[i] = arr[(ring.n - c + i) % RING]; return out; }
    function snapshot() {
        if (!on) return null;
        const P = typeof PERFSTATS !== 'undefined' ? PERFSTATS : null, pc = (a, k) => { const s = a.slice().sort((x, y) => x - y); return P ? P.percentile(s, k) : null; };
        const d = window_(ring.draws), t = window_(ring.tris), u = window_(ring.uploads), tn = window_(ring.tiny), cv = map.getCanvas();
        return {
            frames: d.length,
            drawCallsP50: pc(d, 0.5), drawCallsP95: pc(d, 0.95), trianglesP50: pc(t, 0.5), trianglesP95: pc(t, 0.95), textureUploadsPerFrame: d.length ? u.reduce((a, b) => a + b, 0) / d.length : null, tinyUploadsPerFrame: d.length ? tn.reduce((a, b) => a + b, 0) / d.length : null,
            tiles: tiles(), symbolLayersDrawn: symbolLayers(),
            queryRenderedFeaturesPerSec: perSec(q.rendered), queryTerrainElevationPerSec: perSec(q.terrain),
            jsAllocMBps: performance.memory ? Math.round(heap.mbps * 100) / 100 : null,
            canvasPx: [cv.width, cv.height], canvasMP: Math.round(cv.width * cv.height / 1e4) / 100, pixelRatio: map.getPixelRatio ? map.getPixelRatio() : window.devicePixelRatio,
        };
    }
    function reset() { ring.n = 0; cur.draws = cur.tris = cur.uploads = cur.tiny = 0; }
    return {start, stop, snapshot, reset, isOn: () => on};
})();
