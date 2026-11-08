"use strict";
// Skywatch ADS-B: what is drawn for the selected aircraft.
//  * its real track as one line with a smooth altitude gradient (colour interpolated along the line,
//    not one flat colour per segment);
//  * when a route is known, a dashed great-circle line from the aircraft to the destination.
// Both use real data only (track positions; destination coordinates from the route lookup).

const SELROUTE = {
    gradientStops: 240,         // upper limit of colour stops in the track gradient
    routeColor: 'rgba(255,255,255,0.5)',
};

MLR.installSelection = function (before) {
    const m = this.map;
    if (m.getSource('tar-sel-trail')) return;
    m.addSource('tar-sel-trail', {type: 'geojson', lineMetrics: true, data: {type: 'FeatureCollection', features: []}});
    m.addSource('tar-route', {type: 'geojson', data: {type: 'FeatureCollection', features: []}});
    m.addSource('tar-sel-head', {type: 'geojson', data: {type: 'FeatureCollection', features: []}});
    m.addLayer({id: 'tar-route', type: 'line', source: 'tar-route',
        layout: {'line-cap': 'butt', 'line-join': 'round'},
        paint: {'line-color': SELROUTE.routeColor, 'line-width': 1.4, 'line-dasharray': [3, 3]}}, before);
    m.addLayer({id: 'tar-sel-trail-casing', type: 'line', source: 'tar-sel-trail',
        layout: {'line-cap': 'round', 'line-join': 'round'},
        paint: {'line-color': 'rgba(0,0,0,0.55)', 'line-width': 4.2 * (typeof newWidth != 'undefined' ? newWidth : 1)}}, before);
    m.addLayer({id: 'tar-sel-trail', type: 'line', source: 'tar-sel-trail',
        layout: {'line-cap': 'round', 'line-join': 'round'},
        paint: {'line-width': 2.7 * (typeof newWidth != 'undefined' ? newWidth : 1),
            'line-gradient': ['interpolate', ['linear'], ['line-progress'], 0, '#ffffff', 1, '#ffffff']}}, before);
    // live head: from the last real fix to the DRAWN (smoothed) icon position, so the line always reaches the icon
    m.addLayer({id: 'tar-sel-head-casing', type: 'line', source: 'tar-sel-head', layout: {'line-cap': 'round'},
        paint: {'line-color': 'rgba(0,0,0,0.55)', 'line-width': 4.2 * (typeof newWidth != 'undefined' ? newWidth : 1)}}, before);
    m.addLayer({id: 'tar-sel-head', type: 'line', source: 'tar-sel-head', layout: {'line-cap': 'round'},
        paint: {'line-color': '#ffffff', 'line-width': 2.7 * (typeof newWidth != 'undefined' ? newWidth : 1)}}, before);
    this.selTrailKey = null;
    this.selRouteKey = null;
    this.selHead = null;
};

// called every animation frame (and on every flush) for the selected aircraft
MLR.updateSelHead = function () {
    const m = this.map, src = m && m.getSource('tar-sel-head');
    if (!src) return;
    const p = this.gradientPlane();
    const fix = this.selLastFix;
    const e = p && this.planes.get(p.icao);
    let data = null;
    if (p && e && fix && this.selTrailKey && this.selTrailKey.indexOf(p.icao) === 0) {
        const ll = this.drawnLL(e);
        const g = this.selG, la = g && g.alts.length ? g.alts[g.alts.length - 1] : 0;
        const f0 = this.liftLLAlt ? this.liftLLAlt(fix, la) : fix;     // the last fix at ITS altitude, the head ends at the lifted icon
        if (ll && !isNaN(ll[0]) && !isNaN(ll[1])) data = {type: 'Feature', properties: {}, geometry: {type: 'LineString', coordinates: [f0, ll]}};
        this.selHeadEnd = ll;
        if (this.selLastColor !== this.selHeadColor) { this.selHeadColor = this.selLastColor; try { m.setPaintProperty('tar-sel-head', 'line-color', this.selLastColor || '#fff'); } catch (err) {} }
    }
    if (data || this.selHead) src.setData(data || {type: 'FeatureCollection', features: []});
    this.selHead = data;
};

// the plane whose track is drawn as a gradient (hidden from the per-segment trail layers)
MLR.gradientPlane = function () {
    return (typeof SelectedPlane !== 'undefined' && SelectedPlane && !SelectedAllPlanes && !showTrace) ? SelectedPlane : null;
};

function mlGreatCircle(a, b, n) {
    const rad = Math.PI / 180, deg = 180 / Math.PI;
    const l1 = a[1] * rad, o1 = a[0] * rad, l2 = b[1] * rad, o2 = b[0] * rad;
    const d = 2 * Math.asin(Math.sqrt(Math.sin((l2 - l1) / 2) ** 2 + Math.cos(l1) * Math.cos(l2) * Math.sin((o2 - o1) / 2) ** 2));
    if (!(d > 1e-6)) return [a, b];
    const out = [];
    for (let i = 0; i <= n; i++) {
        const f = i / n, A = Math.sin((1 - f) * d) / Math.sin(d), B = Math.sin(f * d) / Math.sin(d);
        const x = A * Math.cos(l1) * Math.cos(o1) + B * Math.cos(l2) * Math.cos(o2);
        const y = A * Math.cos(l1) * Math.sin(o1) + B * Math.cos(l2) * Math.sin(o2);
        const z = A * Math.sin(l1) + B * Math.sin(l2);
        out.push([Math.atan2(y, x) * deg, Math.atan2(z, Math.sqrt(x * x + y * y)) * deg]);
    }
    // keep the longitudes continuous across the antimeridian
    for (let i = 1; i < out.length; i++) {
        while (out[i][0] - out[i - 1][0] > 180) out[i][0] -= 360;
        while (out[i][0] - out[i - 1][0] < -180) out[i][0] += 360;
    }
    return out;
}

MLR.flushSelection = function () {
    const m = this.map;
    const trailSrc = m && m.getSource('tar-sel-trail'), routeSrc = m && m.getSource('tar-route');
    if (!trailSrc || !routeSrc) return;
    const p = this.gradientPlane();

    // ---- track gradient ----
    let key = '';
    let data = {type: 'FeatureCollection', features: []};
    if (p && p.track_linesegs && p.track_linesegs.length) {
        const segs = p.track_linesegs.filter(s => s.dataSource != 'modeS' && s.fixed && s.fixed.getCoordinates().length);
        let npts = 0;
        for (const s of segs) npts += s.fixed.getCoordinates().length;
        key = p.icao + ':' + segs.length + ':' + npts + ':' + (segs.length ? segs[segs.length - 1].altitude : '');
        if (key !== this.selTrailKey) {
            const coords = [], alts = [], mids = [];   // mids: [index of the middle point of the segment, colour]
            for (const s of segs) {
                const c = mlSegCoords(s);
                if (!c.length) continue;
                const start = coords.length;
                const sa = (typeof s.altitude == 'number') ? s.altitude : 0;     // 'ground' = 0
                for (let i = 0; i < c.length; i++) {
                    coords.push(c[i]);
                    // the first vertex is shared with the previous segment: take the mean so the ribbon has no step
                    alts.push(i == 0 && start > 0 ? (alts[start - 1] + sa) / 2 : sa);
                }
                mids.push([start + (c.length - 1) / 2, mlSegColor(s)]);
            }
            if (coords.length >= 2) {
                // cumulative distance (equirectangular metres is plenty for fractions)
                const cum = [0];
                for (let i = 1; i < coords.length; i++) {
                    const k = Math.cos((coords[i][1] + coords[i - 1][1]) * Math.PI / 360);
                    cum.push(cum[i - 1] + Math.hypot((coords[i][0] - coords[i - 1][0]) * k, coords[i][1] - coords[i - 1][1]));
                }
                const total = cum[cum.length - 1] || 1;
                const at = (idx) => { const i = Math.floor(idx), f = idx - i; return ((cum[i] || 0) * (1 - f) + (cum[Math.min(i + 1, cum.length - 1)] || 0) * f) / total; };
                let step = Math.max(1, Math.ceil(mids.length / SELROUTE.gradientStops));
                const stops = [];
                let last = -1;
                const push = (f, col) => { f = Math.min(1, Math.max(0, f)); if (f <= last) f = last + 1e-7; if (f > 1) return; stops.push(f, col); last = f; };
                push(0, mids[0][1]);
                for (let i = 0; i < mids.length; i += step) push(at(mids[i][0]), mids[i][1]);
                push(1, mids[mids.length - 1][1]);
                if (stops.length >= 4) {
                    try { m.setPaintProperty('tar-sel-trail', 'line-gradient', ['interpolate', ['linear'], ['line-progress'], ...stops]); } catch (e) { /* style swap */ }
                    data = {type: 'FeatureCollection', features: [{type: 'Feature', properties: {}, geometry: {type: 'LineString', coordinates: coords}}]};
                }
            }
            this.selTrailKey = key;
            this.selG = coords.length >= 2 ? {coords, alts} : null;
            trailSrc.setData(data);
            this.selLifted = false;
            if (this.selG && this.liftActive && this.liftActive()) this.selDraw(true);
            this.selLastFix = coords.length ? coords[coords.length - 1] : null;
            this.selLastColor = mids.length ? mids[mids.length - 1][1] : null;
        }
    } else if (this.selTrailKey !== '') {
        this.selTrailKey = '';
        this.selLastFix = null;
        this.selG = null;
        trailSrc.setData(data);
    }
    this.updateSelHead();

    // ---- route line: aircraft to destination (rebuilt every frame from the drawn icon, see updateSelRoute) ----
    let dest = null;
    if (p && p.position && typeof ibRoute == 'function') {
        const r = ibRoute(p);
        const a = r && r._airports;
        const d = a && a[a.length - 1];
        const lat = d && (d.lat != null ? d.lat : d.latitude), lon = d && (d.lon != null ? d.lon : (d.lng != null ? d.lng : d.longitude));
        if (typeof lat == 'number' && typeof lon == 'number') dest = [lon, lat];
    }
    this.selRoute = dest ? {dest, icao: p.icao} : null;
    this.updateSelRoute();
};

// the track as one line. In 3D every vertex is lifted by ITS OWN altitude (a ribbon that rises and falls with the flight);
// long tracks are thinned to about 500 vertices. Same transform as the icon (ui/maplibre-lift.js). 2D: the ground line, untouched.
MLR.selDraw = function (force) {
    const g = this.selG, src = this.map && this.map.getSource('tar-sel-trail');
    if (!src || !g) return;
    const lift = this.liftActive();
    if (!lift && !this.selLifted && !force) return;
    let coords = g.coords;
    if (lift) {
        const n = coords.length, stride = Math.max(1, Math.ceil(n / 500)), out = [];
        for (let i = 0; i < n; i += stride) out.push(this.liftLLAlt(coords[i], g.alts[i]));
        if ((n - 1) % stride) out.push(this.liftLLAlt(coords[n - 1], g.alts[n - 1]));
        coords = out;
    }
    this.selLifted = lift;
    src.setData({type: 'FeatureCollection', features: [{type: 'Feature', properties: {}, geometry: {type: 'LineString', coordinates: coords}}]});
};

// dashed great circle from the drawn icon to the destination; in 3D it descends from the icon's altitude to the airport at ground level
MLR.updateSelRoute = function () {
    const src = this.map && this.map.getSource('tar-route');
    if (!src) return;
    const r = this.selRoute, p = this.gradientPlane();
    const e = r && p && p.icao === r.icao && this.planes.get(p.icao);
    if (!e || !p.proj) {
        if (this.selRouteShown) { src.setData({type: 'FeatureCollection', features: []}); this.selRouteShown = false; }
        return;
    }
    const base = this.baseLL(e);
    const gc = mlGreatCircle(base, r.dest, 64);
    const alt = typeof p.altitude == 'number' ? p.altitude : 0;
    let coords = gc;
    if (this.liftActive() && alt > 0) {
        coords = gc.map((q, i) => this.liftLLAlt(q, alt * (1 - i / (gc.length - 1))));
    }
    src.setData({type: 'Feature', properties: {}, geometry: {type: 'LineString', coordinates: coords}});
    this.selRouteShown = true;
};
