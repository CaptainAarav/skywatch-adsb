// node tools/test/instrument-summary.test.js
const I = require('../../html/ui/instrument-summary.js'), assert = require('assert');
const fmt = (n) => Math.round(n).toLocaleString('en-US');
// altitude
assert.deepEqual(I.altitude(35000, false, fmt, 'ft'), {value: '35,000', unit: 'ft', fl: 'FL350'});
assert.deepEqual(I.altitude(2200, false, fmt, 'ft'), {value: '2,200', unit: 'ft', fl: ''});
assert.equal(I.altitude(18000, false, fmt, 'ft').fl, 'FL180'); assert.equal(I.altitude(17999, false, fmt, 'ft').fl, '');
assert.equal(I.altitude(5000, false, fmt, 'ft').fl, ''); assert.equal(I.altitude(900, false, fmt, 'ft').value, '900');
assert.deepEqual(I.altitude(null, false, fmt, 'ft'), {value: I.DASH, unit: '', fl: ''});
assert.deepEqual(I.altitude(undefined, false, fmt, 'ft'), {value: I.DASH, unit: '', fl: ''});
assert.deepEqual(I.altitude(NaN, false, fmt, 'ft'), {value: I.DASH, unit: '', fl: ''});
assert.deepEqual(I.altitude(0, true, fmt, 'ft'), {value: 'Ground', unit: '', fl: ''});
// trend
assert.deepEqual(I.trend(1800, '1,800 ft/min'), {cls: 'climb', glyph: '▲', text: '1,800 ft/min'});
assert.equal(I.trend(-900, '900 ft/min').cls, 'descend'); assert.equal(I.trend(-900, 'x').glyph, '▼');
assert.deepEqual(I.trend(0, 'x'), {cls: 'level', glyph: '', text: 'Level'}); assert.equal(I.trend(300, 'x').cls, 'level'); assert.equal(I.trend(301, 'x').cls, 'climb');
assert.deepEqual(I.trend(null, 'x'), {cls: '', glyph: '', text: ''}); assert.equal(I.trend(undefined, 'x').text, '');
// speed
assert.deepEqual(I.speed({gs: 450, ias: 250, tas: 470, mach: 0.78}, fmt, 'kt'), {value: '450', unit: 'kt', kind: 'GS', sub: 'Mach 0.78'});
assert.equal(I.speed({gs: 450, ias: 250}, fmt, 'kt').sub, 'IAS 250'); assert.equal(I.speed({gs: 450, tas: 470}, fmt, 'kt').sub, 'TAS 470');
assert.equal(I.speed({gs: 120}, fmt, 'kt').sub, ''); assert.equal(I.speed({tas: 300}, fmt, 'kt').kind, 'TAS'); assert.equal(I.speed({ias: 200}, fmt, 'kt').kind, 'IAS');
assert.deepEqual(I.speed({}, fmt, 'kt'), {value: I.DASH, unit: '', kind: '', sub: ''}); assert.equal(I.speed({gs: null, mach: 0}, fmt, 'kt').sub, '');
// direction
assert.deepEqual(I.direction(87), {value: '087°', sub: 'E'}); assert.deepEqual(I.direction(0), {value: '000°', sub: 'N'});
assert.equal(I.direction(359.6).value, '000°'); assert.equal(I.direction(225).sub, 'SW'); assert.equal(I.direction(-10).value, '350°');
assert.deepEqual(I.direction(null), {value: I.DASH, sub: ''});
console.log('instrument-summary tests ok');
