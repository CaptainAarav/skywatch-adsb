// node tools/test/banner-state.test.js
const B = require('../../html/ui/banner-state.js'), assert = require('assert');
let m = B.create(), t = 1e6;
assert.equal(m.view(t).visible, false);
m.ok(t, true);
assert.equal(m.tick(t + 10000).state, 'connected');
// retrying
let v = m.fail(t + 11000, 'x'); assert.equal(v.state, 'retrying'); assert.equal(v.retryIn, 8); assert(v.visible);
v = m.tick(t + 14000); assert.equal(v.retryIn, 5);
v = m.fail(t + 14500, 'y'); assert.equal(v.retryIn, 5, 'repeated failures keep the countdown');
v = m.tick(t + 19001); assert.equal(v.state, 'retrying'); assert.equal(v.retryIn, 8, 'countdown restarts after each retry');
// recovered, then clears
v = m.ok(t + 20000, true); assert.equal(v.state, 'recovered'); assert(v.visible);
assert.equal(m.tick(t + 20000 + B.RECOVERED_MS + 1).state, 'connected');
// stale: data answers but does not advance
m = B.create(); m.ok(t, true);
for (let i = 1; i < 40; i++) m.ok(t + i * 1000, false);
v = m.tick(t + 40000); assert.equal(v.state, 'stale'); assert(v.ageSec >= 30); assert(v.lastGood > t + 38000);
v = m.ok(t + 41000, false); assert.equal(v.state, 'stale');
v = m.ok(t + 42000, true); assert.equal(v.state, 'recovered');
// failure while stale goes to retrying; never stale straight after a recovery
v = m.fail(t + 60000, 'z'); assert.equal(v.state, 'retrying');
// cause: the banner must name the real reason and never blame the receiver when this page simply stopped fetching
m = B.create(); m.ok(t, true);
v = m.tick(t + 31000);                                          // no fetch completed at all for 31 s (the old no-WebGL bug)
assert.equal(v.state, 'stale'); assert.equal(v.cause, 'page', 'no completed fetch -> this page, not the receiver');
m = B.create(); m.ok(t, true);
for (let i = 1; i < 35; i++) m.ok(t + i * 1000, false);          // fetches keep succeeding, receiver time frozen
v = m.tick(t + 35000); assert.equal(v.state, 'stale'); assert.equal(v.cause, 'receiver');
v = m.tick(t + 35000 + B.SILENT_MS + 1); assert.equal(v.cause, 'page', 'fetches then stop -> switches to page');
assert.equal(m.fail(t + 60000, 'x').cause, 'unreachable');
assert.equal(B.create().view(t).cause, '');
// map note
m = B.create(); assert.equal(m.view(t).mapOk, true); m.setMap(false); assert.equal(m.view(t).mapOk, false); m.setMap(true); assert.equal(m.view(t).mapOk, true);
console.log('banner-state tests ok');
