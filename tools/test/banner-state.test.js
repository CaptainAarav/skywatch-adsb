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
console.log('banner-state tests ok');
