"use strict";
// Skywatch ADS-B: the maths behind the performance overlay (ui/perf-overlay.js). Pure functions, unit-tested in tools/test/perf-stats.test.js.
const PERFSTATS = (function () {
    // nearest-rank percentile of an ascending array (q in 0..1): the smallest value with at least q of the samples at or below it
    function percentile(sorted, q) {
        const n = sorted.length;
        if (!n) return null;
        const i = Math.min(n - 1, Math.max(0, Math.ceil(q * n) - 1));
        return sorted[i];
    }
    // fixed-size ring of the most recent samples; values() returns them oldest first
    function makeRing(cap) {
        const buf = new Float64Array(cap);
        let n = 0;
        return {
            push(v) { buf[n % cap] = v; n++; },
            count() { return Math.min(n, cap); },
            clear() { n = 0; },
            values() {
                const c = Math.min(n, cap), out = new Array(c), start = n - c;
                for (let i = 0; i < c; i++) out[i] = buf[(start + i) % cap];
                return out;
            },
        };
    }
    // frame times in ms -> {n, fps, p50, p95, max}; fps is frames per second over the window (n frames in sum(ms)), not 1000 / median
    function summarize(ms) {
        const n = ms.length;
        if (!n) return {n: 0, fps: null, p50: null, p95: null, max: null};
        let sum = 0;
        for (let i = 0; i < n; i++) sum += ms[i];
        const s = ms.slice().sort((a, b) => a - b);
        return {n, fps: sum > 0 ? 1000 * n / sum : null, p50: percentile(s, 0.5), p95: percentile(s, 0.95), max: s[n - 1]};
    }
    const r1 = v => (v == null || !isFinite(v)) ? null : Math.round(v * 10) / 10;
    const r2 = v => (v == null || !isFinite(v)) ? null : Math.round(v * 100) / 100;
    // the report the overlay shows and "Copy report" copies; in: {frames: [ms], layer: [ms] (3D layer CPU per frame), instances, zoom, pitch, terrain, heapBytes, viewport: [w, h], dpr, when}
    function buildReport(x) {
        const f = summarize(x.frames || []), l = summarize(x.layer || []);
        return {
            when: x.when || null,
            fps: r1(f.fps), frameMsP50: r1(f.p50), frameMsP95: r1(f.p95), frameSamples: f.n,
            layerCpuMsP50: r2(l.p50), layerCpuMsP95: r2(l.p95), layerSamples: l.n,
            modelInstances: x.instances == null ? null : x.instances,
            zoom: r2(x.zoom), pitch: r1(x.pitch), terrain: x.terrain == null ? null : !!x.terrain,
            jsHeapMB: x.heapBytes == null ? null : r1(x.heapBytes / 1048576),
            viewport: x.viewport || null, devicePixelRatio: x.dpr == null ? null : x.dpr,
            // Phase 42: where the time goes (device-independent counters) and which quality tier is active. null when not available.
            counters: x.counters || null,
            quality: x.quality ? {mode: x.quality.mode, level: x.quality.level, tier: x.quality.tier, software: !!x.quality.software, renderer: x.quality.renderer || null} : null,
        };
    }
    function extra(rep) {
        const out = [], c = rep.counters, q = rep.quality, v = (a, u) => a == null ? '-' : a + (u || '');
        if (q) out.push('quality ' + q.mode + ' / ' + q.tier + ' (level ' + q.level + ')' + (q.software ? '  SOFTWARE RENDERER' : ''));
        if (c) {
            out.push('draws p50 ' + v(c.drawCallsP50) + ' p95 ' + v(c.drawCallsP95) + '  tris p50 ' + v(c.trianglesP50) + '  uploads/frame ' + v(c.textureUploadsPerFrame == null ? null : Math.round(c.textureUploadsPerFrame * 10) / 10));
            const t = c.tiles;
            if (t) out.push('tiles vec ' + t.vector.loaded + '+' + t.vector.inFlight + '  ras ' + t.raster.loaded + '+' + t.raster.inFlight + '  dem ' + t.dem.loaded + '+' + t.dem.inFlight + '  symbols ' + v(c.symbolLayersDrawn) + '/' + t.symbolInstances);
            out.push('queries/s rendered ' + v(c.queryRenderedFeaturesPerSec) + ' terrain ' + v(c.queryTerrainElevationPerSec) + '  alloc ' + v(c.jsAllocMBps, ' MB/s'));
            out.push('canvas ' + (c.canvasPx ? c.canvasPx[0] + 'x' + c.canvasPx[1] : '-') + ' (' + v(c.canvasMP, ' MP') + ') ratio ' + v(c.pixelRatio));
        }
        return out;
    }
    // the read-out lines (monospace); "-" where a value is not available
    function lines(rep) {
        const v = (a, u) => a == null ? '-' : a + (u || '');
        return [
            'fps ' + v(rep.fps) + '   frame p50 ' + v(rep.frameMsP50, ' ms') + '  p95 ' + v(rep.frameMsP95, ' ms'),
            '3D layer CPU p50 ' + v(rep.layerCpuMsP50, ' ms') + '  models ' + v(rep.modelInstances),
            'zoom ' + v(rep.zoom) + '  pitch ' + v(rep.pitch) + '  terrain ' + (rep.terrain == null ? '-' : rep.terrain ? 'on' : 'off'),
            'JS heap ' + v(rep.jsHeapMB, ' MB'),
        ].concat(extra(rep));
    }
    return {percentile, makeRing, summarize, buildReport, lines};
})();
if (typeof module !== 'undefined') module.exports = PERFSTATS;
