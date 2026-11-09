// node tools/test/airport-tiers.test.js
const T = require('../../html/ui/airport-tiers.js'), assert = require('assert');
// row = [icao, iata, typeIdx, name, lat, lon, elev, country, region, city, wiki, runways, freqs, scheduled]
const row = (type, rwys, sched, o) => Object.assign(['XXXX', '', type, 'Test Airport', 0, 0, 0, 'GB', 'GB-ENG', '', '', rwys || [], [], sched ? 1 : 0], o || {});
const rw = (ft, surf) => ['09', '27', ft, 100, surf, 1, 90, 270, null, null, null, null];

// ---- tier by type ----
assert.equal(T.tierOf(row(0)), 'large'); assert.equal(T.tierOf(row(1)), 'medium');
assert.equal(T.tierOf(row(3)), 'water'); assert.equal(T.tierOf(row(4)), 'water');
// small airports: paved 800 m or more, or scheduled service -> regional; anything else is a field
assert.equal(T.tierOf(row(2, [rw(2625, 'ASP')])), 'regional', '800 m paved is exactly enough');
assert.equal(T.tierOf(row(2, [rw(2624, 'ASP')])), 'field', 'one foot short');
assert.equal(T.tierOf(row(2, [rw(5000, 'GRS')])), 'field', 'long grass strip is still a field');
assert.equal(T.tierOf(row(2, [rw(4160, 'Concrete'), rw(2201, 'Grass')])), 'regional', 'one paved runway is enough');
assert.equal(T.tierOf(row(2, [rw(3000, 'ASPH-G')])), 'regional', 'condition suffix ignored');
assert.equal(T.tierOf(row(2, [rw(3000, '')])), 'field', 'blank surface is not assumed paved');
assert.equal(T.tierOf(row(2, [rw(3000, 'UNK')])), 'field');
assert.equal(T.tierOf(row(2, [], true)), 'regional', 'scheduled service alone is enough');
assert.equal(T.tierOf(row(2, [rw(900, 'GRVL')], true)), 'regional');
assert.equal(T.tierOf(row(2, [])), 'field');
assert.equal(T.tierOf(row(2, null)), 'field', 'missing runway list');
assert.ok(T.isPaved('ASP') && T.isPaved('Concrete') && T.isPaved('CON-G') && T.isPaved('PEM') && T.isPaved('asphalt') && T.isPaved('PER'));
assert.ok(!T.isPaved('GRS') && !T.isPaved('Grassed brown clay') && !T.isPaved('GRVL-F') && !T.isPaved('Dirt') && !T.isPaved(null) && !T.isPaved('WATER'));

// ---- minimum zooms (desktop, Normal) ----
const z = (t, o) => T.minZooms(row(t), o);
assert.deepEqual(z(0), {tier: 'large', dot: 3.5, code: 5, name: 8});
assert.deepEqual(z(1), {tier: 'medium', dot: 5.5, code: 7, name: 9.5});
assert.deepEqual(T.minZooms(row(2, [rw(5000, 'ASP')])), {tier: 'regional', dot: 8, code: 9, name: 10.5});
assert.deepEqual(T.minZooms(row(2, [])), {tier: 'field', dot: 10, code: 11, name: 12.5});
assert.equal(z(3).dot, 11.5);
// phones are 0.5 lower
assert.deepEqual(z(0, {phone: true}), {tier: 'large', dot: 3, code: 4.5, name: 7.5});
assert.equal(z(1, {phone: true}).dot, 5);
// density shifts every tier: Fewer +1.5, Normal 0, More -1.5, and they stack with the phone shift
assert.equal(z(0, {density: 'fewer'}).dot, 5); assert.equal(z(0, {density: 'normal'}).dot, 3.5); assert.equal(z(0, {density: 'more'}).dot, 2);
assert.equal(z(1, {density: 'fewer', phone: true}).code, 8); assert.equal(z(1, {density: 'more', phone: true}).name, 7.5);
assert.equal(z(0, {density: 'more', phone: true}).dot, 1.5);
assert.ok(z(0, {density: 'more', phone: true}).dot >= 0, 'never below zoom 0');
assert.equal(T.densityFrom('bogus'), 'normal'); assert.equal(T.densityFrom('fewer'), 'fewer'); assert.equal(T.densityFrom(null), 'normal');
// per-tier zoom range (what the layers use)
assert.deepEqual(T.tierZooms('regional', {}), {dot: 8, code: 9, name: 10.5}); assert.deepEqual(T.tierZooms('regional', {phone: true, density: 'more'}), {dot: 6, code: 7, name: 8.5});
// tiers are ordered by zoom at every density
for (const d of ['fewer', 'normal', 'more']) for (const ph of [false, true]) {
  const dots = T.ORDER.map(t => T.tierZooms(t, {density: d, phone: ph}).dot);
  assert.deepEqual(dots.slice().sort((a, b) => a - b), dots, 'dots appear large first: ' + d + ph);
  for (const t of T.ORDER) { const q = T.tierZooms(t, {density: d, phone: ph}); assert.ok(q.dot <= q.code && q.code <= q.name, t); }
}

// ---- importance: type, then runway length, then scheduled service ----
const k = T.sortKey;
assert.ok(k(row(0, [rw(3000, 'ASP')])) < k(row(1, [rw(12000, 'ASP')])), 'type first');
assert.ok(k(row(1, [rw(9000, 'ASP')])) < k(row(1, [rw(5000, 'ASP')])), 'then longer runway');
assert.ok(k(row(1, [rw(5000, 'ASP')], true)) < k(row(1, [rw(5000, 'ASP')], false)), 'then scheduled service');
assert.ok(k(row(1, [rw(5000, 'ASP')], false)) < k(row(1, [rw(4999, 'ASP')], true)), 'length beats scheduled');
assert.ok(k(row(2)) < k(row(3)) && k(row(3)) < k(row(4)));
assert.ok(isFinite(k(row(2, null))));

// ---- label text ----
assert.equal(T.code(Object.assign(row(0), {0: 'EGLL', 1: 'LHR'})), 'LHR'); assert.equal(T.code(Object.assign(row(2), {0: 'EGTC', 1: ''})), 'EGTC', 'ICAO when there is no IATA');
assert.equal(T.nameText(Object.assign(row(0), {0: 'EGLL', 1: 'LHR', 3: 'London Heathrow Airport'})), 'LHR  London Heathrow');
assert.equal(T.nameText(Object.assign(row(1), {0: 'EGTC', 1: '', 3: 'Cranfield Airport'})), 'EGTC  Cranfield');
assert.equal(T.nameText(Object.assign(row(0), {0: 'LFPG', 1: 'CDG', 3: 'Charles de Gaulle International Airport'})), 'CDG  Charles de Gaulle');
console.log('airport-tiers tests ok');
