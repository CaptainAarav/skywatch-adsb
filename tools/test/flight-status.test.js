// node tools/test/flight-status.test.js
const F = require('../../html/ui/flight-status.js'), assert = require('assert');
const s = F.sentence;
assert.equal(s('ground', null, 0), 'On the ground'); assert.equal(s('ground', null, 3), 'On the ground'); assert.equal(s('ground', 0, 14), 'Taxiing on the ground at 14 kt');
assert.equal(s(2200, -900, 160), 'Descending through 2,200 ft'); assert.equal(s(8000, 1800, 250), 'Climbing through 8,000 ft');
assert.equal(s(35000, 0, 450), 'Cruising at FL350'); assert.equal(s(35000, 100, 450), 'Cruising at FL350'); assert.equal(s(41000, -100, 450), 'Cruising at FL410'); assert.equal(s(9000, 50, 300), 'Level at 9,000 ft');
assert.equal(s(3500, null, 120), 'Level at 3,500 ft'); assert.equal(s(35000, null, 450), 'Cruising at FL350', 'unknown vertical rate is not claimed as climb or descent');
assert.equal(s(10000, -299, 250), 'Level at 10,000 ft', 'small rates are level'); assert.equal(s(10000, -300, 250), 'Descending through 10,000 ft');
assert.equal(s(10000, -900, 250, true), 'Descending through 3,048 m');
assert.equal(s(null, -900, 250), ''); assert.equal(s(undefined, 0, 0), ''); assert.equal(s(NaN, 0, 0), '');
console.log('flight-status tests ok');
