// node tools/test/airport-calc.test.js   (no dependencies)
const A = require('../../html/ui/airport-calc.js'), assert = require('assert');
const near = (a, b, e = 0.05) => assert(Math.abs(a - b) <= e, `${a} !~ ${b}`);
// wind 240 at 12 kt, runway heading 260 (end 26): head 11.3, wind from the left (cross < 0)
let c = A.windComponents(240, 12, 260); near(c.head, 11.28); near(c.cross, -4.1);
c = A.windComponents(240, 12, 80); near(c.head, -11.28); near(c.cross, 4.1);       // tailwind, from the right
let rw = A.runwayWind([{id: '08', hdg: 80}, {id: '26', hdg: 260}], 240, 12); assert.equal(rw.best, '26');
assert.equal(A.runwayWind([{id: '08', hdg: 80}, {id: '26', hdg: 260}], 'VRB', 12).best, null);
assert.equal(A.runwayWind([{id: '08', hdg: 80}, {id: '26', hdg: 260}], 240, 0).best, null);
// tie on headwind: lower crosswind wins
rw = A.runwayWind([{id: 'A', hdg: 0}, {id: 'B', hdg: 180}], 270, 10); assert.equal(rw.best, null);   // both head ~0 -> no positive head
// categories
assert.equal(A.flightCategory(10, null), 'VFR'); assert.equal(A.flightCategory(10, 3000), 'MVFR'); assert.equal(A.flightCategory(10, 3100), 'VFR');
assert.equal(A.flightCategory(5, null), 'MVFR'); assert.equal(A.flightCategory(2.67, null), 'IFR'); assert.equal(A.flightCategory(0.5, null), 'LIFR');
assert.equal(A.flightCategory(10, 499), 'LIFR'); assert.equal(A.flightCategory(10, 900), 'IFR');
assert.equal(A.ceilingFt([['FEW', 300], ['BKN', 2500], ['OVC', 4000]]), 2500); assert.equal(A.ceilingFt([['FEW', 300]]), null); assert.equal(A.ceilingFt([], 2), 200);
// density altitude: sea level, QNH 1013.25, 15 C -> 0; 30 C -> 1800
assert.equal(A.densityAltitude(0, 1013.25, 15), 0); assert.equal(A.densityAltitude(0, 1013.25, 30), 1800); assert.equal(A.densityAltitude(null, 1013, 10), null);
// sun: Greenwich 2026-06-21 sunrise ~03:43 UTC, sunset ~20:21 UTC (NOAA values, 2 min tolerance)
let s = A.sunTimes(new Date(Date.UTC(2026, 5, 21, 12)), 51.4779, 0);
const mins = d => d.getUTCHours() * 60 + d.getUTCMinutes();
near(mins(s.rise), 3 * 60 + 43, 3); near(mins(s.set), 20 * 60 + 21, 3);
assert.equal(A.sunTimes(new Date(Date.UTC(2026, 5, 21)), 80, 0).polar, 'day'); assert.equal(A.sunTimes(new Date(Date.UTC(2026, 11, 21)), 80, 0).polar, 'night');
// runway inference
const now = 1e12, mk = (key, end, dt) => ({key, end, t: now - dt});
assert.equal(A.inferRunwayEnd([mk('a', '26', 1000), mk('b', '26', 2000)], now), null);                       // < 3 samples
assert.equal(A.inferRunwayEnd([mk('a', '26', 1000), mk('b', '26', 2000), mk('c', '26', 3000)], now), '26');
assert.equal(A.inferRunwayEnd([mk('a', '26', 1000), mk('b', '08', 2000), mk('c', '26', 3000), mk('d', '08', 4000)], now), null); // no majority
assert.equal(A.inferRunwayEnd([mk('a', '26', 1000), mk('a', '26', 2000), mk('a', '26', 3000)], now), null);  // same aircraft, same minute
assert.equal(A.endHeading('07', 74), 74); assert.equal(A.endHeading('25', null), 250); assert.equal(A.endHeading('36', null), 360);
// taf slots
const f = [{from: 0, to: 36000, chg: null, vis: '6+', clouds: [['FEW', 3000]]}, {from: 7200, to: 36000, chg: 'BECMG', vis: null, clouds: [['BKN', 800]]}, {from: 3600, to: 5400, chg: 'TEMPO', vis: 1, clouds: []}];
const sl = A.tafSlots(f, 0, 3, 3600 * 2); assert.equal(sl[0].cat, 'VFR'); assert.equal(sl[0].temp, 'IFR'); assert.equal(sl[1].cat, 'IFR');
console.log('airport-calc: all tests passed');
