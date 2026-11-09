"use strict";
// Skywatch ADS-B: airport geometry (pure functions, no map or DOM access, unit tested in tools/test/airport-geom.test.js).
//
// Everything works in a local frame in metres (x east, y north). A runway is two thresholds plus a width. Positions on
// a runway are written as "(end, s, lat)": s metres from that end's threshold toward the other end, lat metres to the
// LEFT of the landing direction (a pilot arriving at that end looks along +s). Negative s is outside the runway
// (the approach). All lights and markings are derived from the real runway ends, width and taxiway centre lines, nothing
// is drawn without that geometry.
const AIRGEOM = (function () {
    const MX = 111320, MY = 110540;     // metres per degree of longitude (before cos(lat)) and of latitude
    const hyp = Math.hypot;

    function frame(lon0, lat0) {
        const k = Math.cos(lat0 * Math.PI / 180);
        return {
            lon0, lat0, k,
            xy: (p) => [(p[0] - lon0) * MX * k, (p[1] - lat0) * MY],
            ll: (p) => [lon0 + p[0] / (MX * k), lat0 + p[1] / MY],
        };
    }

    // a runway from its two threshold points (local metres) and its width
    function runway(a, b, width) {
        const dx = b[0] - a[0], dy = b[1] - a[1], len = hyp(dx, dy) || 1e-9;
        const rw = {a, b, len, width, hw: width / 2, ux: dx / len, uy: dy / len};
        // landing direction at end e (0 = at a, 1 = at b)
        rw.dir = (e) => e === 0 ? [rw.ux, rw.uy] : [-rw.ux, -rw.uy];
        rw.at = (e, s, lat) => {
            const d = rw.dir(e), base = e === 0 ? a : b;
            return [base[0] + d[0] * s - d[1] * lat, base[1] + d[1] * s + d[0] * lat];     // left normal of (dx,dy) is (-dy,dx)
        };
        // axis coordinates of a point: along (from a) and across (positive to the left of a->b)
        rw.local = (p) => { const x = p[0] - a[0], y = p[1] - a[1]; return [x * rw.ux + y * rw.uy, -x * rw.uy + y * rw.ux]; };
        rw.inside = (p, margin) => { const q = rw.local(p), m = margin || 0; return q[0] >= -m && q[0] <= len + m && Math.abs(q[1]) <= rw.hw + m; };
        return rw;
    }

    // n+1 points from p to q, evenly distributed, spacing as close to `spacing` as the length allows (both ends included, symmetric)
    function row(p, q, spacing) {
        const L = hyp(q[0] - p[0], q[1] - p[1]);
        const n = Math.max(1, Math.round(L / spacing));
        const out = [];
        for (let i = 0; i <= n; i++) out.push([p[0] + (q[0] - p[0]) * i / n, p[1] + (q[1] - p[1]) * i / n]);
        return out;
    }

    // runway lights: dense centre row, two edge rows exactly on the edge lines, red end bar, green threshold dots.
    // Rows run threshold to threshold, so nothing falls outside the runway footprint.
    function runwayLights(rw, o) {
        o = o || {};
        const cs = o.centreSpacing || 15, es = o.edgeSpacing || 60;
        const res = {centre: row(rw.at(0, 0, 0), rw.at(1, 0, 0), cs), edgeL: [], edgeR: [], endBars: [], threshold: [[], []]};
        res.edgeL = row(rw.at(0, 0, rw.hw), rw.at(1, 0, -rw.hw), es);       // left of a->b is the +lat side of end 0
        res.edgeR = row(rw.at(0, 0, -rw.hw), rw.at(1, 0, rw.hw), es);
        for (let e = 0; e < 2; e++) {
            res.endBars.push([rw.at(e, 0, -rw.hw), rw.at(e, 0, rw.hw)]);                       // across the full width at the runway end
            // green threshold dots across the width, 3 m inside the end, about every 3 m
            const n = Math.max(4, Math.round(rw.width / 3));
            for (let i = 0; i <= n; i++) res.threshold[e].push(rw.at(e, 3, -rw.hw + rw.width * i / n));
        }
        return res;
    }

    // painted markings: dashed centre line, threshold zebra blocks, touchdown-zone bar pairs (as rectangles)
    function rect(rw, e, s0, s1, l0, l1) { return [rw.at(e, s0, l0), rw.at(e, s1, l0), rw.at(e, s1, l1), rw.at(e, s0, l1)]; }
    function markings(rw) {
        const zebra = [], tdz = [];
        const nStripe = 2 * Math.max(2, Math.round(rw.width * 0.85 / 7.2));
        for (let e = 0; e < 2; e++) {
            for (let j = 0; j < nStripe / 2; j++) {
                const c = 3.6 + 3.6 * j;
                for (const sg of [-1, 1]) zebra.push(rect(rw, e, 6, 36, sg * c - 0.9, sg * c + 0.9));
            }
            const dists = rw.len > 2000 ? [150, 300, 450, 600] : [150, 300];
            for (const d of dists) {
                if (d + 25 > rw.len / 2) continue;           // never reach past the middle of a short runway
                for (const sg of [-1, 1]) tdz.push(rect(rw, e, d, d + 22, sg * 9 - 1, sg * 9 + 1));
            }
        }
        return {centreline: [rw.at(0, 40, 0), rw.at(1, 40, 0)], zebra, tdz};
    }

    // approach lights (runways of 1800 m and more): a straight row of dots every 30 m along the extended centre line,
    // 900 m long, a cross bar at 300 m and 600 m, bigger dots in the last 300 m (nearest the threshold).
    // `maxS` limits the length (the caller clips to the aerodrome ground).
    function approach(rw, e, maxS) {
        const out = {dots: [], bars: []};
        if (rw.len < 1800) return out;
        const lim = Math.min(900, maxS == null ? 900 : maxS);
        for (let s = 30; s <= lim + 1e-6; s += 30) out.dots.push({p: rw.at(e, -s, 0), big: s <= 300});
        for (const s of [300, 600]) if (s <= lim + 1e-6) out.bars.push([rw.at(e, -s, -4), rw.at(e, -s, 4)]);
        return out;
    }

    // PAPI: four lights across the approach, on the LEFT side of the approach (which is the opposite side at the other
    // end), 300 m in from the threshold, the nearest light 15 m off the edge line. Two white nearest the runway, two red.
    function papi(rw, e) {
        if (rw.len < 1000) return [];
        const out = [];
        for (let i = 0; i < 4; i++) out.push({p: rw.at(e, 300, rw.hw + 15 + 9 * i), c: i < 2 ? 'w' : 'r'});
        return out;
    }

    // where a taxiway centre line reaches `back` metres (default 45) from a runway edge: a hold-short position with the
    // direction of the taxiway there. Only taxiways that really run to the runway count (a vertex within 8 m of the
    // runway edge on the near side, found within 150 m of path after the crossing).
    function holdShort(line, rw, back) {
        back = back == null ? 45 : back;
        const T = rw.hw + back, out = [];
        const loc = line.map(rw.local);
        for (let i = 1; i < loc.length; i++) {
            const p = loc[i - 1], q = loc[i];
            for (const sg of [-1, 1]) {
                const t = sg * T;
                if ((p[1] - t) * (q[1] - t) >= 0 || Math.abs(p[1] - q[1]) < 1e-9) continue;
                const f = (t - p[1]) / (q[1] - p[1]);
                const al = p[0] + (q[0] - p[0]) * f;
                if (al < -20 || al > rw.len + 20) continue;
                // is the inner side (lower |lat|) the forward or the backward direction?
                const fwdIn = Math.abs(q[1]) < Math.abs(p[1]);
                let reach = false, path = 0, k = fwdIn ? i : i - 1;
                let prev = [al, t];
                for (let n = 0; n < 12 && k >= 0 && k < loc.length; n++) {
                    const v = loc[k];
                    path += hyp(v[0] - prev[0], v[1] - prev[1]); prev = v;
                    if (Math.abs(v[1]) <= rw.hw + 8) { reach = true; break; }
                    if (path > 150) break;
                    k += fwdIn ? 1 : -1;
                }
                if (!reach) continue;
                const g = line[i - 1], h = line[i];
                const px = g[0] + (h[0] - g[0]) * f, py = g[1] + (h[1] - g[1]) * f, dl = hyp(h[0] - g[0], h[1] - g[1]) || 1;
                out.push({p: [px, py], dir: [(h[0] - g[0]) / dl, (h[1] - g[1]) / dl]});
            }
        }
        return out;
    }

    // a stop bar across a taxiway at a hold-short position
    function stopBar(h, width) {
        const nx = -h.dir[1] * width / 2, ny = h.dir[0] * width / 2;
        return [[h.p[0] - nx, h.p[1] - ny], [h.p[0] + nx, h.p[1] + ny]];
    }

    // taxiway lights along a centre line: green on the line, blue on both edges (halfW from the line), every `spacing` m
    // (each segment is distributed evenly, so the ends of the line carry a light). The edge points are exactly
    // halfW from the centre line, measured perpendicular to the local direction.
    function taxiLights(line, halfW, spacing) {
        const centre = [], left = [], right = [];
        let carry = 0;       // distance already travelled since the last light
        const push = (x, y, dx, dy) => {
            centre.push([x, y]); left.push([x - dy * halfW, y + dx * halfW]); right.push([x + dy * halfW, y - dx * halfW]);
        };
        for (let i = 1; i < line.length; i++) {
            const p = line[i - 1], q = line[i], L = hyp(q[0] - p[0], q[1] - p[1]);
            if (L < 1e-6) continue;
            const dx = (q[0] - p[0]) / L, dy = (q[1] - p[1]) / L;
            if (i === 1) push(p[0], p[1], dx, dy);
            let s = spacing - carry;
            while (s <= L + 1e-9) { push(p[0] + dx * s, p[1] + dy * s, dx, dy); s += spacing; }
            carry = L - (s - spacing);
            if (i === line.length - 1 && carry > spacing * 0.35) push(q[0], q[1], dx, dy);
        }
        return {centre, left, right};
    }

    // keep every (2^lv)th point so that neighbours stay at least minPx apart on screen
    function strideLevel(spacingM, metresPerPx, minPx) {
        const px = spacingM / metresPerPx;
        let lv = 0;
        while (px * (1 << lv) < minPx && lv < 6) lv++;
        return lv;
    }
    function decimate(points, lv) { return lv ? points.filter((_, i) => i % (1 << lv) === 0) : points; }

    // convex hull (monotone chain) and its rounded buffer (hull of circle samples around every hull point)
    function hull(pts) {
        const p = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
        if (p.length < 3) return p;
        const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
        const lo = [];
        for (const q of p) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
        const up = [];
        for (let i = p.length - 1; i >= 0; i--) { const q = p[i]; while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop(); up.push(q); }
        lo.pop(); up.pop();
        return lo.concat(up);
    }
    function bufferHull(pts, r, steps) {
        steps = steps || 16;
        const h = hull(pts), ring = [];
        for (const p of h) for (let i = 0; i < steps; i++) { const a = 2 * Math.PI * i / steps; ring.push([p[0] + Math.cos(a) * r, p[1] + Math.sin(a) * r]); }
        return hull(ring);
    }

    function inPoly(p, ring) {
        let c = false;
        for (let i = 0, j = ring.length - 1; i < ring.length; j = i++)
            if ((ring[i][1] > p[1]) !== (ring[j][1] > p[1]) && p[0] < (ring[j][0] - ring[i][0]) * (p[1] - ring[i][1]) / (ring[j][1] - ring[i][1]) + ring[i][0]) c = !c;
        return c;
    }

    // largest s (<= want) along the approach row of end e that is still inside `ring` (the ground); 0 when even the first light is outside
    function approachLimit(rw, e, ring, want) {
        const inside = typeof ring === 'function' ? ring : (p) => inPoly(p, ring);       // a ring, or a test function (union of several rings)
        let best = 0;
        for (let s = 30; s <= want + 1e-6; s += 30) { if (inside(rw.at(e, -s, 0))) best = s; else break; }
        return best;
    }

    // distance from a point to a segment
    function segDist(p, a, b) {
        const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy;
        const t = l2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2)) : 0;
        return hyp(p[0] - a[0] - dx * t, p[1] - a[1] - dy * t);
    }

    // drop points closer than `r` to an earlier kept point (grid hash)
    function dedupe(items, r, get) {
        get = get || ((x) => x);
        const grid = new Map(), out = [];
        for (const it of items) {
            const p = get(it), gx = Math.floor(p[0] / r), gy = Math.floor(p[1] / r);
            let hit = false;
            for (let i = -1; i <= 1 && !hit; i++) for (let j = -1; j <= 1 && !hit; j++) {
                const c = grid.get((gx + i) + ':' + (gy + j));
                if (c) for (const q of c) if (hyp(q[0] - p[0], q[1] - p[1]) < r) { hit = true; break; }
            }
            if (hit) continue;
            const key = gx + ':' + gy;
            (grid.get(key) || grid.set(key, []).get(key)).push(p);
            out.push(it);
        }
        return out;
    }

    return {frame, runway, row, runwayLights, markings, approach, papi, holdShort, stopBar, taxiLights, strideLevel, decimate,
        hull, bufferHull, inPoly, approachLimit, segDist, dedupe};
})();
if (typeof module !== 'undefined') module.exports = AIRGEOM;
