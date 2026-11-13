"use strict";
// Skywatch ADS-B: applies the 3D quality level (ui/quality-calc.js) to the map, and the 3D-only performance work:
//   - Settings > Map > "3D quality": Auto (default) / High / Balanced / Low. Auto measures real frame times in 3D and steps the ladder down or up.
//   - canvas pixel ratio cap (also on the 2D view for very large canvases), ground shadows, label density (+ collision frozen while the camera moves),
//     model detail, terrain detail, terrain off, models off; basemap layers that are useless in 3D are hidden in 3D.
//   - the hover work (aircraft, airport pins) is throttled to one pass per animation frame and skipped while the camera moves.
//   - terrain elevation is cached per ground cell (refreshed at most 2 times a second) instead of queried for every aircraft every frame.
// A software renderer (SwiftShader, llvmpipe) forces the Low tier and shows a one-line notice.
MLR.q = QUALITY.settings(0);
(function () {
    const KEY = 'quality3d', MINOR_LABEL = /poi|housenumber|transportation_name|waterway|aeroway|road_name|highway_name|street|label_minor|park|mountain_peak/i, MAJOR = /country|state|city|capital|town|place_(?:label_)?(?:city|town|country|state)/i;
    let mode = 'auto', ctl = null, renderer = '', software = false, raf = 0, last = 0, hidden = new Set(), baseDpr = window.devicePixelRatio || 1, notice = null, applied = {};
    try { mode = QUALITY.modeFrom(localStorage.getItem(KEY)); } catch (e) { /* default */ }
    function gpuRenderer() {
        if (renderer) return renderer;
        try {
            const gl = MLR.map && MLR.map.painter && MLR.map.painter.context.gl, x = gl && gl.getExtension('WEBGL_debug_renderer_info');
            renderer = x ? String(gl.getParameter(x.UNMASKED_RENDERER_WEBGL)) : 'unknown';
        } catch (e) { renderer = 'unknown'; }
        return renderer;
    }
    MLR.gpuRenderer = gpuRenderer;
    MLR.qualityMode = () => mode;
    MLR.qualityLevel = () => MLR.q.level;
    MLR.qualityInfo = () => ({mode, level: MLR.q.level, tier: MLR.q.name, software, renderer: gpuRenderer(), controller: ctl ? ctl.state() : null});
    function labelLayers(m) { try { return m.getStyle().layers.filter(l => l.type === 'symbol' && l.source && !/^tar-/.test(l.source) && !/^ov-/.test(l.source)); } catch (e) { return []; } }
    function setVis(m, id, vis) { try { if (m.getLayer(id)) m.setLayoutProperty(id, 'visibility', vis ? 'visible' : 'none'); } catch (e) { /* ignore */ } }
    // basemap layers that do nothing useful at pitch are hidden in 3D (at every level); fewer labels at level 3+
    function syncLayers(frozen) {
        const m = MLR.map; if (!m || !MLR.ready) return;
        const is3 = MLR.is3D && !MLR.isGlobe(), reduced = MLR.q.labelDensity === 'reduced';
        const hide = new Set();
        if (is3) for (const l of labelLayers(m)) { const id = l.id; if (MINOR_LABEL.test(id) && !MAJOR.test(id)) hide.add(id); else if (reduced && !MAJOR.test(id)) hide.add(id); else if (frozen && MLR.q.freezeLabelsWhileMoving) hide.add(id); }
        for (const id of hide) if (!hidden.has(id)) { setVis(m, id, false); hidden.add(id); }
        for (const id of [...hidden]) if (!hide.has(id)) { setVis(m, id, true); hidden.delete(id); }
        for (const id of ['tar-lift-shadows']) if (m.getLayer(id)) setVis(m, id, MLR.q.shadows);
    }
    MLR.qualitySyncLayers = syncLayers;
    function applyPixelRatio() {
        const m = MLR.map; if (!m || !m.setPixelRatio) return;
        const c = m.getContainer(), want = MLR.is3D ? QUALITY.pixelRatio(MLR.q.level, baseDpr, c.clientWidth, c.clientHeight) : QUALITY.pixelRatio(0, baseDpr, c.clientWidth, c.clientHeight);
        if (Math.abs(m.getPixelRatio() - want) > 0.01) { try { m.setPixelRatio(want); } catch (e) { /* older builds */ } }
    }
    function apply(level) {
        const prev = MLR.q; MLR.q = QUALITY.settings(level);
        applyPixelRatio(); syncLayers(false);
        const terrainChanged = prev.terrain !== MLR.q.terrain || prev.terrainDetail !== MLR.q.terrainDetail, modelsChanged = prev.models !== MLR.q.models;
        if (terrainChanged && MLR.terrainSync) MLR.terrainSync();
        if (modelsChanged && MLR.syncModels) { MLR.syncModels(); MLR.touch && MLR.touch('planes'); }
        if (prev.modelLod !== MLR.q.modelLod && MLR.touch) MLR.touch('planes');
        showNotice();
        MLR.applySky && MLR.applySky();
        try { document.dispatchEvent(new CustomEvent('skywatch-quality', {detail: MLR.qualityInfo()})); } catch (e) { /* no CustomEvent */ }
    }
    function showNotice() {
        const want = software && MLR.is3D;
        if (want && !notice) {
            notice = document.createElement('div'); notice.id = 'hwNotice'; notice.setAttribute('role', 'status');
            notice.textContent = 'Hardware acceleration seems off in this browser';
            document.body.appendChild(notice);
        } else if (!want && notice) { notice.remove(); notice = null; }
    }
    function loop(t) {
        raf = 0;
        if (!(MLR.ready && MLR.is3D && mode === 'auto' && !software)) { last = 0; return; }
        if (last && !document.hidden) { const ms = t - last; if (ms < 1000) { const l = ctl.push(ms, t); if (l !== MLR.q.level) apply(l); } }
        last = document.hidden ? 0 : t;
        raf = requestAnimationFrame(loop);
    }
    function sync() {
        if (!MLR.map || !MLR.ready) return;
        software = QUALITY.isSoftware(gpuRenderer()) && !window.QUALITY_IGNORE_SOFTWARE;     // the flag is for the counter test, which must measure the full level on a CI host
        if (!ctl) ctl = QUALITY.controller();
        const is3 = MLR.is3D;
        let lvl = software ? QUALITY.FIXED.low : mode === 'auto' ? (is3 ? ctl.level() : 0) : QUALITY.FIXED[mode];
        if (!is3 && !software) lvl = mode === 'auto' ? 0 : lvl;
        if (lvl !== MLR.q.level) apply(lvl); else { applyPixelRatio(); syncLayers(false); showNotice(); }
        if (is3 && mode === 'auto' && !software && !raf) { last = 0; raf = requestAnimationFrame(loop); }
    }
    MLR.qualitySync = sync;
    MLR.setQualityMode = function (v) {
        mode = QUALITY.modeFrom(v);
        try { localStorage.setItem(KEY, mode); } catch (e) { /* private mode */ }
        if (ctl) ctl.force(mode === 'auto' ? 0 : QUALITY.FIXED[mode]);
        sync();
    };
    // the antialias setting of the NEXT map load: only High asks for it (it cannot change at runtime)
    MLR.qualityAntialias = () => { try { return localStorage.getItem(KEY) === 'high'; } catch (e) { return false; } };
    // hover work, one pass per animation frame, nothing while the camera moves
    MLR.throttleHover = function (fn) {
        let pending = null, scheduled = false;
        return function (e) {
            pending = e;
            if (scheduled) return;
            scheduled = true;
            requestAnimationFrame(() => { scheduled = false; const ev = pending; pending = null; if (ev && !(MLR.map && MLR.map.isMoving())) fn(ev); });
        };
    };
    // terrain elevation cache: one query per ~100 m ground cell per 500 ms
    (function () {
        const cache = new Map(), TTL = 500;
        const orig = MLR.terrainElev;
        MLR.terrainElev = function (ll) {
            const k = Math.round(ll[1] * 1000) * 100000 + Math.round(ll[0] * 1000), now = performance.now(), c = cache.get(k);
            if (c && now - c.t < TTL) return c.v;
            const v = orig.call(this, ll);
            if (cache.size > 2000) cache.clear();
            cache.set(k, {t: now, v});
            return v;
        };
        MLR.terrainElevCacheClear = () => cache.clear();
    })();
    // Draw calls: MapLibre renders a stencil clipping mask for EVERY tile of a source before it draws a fill or line layer of that source, and again whenever
    // the layer order switches source (at pitch 55 a source covers ~26 tiles, so 18 overlay sources cost ~900 mask draws x2 per frame even when they hold no
    // features). A tar-* GeoJSON source with no features gets its fill/line layers hidden by US (and shown again when it has features); a layer someone else
    // hid stays hidden, because only layers that were visible when we hid them are restored.
    (function () {
        const ours = new Map();      // source id -> [layer ids we hid]
        function empty(d) { return !d || (d.type === 'FeatureCollection' ? !d.features || !d.features.length : false) || (Array.isArray(d) && !d.length); }
        function layersOf(m, id) { try { return m.getStyle().layers.filter(l => l.source === id && (l.type === 'fill' || l.type === 'line')); } catch (e) { return []; } }
        MLR.sourceEmptySync = function (id, data) {
            const m = MLR.map; if (!m || !MLR.ready) return;
            const hid = ours.get(id);
            if (empty(data)) {
                if (hid) return;
                const list = layersOf(m, id).filter(l => !(l.layout && l.layout.visibility === 'none')).map(l => l.id);
                for (const lid of list) setVis(m, lid, false);
                ours.set(id, list);
            } else if (hid) {
                for (const lid of hid) setVis(m, lid, true);
                ours.delete(id);
            }
        };
        MLR.sourceEmptyReset = function () { ours.clear(); };       // a new style load re-creates every layer visible
        const wrap = () => {
            const m = MLR.map; if (!m || m._emptyWrapped) return;
            m._emptyWrapped = true;
            const sd = maplibregl.GeoJSONSource && maplibregl.GeoJSONSource.prototype;
            if (!sd || !sd.setData) return;
            const o = sd.setData;
            sd.setData = function (data, wait) { try { if (/^tar-/.test(this.id) && typeof data === 'object') MLR.sourceEmptySync(this.id, data); } catch (e) { /* never break the data path */ } return o.call(this, data, wait); };
            m.on('style.load', () => MLR.sourceEmptyReset());
        };
        const t = setInterval(() => { if (MLR.map) { clearInterval(t); wrap(); } }, 100);
    })();
    jQuery(function () {
        const list = document.getElementById('set_appearance');
        if (list) {
            const row = document.createElement('div'); row.className = 'setSlider';
            const lab = document.createElement('label'); lab.htmlFor = 'quality3dSel';
            const t = document.createElement('span'); t.textContent = '3D quality (experimental)'; lab.appendChild(t);
            const sel = document.createElement('select'); sel.id = 'quality3dSel'; sel.className = 'searchInput';
            for (const [v, n] of [['auto', 'Auto'], ['high', 'High'], ['balanced', 'Balanced'], ['low', 'Low']]) { const o = document.createElement('option'); o.value = v; o.textContent = n; sel.appendChild(o); }
            sel.value = mode;
            sel.addEventListener('change', () => MLR.setQualityMode(sel.value));
            row.append(lab, sel);
            list.insertBefore(row, list.firstChild);
        }
        const t = setInterval(() => { if (MLR.map && MLR.ready) { clearInterval(t); sync(); MLR.map.on('movestart', () => { if (MLR.q.freezeLabelsWhileMoving && MLR.is3D) syncLayers(true); }); MLR.map.on('moveend', () => syncLayers(false)); MLR.map.on('resize', applyPixelRatio); } }, 200);
    });
})();
