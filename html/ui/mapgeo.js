"use strict";
// Skywatch ADS-B: renderer-independent geometry helpers.
//
// The plane/trail data layer stores positions as Web Mercator metres (EPSG:3857). These helpers
// (projection, great-circle distance, small geometry classes) keep it independent of the map library.
// WebGL is required by the map. Without it the page says so (the rest of the page keeps working).
const MAP_WEBGL = (function () {
    let ok = false;
    try { const c = document.createElement('canvas'); ok = !!(c.getContext('webgl2') || c.getContext('webgl')); } catch (e) {}
    if (!ok) {
        document.addEventListener('DOMContentLoaded', () => {
            const n = document.createElement('div');
            n.id = 'webglNotice';
            n.setAttribute('role', 'alert');
            n.textContent = 'This map needs WebGL, which is not available in this browser. Enable hardware acceleration or try another browser.';
            document.body.appendChild(n);
            // fall back to the plain 2D radar (ui/radar2d.js); it removes this notice once it is drawing
            window.addEventListener('load', () => { try { if (typeof RADAR2D != 'undefined' && typeof g != 'undefined') RADAR2D.start(); } catch (e) { console.error('2D radar fallback failed', e); } });
        });
    }
    return ok;
})();

// The globe view needs WebGL2. Without it the Globe button is hidden.
const MAP_GLOBE = (function () {
    try { return MAP_WEBGL && !!document.createElement('canvas').getContext('webgl2'); } catch (e) { return false; }
})();

const mapgeo = (function () {
    const R = 6378137;
    const HALF = Math.PI * R;
    const EARTH = 6371008.8;   // mean radius of the earth
    const MAXLAT = 85.0511287798;

    function fromLonLat(c) {
        const lat = Math.max(-MAXLAT, Math.min(MAXLAT, c[1]));
        return [
            c[0] * HALF / 180,
            R * Math.log(Math.tan(Math.PI * (lat + 90) / 360)),
        ];
    }
    function toLonLat(c) {
        return [
            c[0] * 180 / HALF,
            360 * Math.atan(Math.exp(c[1] / R)) / Math.PI - 90,
        ];
    }
    function toLonLatInto(c, out) {       // allocation-free toLonLat (per-frame callers)
        out[0] = c[0] * 180 / HALF; out[1] = 360 * Math.atan(Math.exp(c[1] / R)) / Math.PI - 90;
        return out;
    }
    function getDistance(a, b) {
        const rad = Math.PI / 180;
        const lat1 = a[1] * rad, lat2 = b[1] * rad;
        const dLat = lat2 - lat1, dLon = (b[0] - a[0]) * rad;
        const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
        return 2 * EARTH * Math.asin(Math.min(1, Math.sqrt(h)));
    }

    // Light geometry classes with the few methods the data layer uses.
    class LineString {
        constructor(coords) { this.c = coords || []; }
        getCoordinates() { return this.c; }
        setCoordinates(c) { this.c = c; }
        appendCoordinate(p) { this.c.push(p); }
        getFirstCoordinate() { return this.c[0]; }
        getLastCoordinate() { return this.c[this.c.length - 1]; }
        getCoordinateAt(f) { return f >= 1 ? this.c[this.c.length - 1] : this.c[0]; } // only 1.0 is used
        transform(from, to) {
            if (from === 'EPSG:4326' && to === 'EPSG:3857') this.c = this.c.map(fromLonLat);
            return this;
        }
    }
    class Point {
        constructor(c) { this.c = c; }
        getCoordinates() { return this.c; }
        setCoordinates(c) { this.c = c; }
    }

    class Feature {
        constructor(g) { this.g = g; }
        getGeometry() { return this.g; }
        setStyle() {}
        set() {}
        get() {}
    }

    return {fromLonLat, toLonLat, toLonLatInto, getDistance, LineString, Point, Feature, R, HALF};
})();
