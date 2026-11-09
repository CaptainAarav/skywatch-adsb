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
// peek height measured from content: handle + header + summaries + action bar, clamped to 62% of the viewport
assert.equal(S.peekHeight({handle: 28, blocks: [74, 112, 64]}, 844), 278, 'sum of the visible blocks');
assert.equal(S.peekHeight({handle: 28, blocks: [74.2, 112.1, 64]}, 844), 279, 'rounds up so nothing is clipped');
assert.equal(S.peekHeight({handle: 28, blocks: [500, 500, 64]}, 640), 396, 'never taller than 62% of the viewport');
assert.equal(S.peekHeight({handle: 28, blocks: []}, 640), 96, 'floor');
assert.equal(S.peekHeight({handle: 28, blocks: [NaN, -4, undefined, 10]}, 800), 96, 'ignores missing and bad measurements');
assert.equal(S.peekHeight({handle: 28, blocks: [60, 80, 50], pad: 12}, 800), 230, 'extra padding is added');
assert.ok(S.peekHeight({handle: 28, blocks: [74, 112, 64]}, 640) < 640 * 0.62 + 1);
// the snap name drives which parts of a card show
const Q = [278, 440, 830];
assert.equal(S.snapName(278, Q), 'peek'); assert.equal(S.snapName(450, Q), 'half'); assert.equal(S.snapName(830, Q), 'full'); assert.equal(S.snapName(300, []), 'peek');
// swipe down from peek dismisses the selection; a drag that started elsewhere never does
assert.equal(S.shouldDismiss(278, 250, 0, 278), true, 'dragged 28 px below peek');
assert.equal(S.shouldDismiss(278, 270, 0, 278), false, 'a small wobble stays');
assert.equal(S.shouldDismiss(278, 278, -0.6, 278), true, 'a quick downward flick');
assert.equal(S.shouldDismiss(440, 200, -1, 278), false, 'started at half: only settles to peek');
assert.equal(S.shouldDismiss(278, 300, 0.5, 278), false, 'opening never dismisses');
console.log('sheet-snap tests ok');
