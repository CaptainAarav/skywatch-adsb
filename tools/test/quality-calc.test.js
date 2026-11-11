// node tools/test/quality-calc.test.js  (3D quality ladder and Auto controller, synthetic frame times)
const Q = require('../../html/ui/quality-calc.js'), assert = require('assert');
// ladder: levels only ever turn things down, in the documented order
const flags = (l) => { const s = Q.settings(l); return [s.pixelRatioCap < 2, !s.shadows, s.labelDensity === 'reduced', s.modelLod === 'low', s.terrainDetail === 'light', !s.terrain, !s.models]; };
for (let l = 0; l <= Q.MAX_LEVEL; l++) {
  const f = flags(l);
  for (let k = 0; k < f.length; k++) assert.equal(f[k], l >= k + 1, 'level ' + l + ' step ' + (k + 1));
  if (l) { const p = flags(l - 1); for (let k = 0; k < f.length; k++) assert(!(p[k] && !f[k]), 'monotonic'); }
}
assert.equal(Q.settings(99).level, Q.MAX_LEVEL); assert.equal(Q.settings(-3).level, 0);
assert.deepEqual(Q.FIXED, {high: 0, balanced: 3, low: 6});
assert.equal(Q.modeFrom('low'), 'low'); assert.equal(Q.modeFrom('x'), 'auto');
// pixel ratio: cap by tier and by canvas size
assert.equal(Q.pixelRatio(0, 3, 1000, 700), 2);
assert.equal(Q.pixelRatio(1, 3, 1000, 700), 1.5);
assert.equal(Q.pixelRatio(0, 2, 1920, 1080), 1.25, 'over 4 MP at 2x steps down to 1.25 (3.2 MP)');
assert.equal(Q.pixelRatio(0, 2, 1366, 768), 1.5, 'a 1366x768 canvas at 2x is 4.2 MP at 2x, 2.4 MP at 1.5');
assert(Q.pixelRatio(1, 3, 2560, 1440) <= 1.25 + 1e-9, 'big canvas lowers it');
assert.equal(Q.pixelRatio(1, 1, 800, 600), 1);
assert.equal(Q.pixelRatio(0, 0, 800, 600), 1, 'bad dpr');
// software renderer detection
for (const r of ['ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)', 'llvmpipe (LLVM 15.0.7, 256 bits)', 'Microsoft Basic Render Driver']) assert(Q.isSoftware(r), r);
for (const r of ['ANGLE (NVIDIA, NVIDIA GeForce GTX 1650)', 'Apple M2', 'Mali-G78', '', null]) assert(!Q.isSoftware(r), String(r));
// controller helper: feed n seconds of frames at a constant frame time
function feed(c, t0, secs, ms) { let t = t0; const end = t0 + secs * 1000; while (t < end) { c.push(ms, t); t += ms; } return t; }
// slow device: steps down one level at a time, never faster than the cool-down, down to the last level
let c = Q.controller(), t = 0, prev = 0, lastStep = -1e9;
while (t < 120000) { c.push(60, t); t += 60; const l = c.level(); if (l !== prev) { assert.equal(l, prev + 1, 'one step at a time'); assert(t - lastStep >= 2500, 'cool-down respected'); lastStep = t; prev = l; } }
assert.equal(c.level(), Q.MAX_LEVEL, 'a very slow device ends at the last level');
// a fast device never steps down
c = Q.controller(); feed(c, 0, 60, 8); assert.equal(c.level(), 0);
// borderline: p95 between 18 and 30 ms neither steps down nor up (hysteresis band)
c = Q.controller({start: 3}); feed(c, 0, 120, 24); assert.equal(c.level(), 3, 'inside the band nothing changes');
// recovery: good frames for 20 s AND 30 s after the last step down -> exactly one step up, then wait again
c = Q.controller({start: 2}); t = feed(c, 0, 10, 8); assert.equal(c.level(), 2, 'not yet (hold after down / sustained time)');
t = feed(c, t, 25, 8); assert.equal(c.level(), 1, 'one step up after a sustained good period');
t = feed(c, t, 3, 8); assert.equal(c.level(), 1, 'but not another one straight away');
// no flapping: a step up followed by a bad period steps down, and the next up takes twice as long
c = Q.controller({start: 1}); t = feed(c, 0, 40, 8); assert.equal(c.level(), 0);
while (c.level() === 0) { c.push(60, t); t += 60; } assert.equal(c.level(), 1, 'bad frames step down again');
let up1 = t; t = feed(c, t, 30, 8); const after30 = c.level(); t = feed(c, t, 45, 8);
assert.equal(c.level(), 0, 'it does come back eventually'); assert(c.state().penalty >= 2, 'penalised after flapping');
assert.equal(after30, 1, 'the second climb waits longer than the first (penalty)');
// a short spike does not step down (needs >= 20 samples above 30 ms and p95)
c = Q.controller(); t = feed(c, 0, 5, 8); for (let i = 0; i < 3; i++) { c.push(120, t); t += 120; } t = feed(c, t, 5, 8); assert.equal(c.level(), 0, 'a few slow frames are ignored');
// force()
c = Q.controller(); c.force(5); assert.equal(c.level(), 5); c.force(99); assert.equal(c.level(), Q.MAX_LEVEL);
console.log('quality-calc tests ok');
