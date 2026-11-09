// node tools/test/alerts-calc.test.js
const A = require('../../html/ui/alerts-calc.js'), assert = require('assert');
assert.deepEqual(A.clean({type: 'reg', value: ' g-abcd '}), {type: 'reg', value: 'G-ABCD', on: true});
assert.equal(A.clean({type: 'reg', value: ''}), null); assert.equal(A.clean({type: 'bogus'}), null); assert.equal(A.clean({type: 'hex', value: 'xyz'}), null);
assert.equal(A.clean({type: 'hex', value: '~43c123'}).value, '43C123'); assert.equal(A.clean({type: 'reg', value: '<img>'}), null);
assert.deepEqual(A.clean({type: 'military', value: 'junk'}), {type: 'military', value: '', on: true});
const p = {hex: '43c123', flight: 'RRR1234 ', reg: 'zz123', type: 'a388', squawk: '7700', military: 1, interesting: 0};
const R = (t, v) => A.clean({type: t, value: v});
assert.equal(A.match(p, R('emergency')), 'Squawking 7700 (general emergency)'); assert.equal(A.match(p, R('military')), 'Military aircraft');
assert.equal(A.match(p, R('interesting')), null); assert.equal(A.match(p, R('hex', '43C123')), 'Hex 43C123'); assert.equal(A.match(p, R('reg', 'ZZ123')), 'Registration ZZ123');
assert.equal(A.match(p, R('callsign_prefix', 'rrr')), 'Callsign RRR*'); assert.equal(A.match(p, R('type', 'A388')), 'Type A388'); assert.equal(A.match(p, R('type', 'A320')), null);
assert.equal(A.match(p, {type: 'military', value: '', on: false}), null, 'disabled rule');
assert.equal(A.match({hex: 'a', squawk: '1200'}, R('emergency')), null);
// evaluate: dedupe 30 min, snooze 1 h, global off, max 5/min
const T = 1e9, mk = (n) => Array.from({length: n}, (_, i) => ({hex: 'a' + i, squawk: '7700'}));
let st = {}; assert.equal(A.evaluate([p], [R('emergency')], st, T).length, 1);
assert.equal(A.evaluate([p], [R('emergency')], st, T + 29 * 60000).length, 0, 'deduped'); assert.equal(A.evaluate([p], [R('emergency')], st, T + 31 * 60000).length, 1, 'after 30 min');
st = {}; assert.equal(A.evaluate(mk(9), [R('emergency')], st, T).length, 5, 'max 5 per minute'); assert.equal(A.evaluate(mk(9), [R('emergency')], st, T + 1000).length, 0);
assert.equal(A.evaluate(mk(9), [R('emergency')], st, T + 61000).length, 4, 'the remaining four, after the minute');
st = {snoozeUntil: T + 3600000}; assert.equal(A.evaluate([p], [R('emergency')], st, T + 1000).length, 0, 'snoozed'); assert.equal(A.evaluate([p], [R('emergency')], st, T + 3600001).length, 1, 'snooze over');
assert.equal(A.evaluate([p], [R('emergency')], {off: true}, T).length, 0, 'global off');
st = {}; const ev = A.evaluate([p], [R('type', 'A388'), R('emergency')], st, T); assert.equal(ev.length, 1, 'one alert per aircraft per pass'); assert.equal(ev[0].emergency, false);
assert.equal(A.evaluate([p], [R('emergency')], {}, T)[0].emergency, true);
console.log('alerts-calc tests ok');
