"use strict";
// Skywatch ADS-B: performance overlay. Off by default and ZERO cost when off: no DOM, no listener, no requestAnimationFrame loop, no timer, and the 3D layer's
// timing ring stays off. On with ?perf=1 or Settings > Advanced > Performance overlay: a small monospace read-out (pointer-events: none) with fps, frame ms
// p50/p95 over the last 120 frames, the 3D layer's own CPU ms, model instances, zoom, pitch, terrain and the JS heap (where the browser reports it), and a
// separate small "Copy report" button that copies the same numbers as JSON. The maths is in ui/perf-stats.js.
const PERF = (function () {
    const WINDOW = 120, SHOW_MS = 500;
    let on = false, el = null, btn = null, raf = 0, timer = 0, last = 0, frames = null, prevTiming = false, lastRep = null;
    function frame(t) {
        if (!on) return;
        if (last) frames.push(t - last);
        last = t;
        raf = requestAnimationFrame(frame);
    }
    function layerSamples() {
        const out = [], s = (typeof MLR != 'undefined') && MLR.modelsStats;
        if (!s || !s.ring || !MLR.modelsActive || !MLR.modelsActive()) return out;
        const ring = s.ring, cap = ring.prep.length, c = Math.min(ring.n, WINDOW, cap);
        for (let i = ring.n - c; i < ring.n; i++) out.push(ring.prep[i % cap] + ring.rend[i % cap]);
        return out;
    }
    function report() {
        const m = (typeof MLR != 'undefined') && MLR.map, st = (typeof MLR != 'undefined') && MLR.modelsStats;
        const active = !!((typeof MLR != 'undefined') && MLR.modelsActive && MLR.modelsActive());
        let terrain = null;
        try { if (m) terrain = !!(m.getTerrain && m.getTerrain()); } catch (e) { /* not available */ }
        return PERFSTATS.buildReport({
            when: new Date().toISOString(),
            frames: frames.values(), layer: layerSamples(), instances: active && st ? st.drawn : 0,
            zoom: m ? m.getZoom() : null, pitch: m ? m.getPitch() : null, terrain,
            heapBytes: performance.memory ? performance.memory.usedJSHeapSize : null,
            viewport: [innerWidth, innerHeight], dpr: window.devicePixelRatio || 1,
            counters: (typeof PERFC != 'undefined') ? PERFC.snapshot() : null,
            quality: (typeof MLR != 'undefined' && MLR.qualityInfo) ? MLR.qualityInfo() : null,
        });
    }
    function show() { lastRep = report(); if (el) el.textContent = PERFSTATS.lines(lastRep).join('\n'); }
    function copy() {
        const txt = JSON.stringify(report(), null, 2);
        const done = ok => { if (btn) { btn.textContent = ok ? 'Copied' : 'Copy failed'; setTimeout(() => { if (btn) btn.textContent = 'Copy report'; }, 1500); } };
        const fallback = () => { try { const a = document.createElement('textarea'); a.value = txt; a.style.cssText = 'position:fixed;left:-999px'; document.body.appendChild(a); a.select(); const ok = document.execCommand('copy'); a.remove(); done(ok); } catch (e) { done(false); } };
        if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(txt).then(() => done(true), fallback); else fallback();
    }
    function build() {
        el = document.createElement('pre'); el.id = 'perfOverlay'; el.setAttribute('aria-hidden', 'true');
        btn = document.createElement('button'); btn.type = 'button'; btn.id = 'perfCopy'; btn.textContent = 'Copy report';
        btn.addEventListener('click', copy);
        document.body.append(el, btn);
    }
    function set(v) {
        v = !!v;
        if (v === on) return;
        on = v;
        if (on) {
            frames = PERFSTATS.makeRing(WINDOW); last = 0;
            build();
            if ((typeof MLR != 'undefined') && MLR.modelsStats) { prevTiming = !!MLR.modelsStats.timing; MLR.modelsStats.timing = true; }
            raf = requestAnimationFrame(frame);
            if (typeof PERFC != 'undefined' && typeof MLR != 'undefined' && MLR.map) PERFC.start(MLR.map);
            timer = setInterval(show, SHOW_MS); show();
        } else {
            if (typeof PERFC != 'undefined') PERFC.stop();
            cancelAnimationFrame(raf); clearInterval(timer); raf = 0; timer = 0;
            if ((typeof MLR != 'undefined') && MLR.modelsStats) MLR.modelsStats.timing = prevTiming;
            if (el) el.remove(); if (btn) btn.remove();
            el = btn = null; frames = null;
        }
    }
    const api = {set, isOn: () => on, report: () => on ? report() : null};
    try { if (new URLSearchParams(location.search).get('perf') === '1') jQuery(() => set(true)); } catch (e) { /* no URL parameter support */ }
    jQuery(function () {
        new Toggle({key: 'perfOverlay', display: 'Performance overlay', container: '#set_advanced', init: false, setState: s => set(s)});
    });
    return api;
})();
