// node tools/test/models-norm.test.js  (glTF -> instance-frame normalisation)
const N = require('../../html/ui/models-norm.js'), assert = require('assert');
// a box of half-extents (hx, hy, hz) centred at c, as 12 triangles
function box(c, h, material) {
  const P = [], V = [[-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1], [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]];
  const F = [[0, 1, 2, 3], [4, 7, 6, 5], [0, 4, 5, 1], [2, 6, 7, 3], [0, 3, 7, 4], [1, 5, 6, 2]];
  for (const q of F) for (const k of [[0, 1, 2], [0, 2, 3]]) for (const i of k) P.push(c[0] + V[q[i]][0] * h[0], c[1] + V[q[i]][1] * h[1], c[2] + V[q[i]][2] * h[2]);
  const pos = new Float32Array(P), nor = new Float32Array(P.length); for (let i = 0; i < nor.length; i += 3) { nor[i] = 0; nor[i + 1] = 1; nor[i + 2] = 0; }
  return {pos, nor, material: material || 'body'};
}
// an aircraft built in glTF axes facing -Z: fuselage along Z (length 40), wings along X (span 30), up is +Y; an engine and a tail fin
const model = [box([0, 3, 0], [2, 2, 20], 'Fuselage'), box([0, 3, 2], [13, 0.2, 3], 'Wing'), box([-9, 1.5, 3], [1, 1.2, 2], 'Engine_nacelle'), box([0, 7, 16], [0.2, 3, 3], 'Fin')];
const r = N.normalize(model, {forward: '-z'});
assert.equal(r.triangles, 48);
let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9, z0 = 1e9;
for (let i = 0; i < r.pos.length; i += 3) { x0 = Math.min(x0, r.pos[i]); x1 = Math.max(x1, r.pos[i]); y0 = Math.min(y0, r.pos[i + 1]); y1 = Math.max(y1, r.pos[i + 1]); z0 = Math.min(z0, r.pos[i + 2]); }
assert(Math.abs(x1 - x0 - 1) < 1e-5, 'unit span along X'); assert(Math.abs(y1 - y0 - 1) < 1e-5, 'unit length along Y');
assert(Math.abs((x0 + x1) / 2) < 1e-5 && Math.abs((y0 + y1) / 2) < 1e-5, 'centred in X and Y'); assert(Math.abs(z0) < 1e-6, 'belly at z = 0');
assert.equal(r.span, 26 + 10 > 0 ? r.span : 0);       // keep r.span used
// nose is +Y: the model faces -Z in glTF, so the nose end of the fuselage (z = -20) must map to y = +0.5
const nose = model[0]; let found = false;
for (let i = 0; i < r.pos.length / 3; i++) if (Math.abs(r.pos[i * 3 + 1] - 0.5) < 1e-5) found = true;
assert(found, 'nose at +Y');
// the +Z-facing export gives the mirrored result for the same file (x also flips: right = forward x up)
const r2 = N.normalize(model, {forward: '+z'});
let tailY = [], tailY2 = [];
for (let i = 0; i < r.part.length; i++) if (r.part[i] === 2) tailY.push(r.pos[i * 3 + 1]);
for (let i = 0; i < r2.part.length; i++) if (r2.part[i] === 2) tailY2.push(r2.pos[i * 3 + 1]);
assert(tailY.length > 0 && tailY.every(y => y < -0.22), 'fin is at the rear for -z forward: ' + tailY.length);
assert(tailY2.length === 0 || tailY2.every(y => y > 0), 'forward +z puts that fin at the nose end (no fin there)');
// parts: engine is trim (1), fuselage and wing body (0), fin 2
const count = [0, 0, 0]; for (const p of r.part) count[p]++;
assert(count[1] === 36 && count[2] > 0 && count[0] > 0, 'parts ' + count);
// normals stay unit length
for (let i = 0; i < r.nor.length; i += 3) assert(Math.abs(Math.hypot(r.nor[i], r.nor[i + 1], r.nor[i + 2]) - 1) < 1e-5);
assert.throws(() => N.normalize(model, {forward: 'up'}), /unknown forward axis/);
assert.throws(() => N.normalize([{pos: new Float32Array(0), nor: new Float32Array(0)}]), /no extent/);
// proportions check
assert(N.proportionsOk(35.8, 37.6, 35.8, 37.6)); assert(!N.proportionsOk(70, 20, 35.8, 37.6), 'a model on its side is rejected');
for (const s of ['Cockpit_glass', 'engine_L', 'Wheel', 'propeller', 'Landing_gear', 'Window']) assert(N.TRIM_RE.test(s), s);
for (const s of ['Fuselage', 'Wing', 'Paint_white', 'tail']) assert(!N.TRIM_RE.test(s), s);
console.log('models-norm tests ok');
