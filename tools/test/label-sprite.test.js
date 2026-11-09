// node tools/test/label-sprite.test.js
const L = require('../../html/ui/label-sprite.js'), assert = require('assert');
const b = L.build;

// ---- label text builder ----
assert.deepEqual(b({flight: 'BAW123 ', hex: '406abc'}).lines, ['BAW123'], 'callsign only: exactly one line');
assert.equal(b({flight: 'BAW123', hex: '406abc'}).lines.length, 1);
assert.ok(!b({flight: 'BAW123', hex: '406abc', alt: 'FL350', speed: '450'}).lines.some(l => l === ''), 'never an empty line');
assert.equal(b({flight: 'BAW123', logo: true}).logo, true, 'logo flag carries through');
assert.equal(b({flight: 'BAW123'}).logo, false);
// extended: second line only with real data
assert.deepEqual(b({flight: 'BAW123', extended: true, alt: 'FL350', speed: '450'}).lines, ['BAW123', 'FL350 · 450']);
assert.deepEqual(b({flight: 'BAW123', extended: true, alt: 'FL350', speed: null}).lines, ['BAW123', 'FL350'], 'missing speed is dropped, not shown as ?');
assert.deepEqual(b({flight: 'BAW123', extended: true, alt: '?', speed: '?'}).lines, ['BAW123'], 'no data: one line, no trailing newline');
assert.deepEqual(b({flight: 'BAW123', extended: true}).lines, ['BAW123'], 'extended without data stays one line');
assert.deepEqual(b({flight: 'BAW123', extended: true, route: 'EGLL-KJFK', alt: '8,000', speed: '250'}).lines, ['BAW123', 'EGLL-KJFK · 8,000 · 250']);
assert.deepEqual(b({flight: 'BAW123', alt: 'FL350', speed: '450'}).lines, ['BAW123'], 'default mode never shows the second line');
// selected: shows the data line and is flagged for the white pill
const sel = b({flight: 'BAW123', selected: true, alt: 'FL350', speed: '450'});
assert.equal(sel.selected, true); assert.deepEqual(sel.lines, ['BAW123', 'FL350 · 450']);
assert.deepEqual(b({flight: 'BAW123', selected: true}).lines, ['BAW123'], 'selected without data is still one line');
// long callsign: ellipsis at 12 characters
assert.equal(L.ellipsize('ABCDEFGHIJKL'), 'ABCDEFGHIJKL'); assert.equal(L.ellipsize('ABCDEFGHIJKLM'), 'ABCDEFGHIJK…'); assert.equal(L.ellipsize('ABCDEFGHIJKLM').length, 12);
assert.equal(b({flight: 'LONGCALLSIGN12345'}).lines[0], 'LONGCALLSIG…');
// fallback: callsign, then registration, then hex (upper case)
assert.equal(b({flight: '  ', registration: 'G-EUUU', hex: '406abc'}).lines[0], 'G-EUUU');
assert.equal(b({flight: '', registration: '', hex: '406abc'}).lines[0], '406ABC');
assert.equal(b({hex: 'a1b2c3'}).lines[0], 'A1B2C3');
// non-breaking spaces from the formatters are normalised
assert.equal(L.tidy('FL350  450'), 'FL350 450');
assert.deepEqual(L.fromText('BAW123\n\n 450 · FL350\n').lines, ['BAW123', '450 · FL350'], 'legacy text: blank and trailing lines dropped');
assert.deepEqual(L.fromText('').lines, []); assert.deepEqual(L.fromText(null).lines, []);

// ---- metrics ----
const m1 = L.metrics([60], false);
assert.equal(m1.w, 60 + 12, '6 px padding each side'); assert.equal(m1.h, 16 + 8, 'one line: 16 px line + 4 px top and bottom');
const m2 = L.metrics([60, 80], false); assert.equal(m2.h, 2 * 16 + 8); assert.equal(m2.w, 80 + 12, 'widest line sets the width');
const m3 = L.metrics([60], true); assert.equal(m3.w, 60 + 12 + 16 + 6, '16 px chip plus a 6 px gap'); assert.equal(m3.textX, 6 + 16 + 6);
assert.equal(L.metrics([], false).h, 24, 'empty widths still give one line');

// ---- offset: pill centre-left sits right of the icon, 6 px gap + half the rendered icon width ----
// rendered icon width = shape width x (icon scale incl. selected 1.3) x zoom factor
assert.deepEqual(L.pillOffset(20, 1, 0.5), [11, 0], 'small icon at zoom 5: half of 10 px + 6');
assert.deepEqual(L.pillOffset(28, 1, 0.58), [14.12, 0], 'medium icon at zoom 7');
assert.deepEqual(L.pillOffset(36, 1, 0.95), [23.1, 0], 'large icon at zoom 12');
assert.deepEqual(L.pillOffset(28, 1.3, 0.58), [16.56, 0], 'selected scale 1.3');
assert.ok(L.pillOffset(28, 1.3, 0.58)[0] > L.pillOffset(28, 1, 0.58)[0], 'selected icon is larger so the pill moves out');
assert.equal(L.pillOffset(28, 1, 0.58)[1], 0, 'vertically centred: no y offset');
assert.deepEqual(L.pillOffset(20, 1, 0.5, 10), [15, 0], 'custom gap');
const gapOf = (w, s, z) => L.pillOffset(w, s, z)[0] - 0.5 * w * s * z; for (const t of [[20, 1, 0.5], [28, 1.3, 0.95], [36, 1, 1.15]]) assert.ok(Math.abs(gapOf(...t) - 6) < 0.01, 'gap is always 6 px');

// ---- collision priority: selected first, then lowest altitude, then closest to the centre ----
const k = L.sortKey;
assert.ok(k({pinned: true, altFt: 40000, distPx: 900}) < k({altFt: 0, distPx: 0}), 'pinned beats everything');
assert.ok(k({altFt: 1000, distPx: 500}) < k({altFt: 30000, distPx: 1}), 'lower altitude wins over a closer one');
assert.ok(k({altFt: 5000, distPx: 10}) < k({altFt: 5000, distPx: 200}), 'same altitude: closer to the centre wins');
assert.ok(k({altFt: 'ground', distPx: 5}) > k({altFt: 40000, distPx: 5}), 'unknown altitude sorts last');
assert.ok(k({altFt: 0, distPx: 5}) < k({altFt: 100, distPx: 5}));
assert.ok(isFinite(k({})) && k({}) > 0);
const order = [{id: 'hi', altFt: 36000, distPx: 3}, {id: 'sel', pinned: true, altFt: 38000, distPx: 400}, {id: 'lo', altFt: 2000, distPx: 300}, {id: 'mid', altFt: 12000, distPx: 20}, {id: 'mid2', altFt: 12000, distPx: 80}]
    .sort((a, c) => k(a) - k(c)).map(o => o.id);
assert.deepEqual(order, ['sel', 'lo', 'mid', 'mid2', 'hi']);

// ---- sprite ids are stable and distinct per content ----
const sp = (o) => L.spriteId(Object.assign({lines: ['BAW123'], fontPx: 13}, o), 2);
assert.equal(sp({}), sp({})); assert.notEqual(sp({}), sp({selected: true})); assert.notEqual(sp({}), sp({lines: ['BAW124']})); assert.notEqual(sp({}), sp({logoKey: 'BAW'})); assert.notEqual(sp({}), sp({fontPx: 14}));

// ---- style constants from the brief ----
const S = L.STYLE;
assert.equal(S.fill, '#111111'); assert.equal(S.fillAlpha, 0.92); assert.equal(S.border, 'rgba(255,255,255,0.10)'); assert.equal(S.radius, 9);
assert.equal(S.padX, 6); assert.equal(S.padY, 4); assert.equal(S.fontPx, 13); assert.equal(S.fontWeight, 600); assert.equal(S.chip, 16); assert.equal(S.chipGap, 6);
assert.equal(S.text, '#ffffff'); assert.equal(S.selFill, '#ffffff'); assert.equal(S.selText, '#000000'); assert.equal(S.dimAlpha, 0.6);
assert.notEqual(S.fill, '#000000', 'no pure-black pills');
console.log('label-sprite tests ok');
