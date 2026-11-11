// node tools/test/radar2d.test.js  (pure helpers of the no-WebGL 2D radar fallback)
const R = require('../../html/ui/radar2d.js'), assert = require('assert');
const NM = 1852, site = [-1.0, 51.0];
let q = R.project(site, site, 1e-3); assert.deepEqual(q.slice(0, 2).map(Math.abs), [0, 0]);
q = R.project(site, [site[0], site[1] + 1 / 60], 1);            // one arc-minute north = ~1 nm, drawn UP (negative y)
assert(q[1] < 0 && Math.abs(Math.abs(q[1]) - NM) < 5 && Math.abs(q[0]) < 1e-6);
q = R.project(site, [site[0] + 1 / 60, site[1]], 1);            // east is +x and shorter by cos(lat)
assert(q[0] > 0 && Math.abs(q[0] - NM * Math.cos(51 * Math.PI / 180)) < 5);
assert.equal(R.niceRange(0), 25 * NM);
assert.equal(R.niceRange(46 * NM), 50 * NM);
assert.equal(R.niceRange(47 * NM), 100 * NM, 'margin keeps the furthest aircraft inside');
assert.equal(R.niceRange(9999 * NM), 800 * NM);
assert.equal(R.ringStep(50 * NM), 10 * NM); assert.equal(R.ringStep(150 * NM), 50 * NM);
assert.equal(R.label({flight: ' BAW12 ', icao: 'abc123'}), 'BAW12');
assert.equal(R.label({icao: 'abc123'}), 'ABC123');
assert.equal(R.label({registration: 'G-ABCD', icao: 'abc123'}), 'G-ABCD');
console.log('radar2d tests ok');
