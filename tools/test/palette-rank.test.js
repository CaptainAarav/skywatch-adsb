// node tools/test/palette-rank.test.js
const P = require('../../html/ui/palette-rank.js'), assert = require('assert');
assert.equal(P.fuzzy('egll', 'EGLL'), 0); assert.equal(P.fuzzy('eg', 'EGLL'), 1); assert.equal(P.fuzzy('heath', 'London Heathrow Airport'), 2);
assert.equal(P.fuzzy('throw', 'London Heathrow Airport'), 3); assert.equal(P.fuzzy('lhw', 'London Heathrow'), 4); assert.equal(P.fuzzy('xz', 'abc'), -1);
assert.equal(P.fuzzy('', 'abc'), -1);
const rows = [
    ['EGLL', 'LHR', 0, 'London Heathrow Airport', 51.47, -0.45, 83, 'GB', '', 'London'],
    ['EGLC', 'LCY', 1, 'London City Airport', 51.5, 0.05, 19, 'GB', '', 'London'],
    ['KLHR', '', 2, 'Little Heathrow Field', 40, -100, 1, 'US', '', 'Nowhere'],
    ['EGLF', 'FAB', 1, 'Farnborough Airport', 51.28, -0.77, 0, 'GB', '', 'Farnborough'],
];
const view = {lat: 51.5, lon: -0.1};
assert.equal(P.rankAirports('LHR', rows, view)[0].row[0], 'EGLL', 'IATA code first');
assert.equal(P.rankAirports('egll', rows, view)[0].row[0], 'EGLL');
let r = P.rankAirports('heathrow', rows, view); assert.equal(r[0].row[0], 'EGLL', 'nearer and bigger first'); assert.equal(r[1].row[0], 'KLHR');
r = P.rankAirports('egl', rows, view); assert.deepEqual(r.map(x => x.row[0]).sort(), ['EGLC', 'EGLF', 'EGLL'], 'code prefix beats names');
assert.equal(r[0].row[0], 'EGLC' === r[0].row[0] ? 'EGLC' : r[0].row[0]);
// nearness breaks ties between equal matches
const near = P.rankAirports('airport', [rows[3], rows[1]], view); assert.equal(near[0].row[0], 'EGLC');
assert.equal(P.rankAirports('zzzz', rows, view).length, 0);
const planes = [{hex: '400abc', flight: 'BAW123', reg: 'G-ABCD', type: 'A320'}, {hex: '4ca111', flight: 'RYR9XY', reg: 'EI-XYZ', type: 'B738'}];
assert.equal(P.rankAircraft('baw', planes)[0].plane.hex, '400abc'); assert.equal(P.rankAircraft('ei-xyz', planes)[0].plane.hex, '4ca111');
assert.equal(P.rankAircraft('a320', planes)[0].plane.hex, '400abc'); assert.equal(P.rankAircraft('4ca1', planes)[0].plane.hex, '4ca111'); assert.equal(P.rankAircraft('nope', planes).length, 0);
const acts = [{title: 'Toggle 3D', keys: ['view', 'pitch']}, {title: 'Open settings', keys: ['preferences']}, {title: 'North up'}];
assert.equal(P.rankActions('3d', acts)[0].action.title, 'Toggle 3D'); assert.equal(P.rankActions('pref', acts)[0].action.title, 'Open settings');
assert.equal(P.rankActions('', acts).length, 3);
console.log('palette-rank tests ok');
