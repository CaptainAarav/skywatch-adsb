"use strict";
// Skywatch ADS-B: pure maths for the 3D aircraft models (unit tested in tools/test/models-calc.test.js). No DOM, no three.js, no MapLibre.
//
// Coordinate conventions
//   ENU      x east, y north, z up (right-handed). A model's own frame: +Y is the nose, +X the right wing, +Z up.
//   Mercator MapLibre's world: x east, y SOUTH, z up, units 0..1 around the world. It is the ENU frame mirrored in y, so an ENU rotation R
//            becomes S R S with S = diag(1,-1,1); the renderer applies S to the whole instance (scale (s,-s,s) on a model drawn in ENU).
//   Angles   yaw = heading, degrees clockwise from north; pitch positive = nose up; roll positive = right wing down (bank right).
//            Applied as R = Rz(-yaw) * Rx(pitch) * Ry(roll), i.e. roll about the nose first, then pitch, then heading.
const MODELS = (function () {
    const ARCHETYPES = ['narrowbody', 'widebodyTwin', 'widebodyQuad', 'regionalJet', 'businessJet', 'turboprop', 'lightSingle', 'lightTwin', 'helicopter', 'generic'];
    // ICAO type -> [archetype, wingspan m, length m]  (published dimensions, rounded)
    const T = {
        A318: ['narrowbody', 34.1, 31.4], A319: ['narrowbody', 35.8, 33.8], A320: ['narrowbody', 35.8, 37.6], A321: ['narrowbody', 35.8, 44.5],
        A19N: ['narrowbody', 35.8, 33.8], A20N: ['narrowbody', 35.8, 37.6], A21N: ['narrowbody', 35.8, 44.5],
        B731: ['narrowbody', 28.4, 28.6], B732: ['narrowbody', 28.4, 30.6], B733: ['narrowbody', 28.9, 33.4], B734: ['narrowbody', 28.9, 36.4], B735: ['narrowbody', 28.9, 31.0],
        B736: ['narrowbody', 34.3, 31.2], B737: ['narrowbody', 34.3, 33.6], B738: ['narrowbody', 34.3, 39.5], B739: ['narrowbody', 34.3, 42.1],
        B37M: ['narrowbody', 35.9, 35.6], B38M: ['narrowbody', 35.9, 39.5], B39M: ['narrowbody', 35.9, 42.2], B752: ['narrowbody', 38.0, 47.3], B753: ['narrowbody', 38.0, 54.4],
        BCS1: ['narrowbody', 35.1, 35.0], BCS3: ['narrowbody', 35.1, 38.7], MD82: ['narrowbody', 32.9, 45.1], MD83: ['narrowbody', 32.9, 45.1], MD88: ['narrowbody', 32.9, 45.1], B712: ['narrowbody', 28.5, 37.8],
        A332: ['widebodyTwin', 60.3, 58.8], A333: ['widebodyTwin', 60.3, 63.7], A339: ['widebodyTwin', 64.0, 63.7], A359: ['widebodyTwin', 64.8, 66.8], A35K: ['widebodyTwin', 64.8, 73.8],
        A310: ['widebodyTwin', 43.9, 46.7], B762: ['widebodyTwin', 47.6, 48.5], B763: ['widebodyTwin', 47.6, 54.9], B764: ['widebodyTwin', 51.9, 61.4],
        B772: ['widebodyTwin', 60.9, 63.7], B77L: ['widebodyTwin', 64.8, 63.7], B773: ['widebodyTwin', 60.9, 73.9], B77W: ['widebodyTwin', 64.8, 73.9],
        B788: ['widebodyTwin', 60.1, 56.7], B789: ['widebodyTwin', 60.1, 62.8], B78X: ['widebodyTwin', 60.1, 68.3],
        A342: ['widebodyQuad', 60.3, 59.4], A343: ['widebodyQuad', 60.3, 63.7], A345: ['widebodyQuad', 63.5, 67.9], A346: ['widebodyQuad', 63.5, 75.4], A388: ['widebodyQuad', 79.8, 72.7],
        B741: ['widebodyQuad', 59.6, 70.7], B742: ['widebodyQuad', 59.6, 70.7], B744: ['widebodyQuad', 64.4, 70.7], B748: ['widebodyQuad', 68.4, 76.3], A124: ['widebodyQuad', 73.3, 69.1],
        E170: ['regionalJet', 26.0, 29.9], E175: ['regionalJet', 26.0, 31.7], E75L: ['regionalJet', 26.0, 31.7], E75S: ['regionalJet', 26.0, 31.7], E190: ['regionalJet', 28.7, 36.2], E195: ['regionalJet', 28.7, 38.7],
        E290: ['regionalJet', 28.7, 36.2], E295: ['regionalJet', 28.7, 41.5], CRJ1: ['regionalJet', 21.2, 26.8], CRJ2: ['regionalJet', 21.2, 26.8], CRJ7: ['regionalJet', 23.2, 32.5],
        CRJ9: ['regionalJet', 24.9, 36.4], CRJX: ['regionalJet', 26.2, 39.1], AR85: ['regionalJet', 26.3, 28.6], F70: ['regionalJet', 28.1, 30.9], F100: ['regionalJet', 28.1, 35.5],
        C25A: ['businessJet', 15.9, 14.4], C25B: ['businessJet', 15.9, 15.6], C25C: ['businessJet', 15.9, 16.3], C510: ['businessJet', 13.2, 12.2], C525: ['businessJet', 14.3, 13.0],
        C56X: ['businessJet', 17.2, 16.5], C680: ['businessJet', 19.4, 19.0], C700: ['businessJet', 19.4, 22.0], C750: ['businessJet', 19.4, 22.0], CL30: ['businessJet', 19.5, 20.9],
        CL35: ['businessJet', 19.5, 21.1], CL60: ['businessJet', 19.6, 20.9], GLF4: ['businessJet', 23.7, 26.9], GLF5: ['businessJet', 28.5, 29.4], GLF6: ['businessJet', 30.4, 30.4],
        GL5T: ['businessJet', 28.7, 29.5], GL7T: ['businessJet', 31.7, 33.0], GLEX: ['businessJet', 28.7, 29.5], FA7X: ['businessJet', 26.2, 26.2], FA8X: ['businessJet', 26.3, 26.2],
        FA50: ['businessJet', 19.3, 18.5], F2TH: ['businessJet', 19.3, 20.2], E55P: ['businessJet', 16.2, 16.8], E50P: ['businessJet', 12.3, 12.3], LJ45: ['businessJet', 14.6, 17.7],
        LJ60: ['businessJet', 13.4, 17.9], H25B: ['businessJet', 15.7, 15.6], PC24: ['businessJet', 17.0, 16.8], EA50: ['businessJet', 11.5, 10.6], HDJT: ['businessJet', 12.2, 13.0],
        AT42: ['turboprop', 24.6, 22.7], AT43: ['turboprop', 24.6, 22.7], AT45: ['turboprop', 24.6, 22.7], AT72: ['turboprop', 27.1, 27.2], AT75: ['turboprop', 27.1, 27.2], AT76: ['turboprop', 27.1, 27.2],
        DH8A: ['turboprop', 25.9, 22.3], DH8B: ['turboprop', 25.9, 22.3], DH8C: ['turboprop', 27.4, 25.7], DH8D: ['turboprop', 28.4, 32.8], SF34: ['turboprop', 21.4, 19.7], JS32: ['turboprop', 15.9, 14.4],
        B190: ['turboprop', 17.7, 17.6], BE20: ['turboprop', 16.6, 13.3], BE9L: ['turboprop', 15.3, 10.8], PC12: ['turboprop', 16.3, 14.4], C208: ['turboprop', 15.9, 11.5], TBM9: ['turboprop', 12.1, 10.7],
        TBM8: ['turboprop', 12.1, 10.7], P180: ['turboprop', 14.0, 14.4], DHC6: ['turboprop', 19.8, 15.8], C130: ['turboprop', 40.4, 29.8], A400: ['turboprop', 42.4, 45.1], E120: ['turboprop', 19.8, 20.0],
        C172: ['lightSingle', 11.0, 8.3], C182: ['lightSingle', 11.0, 8.8], C152: ['lightSingle', 10.2, 7.3], C150: ['lightSingle', 10.2, 7.3], C206: ['lightSingle', 10.9, 8.6], PA28: ['lightSingle', 10.7, 7.2],
        P28A: ['lightSingle', 10.7, 7.2], P28R: ['lightSingle', 10.7, 7.5], SR20: ['lightSingle', 10.7, 7.9], SR22: ['lightSingle', 11.7, 7.9], DA40: ['lightSingle', 11.9, 8.1], DR40: ['lightSingle', 8.7, 6.9],
        RV7: ['lightSingle', 7.5, 6.3], TB20: ['lightSingle', 9.8, 7.7], AA5: ['lightSingle', 9.6, 6.7], M20P: ['lightSingle', 8.9, 7.3], BE36: ['lightSingle', 10.2, 8.4], PA46: ['lightSingle', 13.1, 8.7],
        DA42: ['lightTwin', 13.4, 8.6], DA62: ['lightTwin', 14.6, 9.2], PA34: ['lightTwin', 11.8, 8.7], BE58: ['lightTwin', 11.5, 9.1], BE55: ['lightTwin', 11.5, 8.5], C310: ['lightTwin', 11.2, 9.7],
        C340: ['lightTwin', 11.6, 10.5], C421: ['lightTwin', 12.5, 11.0], P68: ['lightTwin', 12.0, 9.5], PA44: ['lightTwin', 11.8, 8.4],
        EC35: ['helicopter', 10.2, 12.2], EC45: ['helicopter', 11.0, 13.0], EC30: ['helicopter', 10.7, 10.6], AS50: ['helicopter', 10.7, 10.9], AS55: ['helicopter', 10.7, 10.9], A109: ['helicopter', 11.0, 13.0],
        A139: ['helicopter', 13.8, 16.7], A169: ['helicopter', 11.0, 14.0], B06: ['helicopter', 10.2, 12.0], B407: ['helicopter', 10.7, 12.7], B412: ['helicopter', 14.0, 17.1], B429: ['helicopter', 10.9, 13.1],
        R22: ['helicopter', 7.7, 8.8], R44: ['helicopter', 10.1, 11.6], R66: ['helicopter', 10.1, 11.6], H60: ['helicopter', 16.4, 19.8], S76: ['helicopter', 13.4, 16.0], S92: ['helicopter', 17.2, 20.9],
        H47: ['helicopter', 18.3, 30.1], EN28: ['helicopter', 8.4, 9.0], GAZL: ['helicopter', 10.5, 11.9], LYNX: ['helicopter', 12.8, 15.2],
    };
    // size defaults when only the archetype is known: [wingspan m, length m]
    const DEFAULT = {narrowbody: [35.8, 38], widebodyTwin: [60, 63], widebodyQuad: [64, 71], regionalJet: [26, 31], businessJet: [16, 17], turboprop: [24, 23],
        lightSingle: [10.5, 8], lightTwin: [12, 9.5], helicopter: [11, 12.5], generic: [30, 30]};
    // Engine / wake data in tar1090 form: desc "L2J" = landplane, 2 engines, jet; wtc L, M, H or J (super); category = ADS-B emitter category A1..A7
    function archetypeFor(code, info) {
        const k = String(code || '').toUpperCase();
        if (T[k]) return T[k][0];
        const i = info || {}, d = String(i.desc || '').toUpperCase(), wtc = String(i.wtc || '').toUpperCase(), cat = String(i.category || '').toUpperCase();
        const kind = d[0], engines = +d[1] || 0, eng = d[2];
        if (kind === 'H' || kind === 'G' || cat === 'A7') return 'helicopter';
        if (kind === 'L' || kind === 'T' || kind === 'S' || kind === 'A' || kind === '') {
            if (eng === 'J') {
                if (engines >= 4 || wtc === 'J') return 'widebodyQuad';
                if (wtc === 'H') return 'widebodyTwin';
                if (wtc === 'M') return cat === 'A2' ? 'regionalJet' : 'narrowbody';
                if (wtc === 'L') return 'businessJet';
                if (engines === 2) return 'narrowbody';
            }
            if (eng === 'T') return 'turboprop';
            if (eng === 'P') return engines >= 2 ? 'lightTwin' : 'lightSingle';
            if (cat === 'A1') return 'lightSingle';
            if (cat === 'A3') return 'narrowbody';
            if (cat === 'A5') return 'widebodyTwin';
        }
        return 'generic';
    }
    function dimsFor(code, archetype) {
        const k = String(code || '').toUpperCase();
        const t = T[k];
        if (t) return {span: t[1], length: t[2], exact: true};
        const d = DEFAULT[archetype] || DEFAULT.generic;
        return {span: d[0], length: d[1], exact: false};
    }
    // ---- scale ----
    function metresPerPixel(latDeg, zoom) { return 40075016.686 * Math.cos(latDeg * Math.PI / 180) / (512 * Math.pow(2, zoom)); }
    // on-screen minimum: a model is never smaller than minPx pixels long. Returns the model length in metres to draw.
    function drawLength(realLengthM, latDeg, zoom, minPx) {
        const mpp = metresPerPixel(latDeg, zoom), min = (minPx == null ? 28 : minPx) * mpp;
        return Math.max(realLengthM, min);
    }
    // uniform scale factor to apply to a model authored at its real length: drawLength / realLength (>= 1)
    function scaleFactor(realLengthM, latDeg, zoom, minPx) { return drawLength(realLengthM, latDeg, zoom, minPx) / realLengthM; }
    const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
    // crossfade between the icon and the model: icon only below zoom z0, model only from z0 + band (half a zoom level), smoothstep between
    function modelWeight(zoom, z0, band) { z0 = z0 == null ? 9 : z0; band = band == null ? 0.5 : band; return smooth(z0, z0 + band, zoom); }
    // ---- orientation ----
    const D2R = Math.PI / 180;
    function mul(a, b) { const r = new Array(9); for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) r[i * 3 + j] = a[i * 3] * b[j] + a[i * 3 + 1] * b[3 + j] + a[i * 3 + 2] * b[6 + j]; return r; }
    const Rz = (a) => [Math.cos(a), -Math.sin(a), 0, Math.sin(a), Math.cos(a), 0, 0, 0, 1];
    const Rx = (a) => [1, 0, 0, 0, Math.cos(a), -Math.sin(a), 0, Math.sin(a), Math.cos(a)];
    const Ry = (a) => [Math.cos(a), 0, Math.sin(a), 0, 1, 0, -Math.sin(a), 0, Math.cos(a)];
    // ENU rotation (row-major 3x3) for heading (deg), pitch (rad) and roll (rad)
    function orientationENU(yawDeg, pitchRad, rollRad) { return mul(mul(Rz(-yawDeg * D2R), Rx(pitchRad || 0)), Ry(rollRad || 0)); }
    // the same rotation expressed in Mercator axes (y mirrored): S R S
    function orientationMercator(yawDeg, pitchRad, rollRad) {
        const R = orientationENU(yawDeg, pitchRad, rollRad), S = [1, 0, 0, 0, -1, 0, 0, 0, 1];
        return mul(mul(S, R), S);
    }
    function apply(R, v) { return [R[0] * v[0] + R[1] * v[1] + R[2] * v[2], R[3] * v[0] + R[4] * v[1] + R[5] * v[2], R[6] * v[0] + R[7] * v[1] + R[8] * v[2]]; }
    // pitch (rad) from vertical rate (ft/min) and ground speed (kt); level flight and unknowns give 0; clamped to +-15 degrees
    function pitchFrom(vsFpm, gsKt) {
        if (typeof vsFpm != 'number' || typeof gsKt != 'number' || gsKt < 30) return 0;
        const climb = vsFpm * 0.00508, v = gsKt * 0.514444;           // m/s
        return Math.max(-15 * D2R, Math.min(15 * D2R, Math.atan2(climb, v)));
    }
    // roll (rad) from the reported roll (deg, right wing down positive) else from the turn rate (deg/s, clockwise positive) and speed; clamped to +-35 degrees
    function rollFrom(reportedDeg, trackRateDegS, gsKt) {
        let r = null;
        if (typeof reportedDeg == 'number' && isFinite(reportedDeg)) r = reportedDeg * D2R;
        else if (typeof trackRateDegS == 'number' && typeof gsKt == 'number' && gsKt > 40) r = Math.atan(gsKt * 0.514444 * trackRateDegS * D2R / 9.80665);
        if (r == null) return 0;
        return Math.max(-35 * D2R, Math.min(35 * D2R, r));
    }
    // exponential smoothing of an angle towards a target (shortest way round for headings)
    function smoothAngle(prev, target, dtS, tauS, wrap) {
        if (prev == null || !isFinite(prev)) return target;
        let d = target - prev;
        if (wrap) d = ((d + 180) % 360 + 360) % 360 - 180;
        const a = 1 - Math.exp(-Math.max(0, dtS) / Math.max(1e-3, tauS));
        const r = prev + d * a;
        return wrap ? ((r % 360) + 360) % 360 : r;
    }
    // ---- selection: the n items nearest to (cx, cy), each {x, y}; ties keep input order ----
    function nearest(items, cx, cy, n) {
        const sc = items.map((it, i) => ({it, i, d: (it.x - cx) * (it.x - cx) + (it.y - cy) * (it.y - cy)}));
        sc.sort((a, b) => a.d - b.d || a.i - b.i);
        return sc.slice(0, n).map(s => s.it);
    }
    // rendered height above the surface in Mercator z: metres * (mercator units per metre); on the ground the model sits on the surface
    function surfaceZ(onGround, terrainM, exaggeration) { return (onGround ? 0 : 0) + (terrainM || 0) * (exaggeration == null ? 1 : exaggeration); }
    return {ARCHETYPES, TYPE_TABLE: T, DEFAULT, archetypeFor, dimsFor, metresPerPixel, drawLength, scaleFactor, modelWeight, orientationENU, orientationMercator, apply,
        pitchFrom, rollFrom, smoothAngle, nearest, surfaceZ};
})();
if (typeof module !== 'undefined') module.exports = MODELS;
