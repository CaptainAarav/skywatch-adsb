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
