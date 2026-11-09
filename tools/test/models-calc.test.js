const assert = require('assert');
const M = require('../../html/ui/models-calc.js');
const near = (a, b, e, m) => assert.ok(Math.abs(a - b) <= (e || 1e-9), (m || '') + ' ' + a + ' vs ' + b);
const vnear = (a, b, m) => a.forEach((x, i) => near(x, b[i], 1e-9, m + '[' + i + ']'));

// ---- type -> archetype ----
assert.strictEqual(M.archetypeFor('A320'), 'narrowbody');
assert.strictEqual(M.archetypeFor('B77W'), 'widebodyTwin');
assert.strictEqual(M.archetypeFor('A388'), 'widebodyQuad');
assert.strictEqual(M.archetypeFor('E190'), 'regionalJet');
assert.strictEqual(M.archetypeFor('C56X'), 'businessJet');
assert.strictEqual(M.archetypeFor('AT72'), 'turboprop');
assert.strictEqual(M.archetypeFor('C172'), 'lightSingle');
assert.strictEqual(M.archetypeFor('PA34'), 'lightTwin');
assert.strictEqual(M.archetypeFor('EC35'), 'helicopter');
// unknown code: engine data, then wake category, else generic
assert.strictEqual(M.archetypeFor('ZZZZ', {desc: 'L4J', wtc: 'H'}), 'widebodyQuad');
assert.strictEqual(M.archetypeFor('ZZZZ', {desc: 'L2J', wtc: 'H'}), 'widebodyTwin');
assert.strictEqual(M.archetypeFor('ZZZZ', {desc: 'L2J', wtc: 'M'}), 'narrowbody');
assert.strictEqual(M.archetypeFor('ZZZZ', {desc: 'L2J', wtc: 'L'}), 'businessJet');
assert.strictEqual(M.archetypeFor('ZZZZ', {desc: 'L1P', wtc: 'L'}), 'lightSingle');
assert.strictEqual(M.archetypeFor('ZZZZ', {desc: 'L2P', wtc: 'L'}), 'lightTwin');
assert.strictEqual(M.archetypeFor('ZZZZ', {desc: 'L2T', wtc: 'M'}), 'turboprop');
assert.strictEqual(M.archetypeFor('ZZZZ', {desc: 'H1T'}), 'helicopter');
assert.strictEqual(M.archetypeFor('ZZZZ', {category: 'A7'}), 'helicopter');
assert.strictEqual(M.archetypeFor(null), 'generic');
assert.strictEqual(M.archetypeFor('ZZZZ', {}), 'generic');
for (const [k, v] of Object.entries(M.TYPE_TABLE)) assert.ok(M.ARCHETYPES.includes(v[0]) && v[1] > 3 && v[2] > 3, k);
assert.deepStrictEqual(M.dimsFor('A320', 'narrowbody'), {span: 35.8, length: 37.6, exact: true});
assert.strictEqual(M.dimsFor('ZZZZ', 'helicopter').exact, false);

// ---- scale: minimum on-screen size ----
near(M.metresPerPixel(0, 0), 40075016.686 / 512, 1e-6);
near(M.metresPerPixel(60, 10), M.metresPerPixel(0, 10) / 2, 1e-6, 'cos(60) = 0.5');
{ // an A320 (37.6 m) at zoom 11 over the UK (lat 52): ~36 m/px * 0.62 = ~22 m/px, so 28 px is ~620 m
  const mpp = M.metresPerPixel(52, 11), d = M.drawLength(37.6, 52, 11);
  near(d, 28 * mpp, 1e-6); assert.ok(d > 500 && d < 800, 'drawn length at z11 ' + d);
  near(M.scaleFactor(37.6, 52, 11), d / 37.6, 1e-9);
}
// true scale at high zoom: once the real length exceeds 28 px the factor is exactly 1
assert.strictEqual(M.scaleFactor(37.6, 52, 19), 1);
assert.ok(M.scaleFactor(37.6, 52, 15) > 1 && M.scaleFactor(37.6, 52, 17) < M.scaleFactor(37.6, 52, 15), 'factor falls with zoom');
// the drawn length never drops below the pixel minimum nor below the real length; continuous in zoom
let prev = null;
for (let z = 6; z <= 20; z += 0.25) { const d = M.drawLength(37.6, 52, z), mpp = M.metresPerPixel(52, z); assert.ok(d >= 37.6 - 1e-9 && d >= 28 * mpp - 1e-6); if (prev) assert.ok(d <= prev + 1e-6, 'monotone'); prev = d; }
// crossfade: 0 below z0, 1 from z0 + 0.5, smooth between
assert.strictEqual(M.modelWeight(8.9), 0); assert.strictEqual(M.modelWeight(9.5), 1); assert.strictEqual(M.modelWeight(12), 1);
near(M.modelWeight(9.25), 0.5, 1e-9); assert.ok(M.modelWeight(9.1) < M.modelWeight(9.2) && M.modelWeight(9.2) < M.modelWeight(9.3));

// ---- orientation: ENU axes ----
const N = [0, 1, 0], E = [1, 0, 0], UP = [0, 0, 1];
vnear(M.apply(M.orientationENU(0, 0, 0), N), [0, 1, 0], 'yaw 0 nose north');
vnear(M.apply(M.orientationENU(90, 0, 0), N), [1, 0, 0], 'yaw 90 nose east');
vnear(M.apply(M.orientationENU(180, 0, 0), N), [0, -1, 0], 'yaw 180 nose south');
vnear(M.apply(M.orientationENU(270, 0, 0), N), [-1, 0, 0], 'yaw 270 nose west');
vnear(M.apply(M.orientationENU(0, 0, 0), E), [1, 0, 0], 'right wing east when heading north');
vnear(M.apply(M.orientationENU(90, 0, 0), E), [0, -1, 0], 'right wing south when heading east');
const up = M.apply(M.orientationENU(0, 10 * Math.PI / 180, 0), N); assert.ok(up[2] > 0.17 && up[1] > 0.98, 'pitch up raises the nose');
assert.ok(M.apply(M.orientationENU(0, -0.2, 0), N)[2] < 0, 'pitch down lowers the nose');
const rw = M.apply(M.orientationENU(0, 0, 0.3), E); assert.ok(rw[2] < 0, 'positive roll: right wing goes down');
const lw = M.apply(M.orientationENU(0, 0, 0.3), [-1, 0, 0]); assert.ok(lw[2] > 0, 'positive roll: left wing goes up');
{ const R = M.orientationENU(33, 0.2, -0.3), v = M.apply(R, [0.3, 0.5, 0.8]); near(Math.hypot(...v), Math.hypot(0.3, 0.5, 0.8), 1e-9, 'rotation keeps length'); }
// Mercator: north is -y, east is +x, up is +z; a heading-90 nose points to +x
vnear(M.apply(M.orientationMercator(0, 0, 0), [0, -1, 0]), [0, -1, 0], 'merc: north stays -y');
vnear(M.apply(M.orientationMercator(90, 0, 0), [0, -1, 0]), [1, 0, 0], 'merc: north vector rotated by heading 90 points east (+x)');
// the model's nose in Mercator axes for heading h is (sin h, -cos h, 0) once the model's +Y is mapped by S
for (const h of [0, 45, 90, 180, 300]) {
  const s = M.apply(M.orientationMercator(h, 0, 0), [0, -1, 0]);     // S * nose(ENU +Y) = (0,-1,0) in Mercator
  vnear(s, [Math.sin(h * Math.PI / 180), -Math.cos(h * Math.PI / 180), 0], 'merc nose h=' + h);
}
// roll sign survives the mirror: positive roll still drops the right wing (z < 0) when heading north
{ const R = M.orientationMercator(0, 0, 0.3); const wing = M.apply(R, [1, 0, 0]); assert.ok(wing[2] < 0, 'merc roll'); }

// ---- pitch and roll from data ----
near(M.pitchFrom(0, 400), 0); assert.strictEqual(M.pitchFrom(null, 400), 0); assert.strictEqual(M.pitchFrom(2000, 10), 0, 'too slow to trust');
{ const p = M.pitchFrom(3000, 300); assert.ok(p > 0.05 && p < 0.1, 'climb pitch ' + p); }
assert.ok(M.pitchFrom(-3000, 300) < 0);
near(M.pitchFrom(60000, 120), 15 * Math.PI / 180, 1e-9, 'clamped to 15 degrees');
near(M.rollFrom(12, null, null), 12 * Math.PI / 180);
near(M.rollFrom(80, 0, 0), 35 * Math.PI / 180, 1e-9, 'roll clamped');
{ const r = M.rollFrom(null, 3, 250); assert.ok(r > 0.55 && r < 0.62, 'standard rate turn at 250 kt is ~34.5 degrees of bank: ' + r); const s = M.rollFrom(null, 3, 100); assert.ok(Math.abs(s * 180 / Math.PI - 15.4) < 0.3, 'at 100 kt ~15.4 degrees: ' + s); }
assert.ok(M.rollFrom(null, -3, 250) < 0, 'left turn banks left');
assert.strictEqual(M.rollFrom(null, null, null), 0);
// smoothing
assert.strictEqual(M.smoothAngle(null, 5, 0.1, 1), 5);
near(M.smoothAngle(0, 10, 1, 1), 10 * (1 - Math.exp(-1)), 1e-9);
near(M.smoothAngle(350, 10, 1e6, 1, true), 10, 1e-6, 'wraps the short way');
assert.ok(M.smoothAngle(350, 10, 0.1, 1, true) > 350 || M.smoothAngle(350, 10, 0.1, 1, true) < 10);

// ---- nearest n ----
{ const items = []; for (let i = 0; i < 1000; i++) items.push({id: i, x: i, y: 0 });
  const sel = M.nearest(items, 500, 0, 300); assert.strictEqual(sel.length, 300);
  assert.ok(sel.every(s => Math.abs(s.id - 500) <= 150), 'the 300 nearest to the centre');
  assert.strictEqual(M.nearest(items.slice(0, 5), 0, 0, 300).length, 5);
  assert.deepStrictEqual(M.nearest([{x: 1, y: 0, id: 'a'}, {x: -1, y: 0, id: 'b'}], 0, 0, 1).map(s => s.id), ['a'], 'ties keep input order'); }
// terrain exaggeration
assert.strictEqual(M.surfaceZ(true, 120, 1.5), 180); assert.strictEqual(M.surfaceZ(true, null, 2), 0);
console.log('models-calc tests ok');

// ---- true 3D placement: closed-form height, compression, monotonicity (synthetic perspective camera, column-major, Mercator in, clip out) ----
(function () {
    const W = 1000, H = 800, fov = 0.6435;
    function camera(zoom, pitchDeg, bearingDeg, cLon, cLat) {
        const ws = 512 * Math.pow(2, zoom), ctd = 0.5 / Math.tan(fov / 2) * H, near = 1, far = 1e9, f = 1 / Math.tan(fov / 2), asp = W / H;
        const mul = (a, b) => { const r = new Array(16).fill(0); for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) for (let k = 0; k < 4; k++) r[j * 4 + i] += a[k * 4 + i] * b[j * 4 + k]; return r; };
        const P = [f / asp, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) / (near - far), -1, 0, 0, 2 * far * near / (near - far), 0];
        const T = (x, y, z) => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1];
        const Rx = a => [1, 0, 0, 0, 0, Math.cos(a), Math.sin(a), 0, 0, -Math.sin(a), Math.cos(a), 0, 0, 0, 0, 1];
        const Rz = a => [Math.cos(a), Math.sin(a), 0, 0, -Math.sin(a), Math.cos(a), 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
        const S = (x, y, z) => [x, 0, 0, 0, 0, y, 0, 0, 0, 0, z, 0, 0, 0, 0, 1];
        const cs = Math.sin(cLat * Math.PI / 180), cx = (cLon + 180) / 360, cy = 0.5 - Math.log((1 + cs) / (1 - cs)) / (4 * Math.PI);
        // world: Mercator -> pixels (x right, y down, z up), then camera
        let m = mul(P, T(0, 0, -ctd)); m = mul(m, Rx(-pitchDeg * Math.PI / 180)); m = mul(m, Rz(bearingDeg * Math.PI / 180));
        m = mul(m, S(ws, -ws, ws)); m = mul(m, T(-cx, -cy, 0));
        return m;
    }
    const g = {}, o = {}, o2 = {}, ALT = 10000, lat = 51.5, lon = -0.45;
    // Realistic: the offset above the shadow never decreases as zoom increases (while the point is in front of the camera)
    for (const pitch of [30, 60]) {
        let prev = -1;
        for (let z = 9; z <= 15; z += 0.5) {
            const Mx = camera(z, pitch, 20, lon, lat);
            M.ground(Mx, lon, lat, 0, g); assert.ok(g.ok);
            M.pose(Mx, g, ALT, 'realistic', 0, 190, W, H, o);
            const y0 = (0.5 - 0.5 * g.cy / g.cw) * H;
            if (!o.ok || o.clamped) continue;
            const off = y0 - o.y;
            assert.ok(off >= prev - 1e-6, 'realistic offset decreased at zoom ' + z + ' pitch ' + pitch + ': ' + off + ' < ' + prev);
            prev = off;
        }
        assert.ok(prev > 50, 'the offset is substantial: ' + prev);
    }
    // Compressed: reaches exactly the requested screen offset, and is monotonic in altitude
    const Mx = camera(12, 55, 0, lon, lat);
    M.ground(Mx, lon, lat, 0, g);
    const y0 = (0.5 - 0.5 * g.cy / g.cw) * H;
    let prevOff = -1;
    for (const alt of [0, 100, 500, 1000, 3000, 6000, 10000, 13000]) {
        const raw = alt / 12 * Math.sin(55 * Math.PI / 180);
        M.pose(Mx, g, alt, 'compressed', raw, 190, W, H, o);
        assert.ok(o.ok);
        const off = y0 - o.y;
        near(off, M.compressPx(raw, 190), 1e-6, 'compressed offset at ' + alt);
        assert.ok(off >= prevOff - 1e-9, 'compressed offset not monotonic in altitude at ' + alt);
        prevOff = off;
    }
    assert.ok(prevOff < 190, 'bounded by the cap');
    // a larger altitude is never drawn lower than a smaller one, at every zoom 9..20 (compressed)
    for (let z = 9; z <= 20; z += 1) {
        const Mz = camera(z, 60, 0, lon, lat); M.ground(Mz, lon, lat, 0, g);
        const mppz = M.metresPerPixel(lat, z);
        let last = -1;
        for (const alt of [200, 1000, 4000, 9000, 12000]) {
            M.pose(Mz, g, alt, 'compressed', alt / mppz * Math.sin(60 * Math.PI / 180), 190, W, H, o);
            const off = (0.5 - 0.5 * g.cy / g.cw) * H - o.y; assert.ok(off >= last - 1e-6, 'zoom ' + z + ' alt ' + alt); last = off;
        }
    }
    // zero pitch: the height cannot move the point on screen; the true height is kept, nothing is NaN
    const Mt = camera(12, 0, 0, lon, lat); M.ground(Mt, lon, lat, 0, g); M.pose(Mt, g, 8000, 'compressed', 300, 190, W, H, o); assert.ok(o.ok && isFinite(o.x) && isFinite(o.y));
    // closed form: heightForScreenY inverts screenAbove
    const dz = M.heightForScreenY(Mx, g, y0 - 120, H); M.screenAbove(Mx, g, dz, W, H, o2); near(o2.y, y0 - 120, 1e-6, 'closed form');
    // allocation-free orientation equals the allocating one
    const out = new Float64Array(9);
    for (const [yaw, p, r] of [[0, 0, 0], [90, 0.1, -0.2], [217, -0.2, 0.5]]) { M.orientationInto(out, yaw, p, r); vnear(Array.from(out), M.orientationENU(yaw, p, r), 'orientationInto ' + yaw); }
    console.log('models-calc placement ok');
})();
