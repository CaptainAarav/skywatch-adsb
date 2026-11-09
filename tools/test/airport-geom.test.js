// node tools/test/airport-geom.test.js   (no dependencies)
const G = require('../../html/ui/airport-geom.js'), assert = require('assert');
const near = (a, b, e = 1e-6, m) => assert(Math.abs(a - b) <= e, `${m || ''} ${a} !~ ${b}`);
const d = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1]);
let n = 0; const T = (name, f) => { f(); n++; };

// runways at arbitrary headings
for (const hdg of [0, 27, 90, 133, 215, 271, 349]) {
    const th = hdg * Math.PI / 180, len = 3000, w = 45;
    const a = [1234, -567], b = [a[0] + Math.sin(th) * len, a[1] + Math.cos(th) * len];
    const rw = G.runway(a, b, w);
    T('rows ' + hdg, () => {
        const L = G.runwayLights(rw);
        // centre row: on the axis, 15 m (+-0.5) apart, from threshold to threshold
        for (const p of L.centre) { const q = rw.local(p); near(q[1], 0, 1e-6, 'centre lateral'); assert(q[0] >= -1e-6 && q[0] <= len + 1e-6); }
        near(d(L.centre[0], a), 0); near(d(L.centre[L.centre.length - 1], b), 0);
        for (let i = 1; i < L.centre.length; i++) near(d(L.centre[i], L.centre[i - 1]), 15, 0.5);
        // edge rows exactly on the edge lines, one each side, same length, 60 m apart
        for (const p of L.edgeL) near(rw.local(p)[1], w / 2, 1e-6, 'left edge');
        for (const p of L.edgeR) near(rw.local(p)[1], -w / 2, 1e-6, 'right edge');
        assert.equal(L.edgeL.length, L.edgeR.length);
        for (let i = 1; i < L.edgeL.length; i++) near(d(L.edgeL[i], L.edgeL[i - 1]), 60, 1);
        // symmetric: the mirror of every left light about the axis is a right light
        L.edgeL.forEach((p, i) => { const q = rw.local(p), r = rw.local(L.edgeR[i]); near(q[0], r[0], 1e-6); near(q[1], -r[1], 1e-6); });
        // nothing outside the footprint
        for (const p of [...L.centre, ...L.edgeL, ...L.edgeR, ...L.threshold[0], ...L.threshold[1]]) assert(rw.inside(p, 1e-6), 'inside footprint');
        // end bars across the full width at each end; threshold dots across the width
        for (let e = 0; e < 2; e++) {
            near(d(L.endBars[e][0], L.endBars[e][1]), w, 1e-6);
            for (const p of L.endBars[e]) near(d(p, e ? b : a) > 0 ? rw.local(p)[0] : 0, e ? len : 0, 1e-6);
            const lat = L.threshold[e].map(p => rw.local(p)[1]); near(Math.min(...lat), -w / 2); near(Math.max(...lat), w / 2);
        }
    });
    T('marks ' + hdg, () => {
        const M = G.markings(rw);
        // touchdown bars: 150 and 300 m, plus 450 and 600 m on a runway over 2000 m, symmetric about the axis, pairs each side
        const a0 = M.tdz.filter((_, i) => i < 8);       // end 0 comes first
        const along = new Set(a0.map(r => Math.round(rw.local(r[0])[0])));
        assert.deepEqual([...along].sort((x, y) => x - y), [150, 300, 450, 600]);
        for (const r of M.tdz) for (const p of r) assert(rw.inside(p, 1e-6));
        for (const r of M.zebra) for (const p of r) assert(rw.inside(p, 1e-6));
        const lat = M.zebra.map(r => (rw.local(r[0])[1] + rw.local(r[2])[1]) / 2);
        near(lat.reduce((s, x) => s + x, 0), 0, 1e-6, 'zebra symmetric');
    });
    T('approach ' + hdg, () => {
        for (let e = 0; e < 2; e++) {
            const A = G.approach(rw, e), th0 = e ? b : a, dir = rw.dir(e);
            assert.equal(A.dots.length, 30);
            A.dots.forEach((o, i) => {
                const s = 30 * (i + 1), q = [o.p[0] - th0[0], o.p[1] - th0[1]];
                near(q[0] * dir[0] + q[1] * dir[1], -s, 1e-6, 'along, away from the runway');     // outward = against the landing direction
                near(-q[0] * dir[1] + q[1] * dir[0], 0, 1e-6, 'on the extended centre line');
                assert.equal(o.big, s <= 300);
                assert(!rw.inside(o.p), 'not on the runway');
            });
            assert.equal(A.bars.length, 2);
            A.bars.forEach((br, i) => { near(d(br[0], br[1]), 8, 1e-6); near(d([(br[0][0] + br[1][0]) / 2, (br[0][1] + br[1][1]) / 2], th0), 300 * (i + 1), 1e-6); });
            // clipped to the ground
            assert.equal(G.approach(rw, e, 300).dots.length, 10); assert.equal(G.approach(rw, e, 300).bars.length, 1);
        }
        assert.equal(G.approach(G.runway([0, 0], [1500, 0], 30), 0).dots.length, 0, 'none on a short runway');
    });
    T('papi ' + hdg, () => {
        const side = [];
        for (let e = 0; e < 2; e++) {
            const P = G.papi(rw, e), dir = rw.dir(e), th0 = e ? b : a;
            assert.equal(P.length, 4);
            assert.deepEqual(P.map(o => o.c), ['w', 'w', 'r', 'r']);
            for (const o of P) {
                const q = [o.p[0] - th0[0], o.p[1] - th0[1]];
                near(q[0] * dir[0] + q[1] * dir[1], 300, 1e-6, 'papi 300 m in');
                const lat = -q[0] * dir[1] + q[1] * dir[0];
                assert(lat > 0, 'left of the approach');
            }
            near(rw.local(P[0].p)[1] * (e ? -1 : 1) - rw.hw, 15, 1e-6, 'nearest light 15 m off the edge');
            side.push(Math.sign(rw.local(P[0].p)[1]));
            near(d(P[0].p, P[1].p), 9, 1e-6);
        }
        assert.equal(side[0], -side[1], 'opposite sides at opposite ends');
    });
}

// hold-short: a taxiway crossing the runway at an angle, 45 m back from the edge, measured across the runway
T('hold short', () => {
    const rw = G.runway([0, 0], [0, 2000], 50);                    // north-south runway, hw 25
    const line = [[-200, 700], [-90, 750], [-20, 800], [20, 820], [200, 900]];   // crosses, passing within the runway
    const hs = G.holdShort(line, rw, 45);
    assert.equal(hs.length, 2);
    for (const h of hs) { near(Math.abs(rw.local(h.p)[1]), 70, 1e-6); assert(G.segDist(h.p, [0, 0], [0, 0]) >= 0); }
    assert(hs.some(h => h.p[0] < 0) && hs.some(h => h.p[0] > 0));
    // a taxiway that stops short of the runway edge (never within 8 m of it) gets no bar
    assert.equal(G.holdShort([[-300, 500], [-120, 500], [-90, 500]], rw, 45).length, 0);
    // a taxiway running parallel to the runway gets none
    assert.equal(G.holdShort([[-120, 100], [-120, 900]], rw, 45).length, 0);
    // a taxiway that ends at the edge of the runway gets one bar, on its own side
    const t2 = G.holdShort([[-300, 1000], [-26, 1000]], rw, 45);
    assert.equal(t2.length, 1); near(t2[0].p[0], -70); near(t2[0].p[1], 1000);
    const bar = G.stopBar(t2[0], 20); near(d(bar[0], bar[1]), 20); near(bar[0][0], -70); near(bar[1][0], -70);
});

// taxiway lights: green on the centre line, blue on both edges, ~20 m, exactly on the geometry
T('taxi lights', () => {
    const line = [[0, 0], [100, 0], [100, 60]];
    const L = G.taxiLights(line, 11.5, 20);
    assert.equal(L.centre.length, L.left.length); assert.equal(L.centre.length, L.right.length);
    for (let i = 0; i < L.centre.length; i++) {
        let dist = Infinity; for (let j = 1; j < line.length; j++) dist = Math.min(dist, G.segDist(L.centre[i], line[j - 1], line[j]));
        near(dist, 0, 1e-6);
        near(d(L.centre[i], L.left[i]), 11.5); near(d(L.centre[i], L.right[i]), 11.5);
    }
    for (let i = 1; i < L.centre.length; i++) assert(d(L.centre[i], L.centre[i - 1]) <= 20 + 1e-6 && d(L.centre[i], L.centre[i - 1]) > 5);
    near(d(L.centre[0], [0, 0]), 0); near(d(L.centre[L.centre.length - 1], [100, 60]), 0);
});

// screen spacing: dots of a 20 m row stay >= 8 px apart
T('stride', () => {
    for (const mpp of [10, 4.2, 2.1, 1.1, 0.55, 0.27]) {
        const lv = G.strideLevel(20, mpp, 8);
        assert(20 * (1 << lv) / mpp >= 8 || lv === 6);
        if (lv) assert(20 * (1 << (lv - 1)) / mpp < 8);
    }
    assert.deepEqual(G.decimate([1, 2, 3, 4, 5], 1), [1, 3, 5]);
});

// ground: buffered hull contains its points; approach limit follows the ground
T('ground', () => {
    const pts = [[0, 0], [3000, 0], [3000, 40], [0, 40], [1500, 500]];
    const ring = G.bufferHull(pts, 150);
    for (const p of pts) assert(G.inPoly(p, ring));
    assert(G.inPoly([-100, 20], ring)); assert(!G.inPoly([-170, 20], ring));
    const rw = G.runway([0, 20], [3000, 20], 45);
    const lim = G.approachLimit(rw, 0, ring, 900);
    assert(lim >= 120 && lim <= 150, 'stops where the ground ends: ' + lim);
    assert.equal(G.approach(rw, 0, lim).dots.length, lim / 30);
});

T('dedupe', () => {
    const o = G.dedupe([[0, 0], [3, 0], [20, 0], [21, 1]], 8);
    assert.equal(o.length, 2);
});
console.log('airport-geom tests ok (' + n + ' groups)');
