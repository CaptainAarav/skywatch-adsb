// The restored airport marker must keep every layout/paint/sprite value of the commit it was restored from (fixtures/old-airport-pin.json).
// Only the zoom range and the tier filter may differ, and those are not part of AIRPIN.
const assert = require('assert');
const AIRPIN = require('../../html/ui/airport-pin-style.js');
const old = require('./fixtures/old-airport-pin.json');
const gs = 1.25, lay = AIRPIN.layout(['Font'], gs, 'X');
for (const [k, v] of Object.entries(old.layout)) {
  const got = lay[k];
  if (k === 'text-size') assert.strictEqual(got, 11 * gs, 'text-size scales as 11 * globalScale');
  else if (k === 'icon-size' || k === 'icon-padding') {
    // far-zoom change (Phase 40): a linear ramp that is SMALLER at far zoom and equals the restored value from zoom FAR.full on
    const ev = (expr, z) => { const [, , , z0, a, z1, b] = expr; return z <= z0 ? a : z >= z1 ? b : a + (b - a) * (z - z0) / (z1 - z0); };
    assert.strictEqual(got[0], 'interpolate'); assert.deepStrictEqual(got[2], ['zoom']);
    for (const z of [AIRPIN.FAR.full, 9, 10, 12, 16, 22]) assert.strictEqual(ev(got, z), v, k + ' at zoom ' + z + ' is the restored value ' + v);
    let prev = -1; for (const z of [3.5, 4, 5, 6, 7, 8]) { const x = ev(got, z); assert.ok(x >= prev, k + ' grows with zoom'); prev = x; }
    assert.ok(ev(got, 3.5) < v && ev(got, 5) < v, k + ' is smaller at far zoom');
  }
  else assert.deepStrictEqual(got, v, 'layout ' + k);
}
assert.deepStrictEqual(AIRPIN.PAINT, old.paint, 'paint');
for (const [k, v] of Object.entries(old.sprite)) assert.strictEqual(AIRPIN.SPRITE[k], v, 'sprite ' + k);
assert.deepStrictEqual(AIRPIN.CAT_COLOR, old.ringColours, 'ring colours');
assert.ok(String(lay['icon-image'][1]).startsWith(old.imagePrefix));
// name line: code at .95, newline, name at .85 in #aaaaaa
const tf = AIRPIN.textField(3.5, 8);
assert.strictEqual(tf[0], 'step'); const f = tf[4];
assert.strictEqual(f[0], 'format'); assert.deepStrictEqual(f[2], {'font-scale': old.nameLine.codeScale}); assert.strictEqual(f[3], old.nameLine.separator);
assert.deepStrictEqual(f[5][0] === 'get' ? f[6] : f[5], {'font-scale': old.nameLine.nameScale, 'text-color': old.nameLine.nameColor});
assert.deepStrictEqual(tf[2], ['get', 'c'], 'below the detail zoom the label is the code only');
// image ids: flag, category or neutral, never an invalid id
assert.strictEqual(AIRPIN.imageId('GB', 'VFR'), 'flagc-GB-VFR');
assert.strictEqual(AIRPIN.imageId('GB'), 'flagc-GB-N');
assert.strictEqual(AIRPIN.imageId('', 'IFR'), 'flagc-XX-IFR');
assert.ok(AIRPIN.ID_RE.test('flagc-FR-LIFR') && !AIRPIN.ID_RE.test('flagc-FR-'));
console.log('airport-pin-style tests ok');
