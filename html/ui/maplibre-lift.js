// Skywatch ADS-B: 3D altitude lift.
//
// In 3D view each aircraft is drawn above its ground position by
//     lift_px = altitude_m * k / metres_per_pixel * sin(pitch)        (k = "Altitude exaggeration" setting)
// compressed softly (tanh) so a jet at high zoom does not leave the screen. The icon and its label are placed at
//     map.unproject(map.project(ground) - [0, lift_px])
// A thin stem joins the lifted icon to a shadow dot on the ground. Hit-testing, the selection pill, hover, Follow and the selected
// trail's head all use the lifted position (MLR.drawnLL returns it). 2D and Globe are untouched (lift is 0 there).
"use strict";

const LIFT = {k: 2, max: 190, ft: 0.3048};
try { const v = parseFloat(localStorage.getItem('altExag')); if (isFinite(v) && v >= 0 && v <= 10) LIFT.k = v; } catch (e) {}

MLR.liftActive = function () { return this.is3D && !this.isGlobe() && LIFT.k > 0 && this.ready; };

// screen-pixel lift for a plane at lon/lat ll
MLR.liftPx = function (ll, p) {
    let alt = p.altitude;
    if (typeof alt != 'number') alt = (typeof p.alt_geom == 'number') ? p.alt_geom : 0;   // 'ground' and unknown stay on the map
    return this.liftPxAlt(ll, alt);
};
// uncompressed lift in pixels (altitude ft, exaggeration k) and the cap it is soft-limited to
MLR.liftRawPx = function (ll, alt) {
    if (!(alt > 0)) return 0;
    const m = this.map, pitch = m.getPitch() * Math.PI / 180;
    if (pitch < 0.01) return 0;
    const mpp = 40075016.686 * Math.cos(ll[1] * Math.PI / 180) / (512 * Math.pow(2, m.getZoom()));
    return alt * LIFT.ft * LIFT.k / mpp * Math.sin(pitch);
};
MLR.liftMaxPx = function () { return Math.min(LIFT.max, this.map.getContainer().clientHeight * 0.3); };
MLR.liftPxAlt = function (ll, alt) {
    const raw = this.liftRawPx(ll, alt);
    if (!(raw > 0)) return 0;
    const max = this.liftMaxPx();
    return max * Math.tanh(raw / max);
};

// lifted lon/lat (identical array when there is no lift)
MLR.liftLL = function (ll, p) {
    if (!this.liftActive()) return ll;
    // an aircraft drawn as a 3D model stands at its TRUE position with real height (ui/maplibre-models.js); its icon, label, hit target and Follow
    // use the ground point that projects to the model's screen point. Everything else keeps the screen-space lift below.
    if (this.modelAnchor && this.modelSet && this.modelSet.size && this.modelSet.has(p.icao)) { const a = this.modelAnchor(ll, p); if (a) return a; }
    const px = this.liftPx(ll, p);
    if (px < 0.5) return ll;
    const q = this.map.project(ll);
    const u = this.map.unproject([q.x, q.y - px]);
    return [u.lng, u.lat];
};

// same transform for any vertex with its own altitude (ft): track ribbon, route line
MLR.liftLLAlt = function (ll, alt) {
    if (!this.liftActive()) return ll;
    const px = this.liftPxAlt(ll, alt);
    if (px < 0.5) return ll;
    const q = this.map.project(ll);
    const u = this.map.unproject([q.x, q.y - px]);
    return [u.lng, u.lat];
};

// camera target in mercator metres for a lifted aircraft (Follow / focus ease)
MLR.liftProj = function (p, proj) {
    if (!this.liftActive()) return proj;
    const ll = mapgeo.toLonLat(proj), l = this.liftLL(ll, p);
    return l === ll ? proj : mapgeo.fromLonLat(l);
};

// stem + shadow features for one entry (ground position g, lifted position l)
MLR.liftFeats = function (e, g, l) {
    if (l === g) return null;
    return {
        s: {type: 'Feature', id: e.id, geometry: {type: 'LineString', coordinates: [g, l]}, properties: {}},
        h: this.modelSet && this.modelSet.has(e.plane.icao) ? null : {type: 'Feature', id: e.id, geometry: {type: 'Point', coordinates: g}, properties: {}},   // a model casts its own shadow
    };
};

MLR.installLift = function () {
    const m = this.map;
    for (const id of ['lift-stems', 'lift-shadows']) m.addSource('tar-' + id, {type: 'geojson', data: {type: 'FeatureCollection', features: []}});
    m.addLayer({id: 'tar-lift-shadow', type: 'circle', source: 'tar-lift-shadows',
        paint: {'circle-radius': 3.5, 'circle-color': '#000', 'circle-opacity': 0.55, 'circle-blur': 0.8, 'circle-pitch-alignment': 'map'}});
    m.addLayer({id: 'tar-lift-stem', type: 'line', source: 'tar-lift-stems',
        paint: {'line-color': 'rgba(255,255,255,0.35)', 'line-width': 1}});
};

// all stems/shadows after a full flush of the planes source
MLR.liftFlushAll = function () {
    const m = this.map, a = m.getSource('tar-lift-stems'), b = m.getSource('tar-lift-shadows');
    if (!a || !b) return;
    const S = [], H = [];
    if (this.liftActive()) {
        const bounds = m.getBounds();
        for (const e of this.planes.values()) {
            if (!e.id || !e.plane.proj) continue;
            const g = this.baseLL(e);
            const f = this.liftFeats(e, g, this.liftLL(g, e.plane));
            if (f) { S.push(f.s); if (f.h) H.push(f.h); }
        }
    }
    a.setData({type: 'FeatureCollection', features: S});
    b.setData({type: 'FeatureCollection', features: H});
    this.liftWas = S.length > 0;
};

// the camera moved (pitch/zoom/bearing/centre change every lifted position): move icons, stems and shadows in step.
// Called once per frame at most; one updateData per source.
MLR.liftCamera = function () {
    if (!this.liftActive()) { if (this.liftWas) { this.liftWas = false; this.touch('planes'); this.selDraw && this.selDraw(true); this.updateSelHead && this.updateSelHead(); this.updateSelRoute && this.updateSelRoute(); } return; }
    try { this.selDraw && this.selDraw(); } catch (err) { console.warn('selected track lift:', err); }
    const m = this.map, pl = m.getSource('tar-planes'), a = m.getSource('tar-lift-stems'), b = m.getSource('tar-lift-shadows');
    if (!pl || !a || !b) return;
    const t0 = performance.now();
    const up = [], addA = [], addB = [], rem = [];
    let n = 0;
    for (const e of this.planes.values()) {
        const p = e.plane;
        if (!e.id || !e.feat || !p.proj) continue;
        const g = this.baseLL(e), l = this.liftLL(g, p);
        up.push({id: e.id, newGeometry: {type: 'Point', coordinates: l}});
        const f = this.liftFeats(e, g, l);
        if (f) { addA.push(f.s); if (f.h) addB.push(f.h); }
        n++;
    }
    try {
        pl.updateData({update: up});
        a.setData({type: 'FeatureCollection', features: addA});
        b.setData({type: 'FeatureCollection', features: addB});
    } catch (err) { /* source not ready */ }
    this.liftWas = true;
    this.updateSelHead && this.updateSelHead();
    this.updateSelRoute && this.updateSelRoute();
    LIFT.cost = (LIFT.cost || 0) * 0.9 + (performance.now() - t0) * 0.1;
    LIFT.n = n;
};

(function () {
    let queued = false;
    function schedule() {
        if (queued || !MLR.liftActive()) return;
        queued = true;
        requestAnimationFrame(() => { queued = false; try { MLR.liftCamera(); } catch (err) { console.warn('altitude lift:', err); } });
    }
    jQuery(function () {
        const t = setInterval(() => {
            if (!MLR.map) return;
            clearInterval(t);
            MLR.map.on('move', schedule);
            MLR.map.on('pitchend', () => { schedule(); });
        }, 100);
        const inp = document.getElementById('altExagRange');
        if (!inp) return;
        const out = document.getElementById('altExagValue');
        const sync = () => {
            inp.style.setProperty('--fill', (inp.value - inp.min) / (inp.max - inp.min) * 100 + '%');
            out.textContent = Number(inp.value) == 0 ? 'off' : Number(inp.value).toFixed(1).replace(/\.0$/, '') + '×';
        };
        inp.value = LIFT.k; sync();
        inp.addEventListener('input', () => { LIFT.k = Number(inp.value); sync(); schedule(); MLR.touch('planes'); });
        inp.addEventListener('change', () => { try { localStorage.setItem('altExag', String(LIFT.k)); } catch (e) {} });
    });
})();
window.LIFT = LIFT;
