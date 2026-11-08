// Skywatch ADS-B: airport panel calculations. Pure functions, no DOM, no network (tested with node, see tools/test/).
// Formulas follow the airport-panel spec: wind components, BEST end, flight category (FAA), density altitude,
// sunrise/sunset (NOAA), runway-in-use inference.
'use strict';
const AIRCALC = (function () {
    const RAD = Math.PI / 180;

    // runway end heading in degrees true: the true-heading column when present, else the runway number x 10
    function endHeading(ident, hdgTrue, otherHdg) {
        if (typeof hdgTrue === 'number' && isFinite(hdgTrue)) return ((hdgTrue % 360) + 360) % 360;
        const m = /^(\d{1,2})/.exec(ident || '');
        if (m) return (parseInt(m[1], 10) * 10 + 360) % 360 || 360;
        if (typeof otherHdg === 'number') return (otherHdg + 180) % 360;
        return null;
    }

    // wind from wd (deg) at ws (kt) against a runway heading h: head > 0 headwind (< 0 tailwind); cross > 0 from the right
    function windComponents(wd, ws, h) {
        const a = (wd - h) * RAD;
        return {head: ws * Math.cos(a), cross: ws * Math.sin(a)};
    }

    // ends: [{id, hdg}]. Returns {byId: {id: {head, cross}}, best: id|null}. No BEST for variable or calm wind.
    function runwayWind(ends, wd, ws) {
        const out = {byId: {}, best: null};
        if (typeof wd !== 'number' || typeof ws !== 'number' || !isFinite(wd) || !isFinite(ws)) return out;
        for (const e of ends) if (typeof e.hdg === 'number') out.byId[e.id] = windComponents(wd, ws, e.hdg);
        if (ws <= 2) return out;                                       // calm / very light: no preferred end
        let best = null;
        for (const e of ends) {
            const c = out.byId[e.id];
            if (!c) continue;
            if (!best || c.head > best.c.head + 0.5 || (Math.abs(c.head - best.c.head) <= 0.5 && Math.abs(c.cross) < Math.abs(best.c.cross))) best = {id: e.id, c};
        }
        out.best = best && best.c.head > 0 ? best.id : null;
        return out;
    }

    // clouds: [[cover, baseFt]]; ceiling = lowest BKN / OVC / VV layer, null = none
    function ceilingFt(clouds, vv) {
        let c = null;
        for (const l of clouds || []) {
            if (!l || (l[0] !== 'BKN' && l[0] !== 'OVC' && l[0] !== 'OVX' && l[0] !== 'VV') || typeof l[1] !== 'number') continue;
            if (c == null || l[1] < c) c = l[1];
        }
        if (typeof vv === 'number' && (c == null || vv * 100 < c)) c = vv * 100;
        return c;
    }

    // visibility in the API JSON is statute miles, a number or a string such as "6+" / "10+"
    function visSM(v) {
        if (typeof v === 'number') return v;
        if (typeof v === 'string') { const n = parseFloat(v); return isFinite(n) ? n : null; }
        return null;
    }

    // FAA categories. vis in SM (null = unknown), ceiling in ft (null = none)
    function flightCategory(vis, ceil) {
        if (vis == null && ceil == null) return null;
        const v = vis == null ? Infinity : vis, c = ceil == null ? Infinity : ceil;
        if (c < 500 || v < 1) return 'LIFR';
        if (c < 1000 || v < 3) return 'IFR';
        if (c <= 3000 || v <= 5) return 'MVFR';
        return 'VFR';
    }
    const CAT_RANK = {VFR: 0, MVFR: 1, IFR: 2, LIFR: 3};

    // pressure altitude = elev + (1013.25 - QNH) * 27; ISA = 15 - 2 * elev / 1000; DA = PA + 120 * (OAT - ISA)
    function densityAltitude(elevFt, qnhHpa, tempC) {
        if ([elevFt, qnhHpa, tempC].some(x => typeof x !== 'number' || !isFinite(x))) return null;
        const pa = elevFt + (1013.25 - qnhHpa) * 27;
        const isa = 15 - 2 * elevFt / 1000;
        return Math.round(pa + 120 * (tempC - isa));
    }

    // NOAA solar calculator. Returns {rise, set} as Date (UTC) or {polar: 'day'|'night'}.
    function sunTimes(date, lat, lon) {
        const y = date.getUTCFullYear();
        const n = Math.floor((Date.UTC(y, date.getUTCMonth(), date.getUTCDate()) - Date.UTC(y, 0, 0)) / 864e5);
        const g = 2 * Math.PI / 365 * (n - 1 + (12 - 12) / 24);          // fractional year at noon
        const eqt = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
        const decl = 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) - 0.006758 * Math.cos(2 * g) + 0.000907 * Math.sin(2 * g) - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g);
        const cosH = Math.cos(90.833 * RAD) / (Math.cos(lat * RAD) * Math.cos(decl)) - Math.tan(lat * RAD) * Math.tan(decl);
        if (cosH > 1) return {polar: 'night'};
        if (cosH < -1) return {polar: 'day'};
        const ha = Math.acos(cosH) / RAD;
        const day0 = Date.UTC(y, date.getUTCMonth(), date.getUTCDate());
        const at = (deg) => new Date(day0 + (720 - 4 * (lon + deg) - eqt) * 60000);
        return {rise: at(ha), set: at(-ha)};
    }

    // runway-in-use inference. samples: [{t (ms), end (id), key}] one entry per aircraft observation matching an end.
    // Needs >= 3 distinct (aircraft, minute) samples in the last 15 minutes, and a strict majority for one end.
    function inferRunwayEnd(samples, now) {
        const seen = new Map(), cnt = {};
        for (const s of samples) {
            if (s.t < now - 15 * 60000) continue;
            const k = s.key + '|' + Math.floor(s.t / 60000);
            if (seen.has(k)) continue;
            seen.set(k, 1);
            cnt[s.end] = (cnt[s.end] || 0) + 1;
        }
        const total = seen.size;
        if (total < 3) return null;
        let best = null;
        for (const e in cnt) if (!best || cnt[e] > cnt[best]) best = e;
        return cnt[best] * 2 > total ? best : null;
    }

    function angDiff(a, b) { return Math.abs(((a - b + 540) % 360) - 180); }

    function distNm(lat1, lon1, lat2, lon2) {
        const p1 = lat1 * RAD, p2 = lat2 * RAD, dl = (lon2 - lon1) * RAD, dp = p2 - p1;
        const a = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
        return 2 * 3440.065 * Math.asin(Math.min(1, Math.sqrt(a)));
    }

    // TAF -> category per slot. fc: array of forecast groups {from,to,chg,wdir,wspd,vis,clouds,vv} (epoch s).
    // Base and BECMG/FM groups carry the state forward; TEMPO/PROB groups are reported separately as "worse".
    function tafSlots(fc, startSec, nSlots, slotSec) {
        const groups = (fc || []).slice().sort((a, b) => a.from - b.from);
        const res = [];
        for (let i = 0; i < nSlots; i++) {
            const t0 = startSec + i * slotSec, t1 = t0 + slotSec, mid = t0 + slotSec / 2;
            let vis = null, clouds = [], vv = null, ok = false;
            for (const g of groups) {
                if (g.chg === 'TEMPO' || g.chg === 'PROB') continue;
                if (g.from > mid) break;
                
                const v = visSM(g.vis);
                if (v != null) vis = v;
                if (g.clouds && g.clouds.length) { clouds = g.clouds; vv = null; } else if (v != null && g.chg == null) clouds = [];
                if (typeof g.vv === 'number') vv = g.vv;
                ok = true;
            }
            const base = ok ? flightCategory(vis, ceilingFt(clouds, vv)) : null;
            let worst = null;
            for (const g of groups) {
                if (g.chg !== 'TEMPO' && g.chg !== 'PROB') continue;
                if (g.to <= t0 || g.from >= t1) continue;
                const cat = flightCategory(visSM(g.vis) != null ? visSM(g.vis) : vis, g.clouds && g.clouds.length ? ceilingFt(g.clouds, g.vv) : ceilingFt(clouds, vv));
                if (cat && (!worst || CAT_RANK[cat] > CAT_RANK[worst])) worst = cat;
            }
            res.push({t: t0, cat: base, temp: worst && base && CAT_RANK[worst] > CAT_RANK[base] ? worst : null});
        }
        return res;
    }

    return {endHeading, windComponents, runwayWind, ceilingFt, visSM, flightCategory, CAT_RANK, densityAltitude, sunTimes,
        inferRunwayEnd, angDiff, distNm, tafSlots};
})();
if (typeof module !== 'undefined') module.exports = AIRCALC;
