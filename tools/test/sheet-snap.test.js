// node tools/test/sheet-snap.test.js
const S = require('../../html/ui/sheet-snap.js'), assert = require('assert');
const P = [140, 420, 780];
assert.equal(S.snap(150, 0, P), 140); assert.equal(S.snap(300, 0, P), 420); assert.equal(S.snap(700, 0, P), 780);
assert.equal(S.snap(280, 0, P), 140, 'closer to peek'); assert.equal(S.snap(281, 0, P), 420);
// a flick carries past the nearest point
assert.equal(S.snap(200, 0.5, P), 420, 'upward fling from near peek reaches half'); assert.equal(S.snap(420, -0.7, P), 140);
assert.equal(S.snap(430, 1.2, P), 780, 'hard upward flick from half goes full'); assert.equal(S.snap(430, -1.2, P), 140, 'hard downward flick goes to peek');
assert.equal(S.snap(780, 1.5, P), 780, 'cannot open past full'); assert.equal(S.snap(140, -1.5, P), 140);
assert.equal(S.snap(430, 0.1, P), 420, 'slow release stays');
assert.equal(S.snap(500, 0, [780, 140, 420]), 420, 'unsorted points are fine');
// rubber band
assert.equal(S.rubber(500, 140, 780), 500); assert.equal(S.rubber(880, 140, 780), 810); assert.equal(S.rubber(3000, 140, 780), 840); assert.equal(S.rubber(100, 140, 780), 128); assert.equal(S.rubber(-500, 140, 780), 80);
// points: ordered and within the viewport
for (const vh of [568, 667, 844, 932]) { const p = S.points(vh, 140, 47); assert.ok(p[0] < p[1] && p[1] < p[2] && p[2] <= vh, vh + ':' + p); }
assert.ok(S.points(568, 230, 0)[0] < S.points(568, 230, 0)[1]);
console.log('sheet-snap tests ok');
