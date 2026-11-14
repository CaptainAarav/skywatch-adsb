// Schema + value parity with the Python recorder this server replaces: the fixtures were produced by RUNNING that recorder on these inputs
// (see server/test/fixtures/README.md). Every output is compared as parsed JSON.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fx, norm } from './helpers.js';
import { wxPack } from '../src/weather.js';
import { appendSample, buildSample } from '../src/history.js';
import { pyJson, pyRound } from '../src/util.js';
import { Airports, MovementTracker } from '../src/movements.js';
import { AlertState, alertMessage, alertReason, alertsTick, asciiHeader, inQuietHours, validateAlertsConfig } from '../src/alerts.js';

test('wx.json: weather packing matches the Python recorder', () => {
  const i = fx('wx-in.json');
  assert.deepEqual(norm(wxPack(i.metars, i.tafs)), fx('wx-out.json'));
});

for (const n of ['', '2', '3']) {
  test(`history.json sample ${n || '1'}: row and polar bins match the Python recorder`, () => {
    const i = fx(`sample${n}-in.json`), o = fx(`sample${n}-out.json`);
    const r = buildSample(i.aircraft, i.stats, i.now);
    assert.deepEqual(norm(r.sample), o.sample);
    assert.deepEqual(norm(r.bins), o.bins);
  });
}

test('history.json / polar.json: append, retention window and hour merge match the Python recorder', () => {
  const i = fx('append-in.json'), o = fx('append-out.json');
  const r = appendSample(i.hist, i.polar, i.sample, i.bins, i.interval, i.keepSeconds);
  assert.deepEqual(norm(r.hist), o.hist);
  assert.deepEqual(norm(r.polar), o.polar);
  assert.equal(r.hist.fields.join(','), 't,aircraft_with_pos,aircraft_total,messages_per_s,max_range_nm,avg_rssi,positions_per_s');
});

test('movements.json: detection on a scripted scenario matches the Python recorder step by step', () => {
  const i = fx('moves-in.json'), o = fx('moves-out.json');
  const trk = new MovementTracker(new Airports(fx('airports.json').a));
  const got = i.steps.map((s: any) => norm(trk.update(s.aircraft, s.now)));
  assert.deepEqual(got, o.steps);
  const flat = got.flat() as any[];
  assert.ok(flat.some((m) => m.dir === 'landing') && flat.some((m) => m.dir === 'takeoff'), 'the scenario covers landings and take-offs');
  for (const m of flat) assert.deepEqual(Object.keys(m).sort(), ['airport', 'callsign', 'dir', 'reg', 'rwy', 't', 'type']);
});

test('movement detection ignores stale positions, cruisers and unknown airports', () => {
  const trk = new MovementTracker(new Airports(fx('airports.json').a));
  assert.deepEqual(trk.update([{ hex: 'x1', lat: 51.8747, lon: -0.36833, alt_baro: 'ground', seen_pos: 99 }, { hex: 'x2', lat: 10, lon: 10, alt_baro: 'ground' }], 1000), []);
});

test('alerts: reasons match the Python recorder for every rule type', () => {
  const f = fx('alert-reason.json');
  for (const c of f.cases) assert.equal(alertReason(c.ac, f.rules), c.reason, JSON.stringify(c.ac));
});
test('alerts: message text and ASCII headers match', () => {
  for (const c of fx('alert-message.json')) assert.deepEqual(alertMessage(c.ac, c.reason), c.out);
  for (const c of fx('ascii-header.json')) assert.equal(asciiHeader(c.in), c.out);
});
test('alerts: dedupe, hourly limit and quiet hours match', () => {
  const f = fx('alert-due.json'), st = new AlertState();
  for (const s of f.seq) { const d = st.due(f.cfg, s.hex, s.reason, s.now); assert.equal(d, s.due, JSON.stringify(s)); if (d) st.mark(s.hex, s.reason, s.now); }
  for (const c of fx('quiet-hours.json')) assert.equal(inQuietHours(c.q ? { quiet_hours: c.q } : {}, c.now), c.out, JSON.stringify(c));
});
test('alerts: one tick sends exactly what the Python recorder sent (and dedupes the next ticks)', async () => {
  const f = fx('alert-tick.json'), st = new AlertState(), sent: any[] = [];
  for (const t of f.ticks) assert.deepEqual(await alertsTick(f.cfg, st, f.aircraft, t.now, async (_c, title, body, prio) => { sent.push([title, body, prio]); }), t.out);
  assert.deepEqual(sent, f.sent);
});
test('alerts: config validity matches', () => { for (const c of fx('alert-config.json')) assert.equal(validateAlertsConfig(c.cfg) !== null, c.on, JSON.stringify(c.cfg)); });

test('python-compatible helpers: round half to even and ensure_ascii', () => {
  assert.equal(pyRound(0.25, 1), 0.2); assert.equal(pyRound(0.35, 1), 0.3); assert.equal(pyRound(2.5, 0), 2); assert.equal(pyRound(3.5, 0), 4); assert.equal(pyRound(12.34, 1), 12.3);
  assert.equal(pyJson({ a: 'café', b: [1, null] }), '{"a":"caf\\u00e9","b":[1,null]}');
});
