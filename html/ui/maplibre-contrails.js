"use strict";
// Skywatch ADS-B: contrails (3D view only, OFF by default). A short fading white line behind every aircraft above CONTRAIL_FT, drawn at the aircraft's own lifted altitude.
// Cheap by design: one GeoJSON source and one line layer with a line-gradient fade, at most 14 points of recent positions per aircraft, rebuilt at 2 Hz and after the camera
// settles (the lift is screen-space, so the geometry depends on the camera). Real data only: the points are the aircraft's own recent reported positions.
// Settings > Map > "Contrails (3D)" and "Contrail altitude".
(function () {
    const SRC = 'tar-contrails', LAYER = 'tar-contrails', MAXPTS = 14, STEP_MS = 2000;
    let on = false, ft = 25000, timer = 0, last = 0;
    const hist = new Map();                     // icao -> [[lon, lat, alt], ...]
    try { on = localStorage.getItem('contrails') === '1'; const v = parseInt(localStorage.getItem('contrailFt'), 10); if (v >= 10000 && v <= 45000) ft = v; } catch (e) { /* default off */ }
    MLR.contrailsOn = () => on;
    const wanted = () => on && MLR.ready && MLR.is3D && !MLR.isGlobe();
    function ensure() {
        const m = MLR.map; if (!m || !m.getStyle()) return false;      // not isStyleLoaded(): that is false while any tile loads
        if (!m.getSource(SRC)) m.addSource(SRC, {type: 'geojson', data: {type: 'FeatureCollection', features: []}, lineMetrics: true});
        if (!m.getLayer(LAYER)) {
            const before = m.getLayer('tar-planes') ? 'tar-planes' : undefined;
            m.addLayer({id: LAYER, type: 'line', source: SRC, layout: {'line-cap': 'round', 'line-join': 'round'},
                paint: {'line-width': ['interpolate', ['linear'], ['zoom'], 6, 1, 12, 2, 16, 3], 'line-gradient': ['interpolate', ['linear'], ['line-progress'], 0, 'rgba(255,255,255,0)', 1, 'rgba(255,255,255,0.5)']}}, before);
        }
        return true;
    }
    function remove() { const m = MLR.map; if (!m) return; try { if (m.getLayer(LAYER)) m.removeLayer(LAYER); if (m.getSource(SRC)) m.removeSource(SRC); } catch (e) { /* style changing */ } hist.clear(); }
    function step(force) {
        if (!wanted()) { if (MLR.map && MLR.map.getLayer(LAYER)) remove(); return; }
        const now = performance.now(); if (!force && now - last < STEP_MS - 50) return; last = now;
        if (!ensure()) return;
        const seen = new Set(), feats = [], withLine = [];
        for (const e of MLR.planes.values()) {
            const p = e.plane, alt = typeof p.altitude === 'number' ? p.altitude : (typeof p.alt_geom === 'number' ? p.alt_geom : 0);
            if (!p.position || alt < ft) continue;
            seen.add(p.icao);
            let h = hist.get(p.icao); if (!h) hist.set(p.icao, h = []);
            const lp = h[h.length - 1];
            if (!lp || lp[0] !== p.position[0] || lp[1] !== p.position[1]) { h.push([p.position[0], p.position[1], alt]); if (h.length > MAXPTS) h.shift(); }
            if (h.length < 2) continue;
            withLine.push(p.icao);
            feats.push({type: 'Feature', properties: {}, geometry: {type: 'LineString', coordinates: h.map(q => MLR.liftLLAlt([q[0], q[1]], q[2]))}});
        }
        for (const k of [...hist.keys()]) if (!seen.has(k)) hist.delete(k);
        const s = MLR.map.getSource(SRC); s && s.setData({type: 'FeatureCollection', features: feats});
        MLR.contrailsStats = {lines: feats.length, aircraft: seen.size, icaos: withLine};
    }
    MLR.contrailsSync = function () { if (wanted()) { if (!timer) timer = setInterval(step, STEP_MS); step(true); } else { clearInterval(timer); timer = 0; remove(); } };
    MLR.contrailsStep = step;
    jQuery(function () {
        new Toggle({key: 'contrails', display: 'Contrails behind high aircraft (3D)', container: '#set_appearance', init: on, setState: s => { on = !!s; try { localStorage.setItem('contrails', on ? '1' : '0'); } catch (e) { /* ignore */ } MLR.contrailsSync(); }});
        const t = setInterval(() => { if (MLR.map && MLR.ready) { clearInterval(t); MLR.map.on('moveend', () => { if (wanted()) step(true); }); MLR.map.on('style.load', () => { hist.clear(); MLR.contrailsSync(); }); MLR.contrailsSync(); } }, 300);
    });
})();
