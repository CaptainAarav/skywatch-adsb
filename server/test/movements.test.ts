// Behavioural tests ported from the Python recorder's own tests (tools/test/test_recorder_movements.py and test_recorder_alerts.py), so nothing they
// covered is lost when the Python recorder is removed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Airports, MovementTracker, inferRunway, type Movement } from '../src/movements.js';
import { AlertState, alertMessage, alertReason, alertsTick, inQuietHours, makeNtfySender, type AlertConfig, type Rule } from '../src/alerts.js';

const LAT = 51.0, LON = 0.0;
const rows = (): unknown[][] => [['TEST', 'TST', 0, 'Test Airport', LAT, LON, 100, 'GB', '', 'Testville', '', [['09', '27', 8000, 150, 'ASP', 1]], []],
  ['FARX', '', 2, 'Far Field', 52.0, 1.0, 50, 'GB', '', 'Elsewhere', '', [['18', '36', 3000, 30, 'ASP', 0]], []]];
const east = (n: number): number => LON + n / (60 * Math.cos((LAT * Math.PI) / 180));
const ac = (hexid: string, eastNm: number, alt: number | string, gs: number, trk: number, rate = 0, kw: Record<string, unknown> = {}): Record<string, any> =>
  ({ hex: hexid, flight: 'TST' + hexid.slice(-2), r: 'G-' + hexid.slice(0, 4).toUpperCase(), t: 'A320', lat: LAT, lon: east(eastNm), alt_baro: alt, gs, track: trk, baro_rate: rate, seen: 1, ...kw });
const run = (tr: MovementTracker, frames: Array<Array<Record<string, any>>>, dt = 10): { out: Movement[]; t: number } => {
  const out: Movement[] = []; let t = 1_700_000_000;
  for (const f of frames) { out.push(...tr.update(f, t)); t += dt; }
  return { out, t };
};
const kinds = (o: Movement[]): string[] => o.map((m) => `${m.dir}/${m.rwy}/${m.airport}`);

test('airport lookup and runway inference', () => {
  const ap = new Airports(rows());
  assert.equal(ap.near(LAT, east(1))?.icao, 'TEST'); assert.equal(ap.near(LAT, east(5)), null);
  const a = ap.near(LAT, east(1))!;
  assert.equal(inferRunway(a, 92), '09'); assert.equal(inferRunway(a, 268), '27'); assert.equal(inferRunway(a, 180), null);
});
test('1. landing seen to touch down', () => {
  const tr = new MovementTracker(new Airports(rows()));
  const { out } = run(tr, [[ac('aaa111', -2.8, 1000, 140, 90, -700)], [ac('aaa111', -1.5, 600, 135, 90, -700)], [ac('aaa111', -0.2, 150, 130, 90, -600)], [ac('aaa111', 0.5, 'ground', 90, 90)]]);
  assert.deepEqual(kinds(out), ['landing/09/TEST']);
});
test('2. landing lost low near the runway needs LOST_S of silence', () => {
  const tr = new MovementTracker(new Airports(rows()));
  const { out, t } = run(tr, [[ac('bbb222', -2.5, 900, 140, 270, -700, { lon: east(2.5) })], [ac('bbb222', 2.0, 400, 130, 270, -700)]]);
  assert.deepEqual(out, []);
  assert.deepEqual(tr.update([], t + 100).map((m) => m.dir), ['landing']);
});
test('3. take-off from the ground', () => {
  const tr = new MovementTracker(new Airports(rows()));
  const { out } = run(tr, [[ac('ccc333', -1.0, 'ground', 5, 90)], [ac('ccc333', 0.0, 'ground', 120, 90)], [ac('ccc333', 1.2, 700, 160, 90, 2000)]]);
  assert.deepEqual(out.map((m) => `${m.dir}/${m.rwy}`), ['takeoff/09']);
});
test('4. take-off first seen low and climbing', () => {
  const tr = new MovementTracker(new Airports(rows()));
  assert.deepEqual(run(tr, [[ac('ddd444', 1.5, 900, 170, 90, 2200)], [ac('ddd444', 3.5, 2500, 190, 90, 2000)]]).out.map((m) => m.dir), ['takeoff']);
});
test('5. a go-around that stays tracked or leaves coverage high is not a landing', () => {
  const tr = new MovementTracker(new Airports(rows()));
  const { out, t } = run(tr, [[ac('eee555', -2.0, 900, 140, 90, -700)], [ac('eee555', -0.5, 400, 135, 90, -600)], [ac('eee555', 1.0, 700, 150, 90, 1500)], [ac('eee555', 2.5, 2200, 170, 90, 2500)]]);
  assert.deepEqual(out, []); assert.deepEqual(tr.update([], t + 100), []); assert.deepEqual(tr.update([], t + 200), []);
});
test('6. overflights and a level fast low pass are not movements', () => {
  const tr = new MovementTracker(new Airports(rows()));
  const { out, t } = run(tr, [[ac('fff666', -3, 2500, 250, 90)], [ac('fff666', 0, 2500, 250, 90)], [ac('fff666', 3, 2500, 250, 90)], [ac('ggg777', -2, 800, 250, 90, 0)], [ac('ggg777', 0, 800, 250, 90, 0)], [ac('ggg777', 2, 800, 250, 90, 0)]]);
  assert.deepEqual(out, []); assert.deepEqual(tr.update([], t + 120), []);
});
test('7. taxiing then silence is nothing', () => {
  const tr = new MovementTracker(new Airports(rows()));
  const { out, t } = run(tr, [[ac('hhh888', 0.2, 'ground', 12, 180)], [ac('hhh888', 0.2, 'ground', 0, 180)]]);
  assert.deepEqual(out, []); assert.deepEqual(tr.update([], t + 200), []);
});
test('8/9. dedupe within 20 minutes, stale positions and far airports ignored, entries carry no position or distance', () => {
  const ap = new Airports(rows()), tr = new MovementTracker(ap);
  const a = [ac('iii999', -1, 300, 130, 90, -600)], g = [ac('iii999', 0.3, 'ground', 80, 90)];
  const { out, t } = run(tr, [a, g]); assert.equal(out.length, 1);
  (tr as any).st.clear();
  assert.deepEqual([...tr.update(a, t + 10), ...tr.update(g, t + 20)], []);
  assert.deepEqual(new MovementTracker(ap).update([ac('jjj000', -1, 'ground', 0, 90, 0, { seen_pos: 99 })], 1_700_000_000), []);
  const far = ac('kkk111', 0, 300, 100, 90); far.lat = 53.5;
  assert.deepEqual(new MovementTracker(ap).update([far], 1), []);
  assert.deepEqual(Object.keys(out[0]!).sort(), ['airport', 'callsign', 'dir', 'reg', 'rwy', 't', 'type']);
});

const RULES: Rule[] = [{ type: 'emergency' }, { type: 'type', value: 'a388' }, { type: 'military' }, { type: 'callsign_prefix', value: 'rrr' }, { type: 'reg', value: 'g-ABCD' }, { type: 'hex', value: '43C123' }];
const cfg: AlertConfig = { enabled: true, ntfy: { url: 'https://ntfy.example', topic: 'secret-topic' }, rules: RULES, dedupe_minutes: 30, max_per_hour: 3 };
test('alert rules (the Python recorder\'s own cases)', () => {
  assert.ok(alertReason({ hex: 'abc', squawk: '7700' }, RULES)!.startsWith('emergency squawk 7700'));
  assert.equal(alertReason({ hex: 'abc', squawk: '1200', t: 'A388' }, RULES), 'type A388');
  assert.equal(alertReason({ hex: 'abc', dbFlags: 1 }, RULES), 'military aircraft');
  assert.equal(alertReason({ hex: 'abc', flight: 'RRR1234 ' }, RULES), 'callsign RRR*');
  assert.equal(alertReason({ hex: 'abc', r: 'G-ABCD' }, RULES), 'registration G-ABCD');
  assert.equal(alertReason({ hex: '43c123' }, RULES), 'hex 43C123');
  assert.equal(alertReason({ hex: 'abc', squawk: '1200', t: 'A320', flight: 'BAW1' }, RULES), null);
  assert.equal(alertReason({ hex: 'abc', dbFlags: 2 }, [{ type: 'interesting' }]), 'interesting aircraft');
  assert.equal(alertReason({ hex: 'abc', dbFlags: 2 }, [{ type: 'hex', value: '' }]), null);
});
test('the message never carries position or distance', () => {
  const [t, b] = alertMessage({ hex: 'abc', flight: 'BAW1', r: 'G-X', t: 'A320', alt_baro: 12000, lat: 52.0, lon: -0.7, r_dst: 12.3 }, 'type A320');
  assert.equal(t, 'BAW1: type A320'); assert.equal(b, 'BAW1 | G-X A320 | 12000 ft');
  assert.ok(!b.includes('52.0') && !b.includes('12.3') && !b.includes('nm'));
});
test('dedupe, hourly cap, window roll, failing sender back-off, quiet hours', async () => {
  const sent: Array<[string, string, number]> = [];
  const send = async (_c: AlertConfig, title: string, body: string, pr: number): Promise<void> => { sent.push([title, body, pr]); };
  const st = new AlertState(), T0 = 1_700_000_000;
  const ac7700 = { hex: 'aaa111', flight: 'EMG1', squawk: '7700', alt_baro: 5000 }, acA388 = { hex: 'bbb222', flight: 'UAE9', t: 'A388', alt_baro: 'ground' };
  assert.equal((await alertsTick(cfg, st, [ac7700, acA388], T0, send)).length, 2);
  assert.equal(sent[0]![2], 5); assert.equal(sent[1]![2], 3); assert.ok(sent[1]![1].includes('on the ground'));
  assert.deepEqual(await alertsTick(cfg, st, [ac7700], T0 + 600, send), []);
  assert.equal((await alertsTick(cfg, st, [ac7700], T0 + 31 * 60, send)).length, 1);
  assert.deepEqual(await alertsTick(cfg, st, [{ hex: 'ccc333', squawk: '7600' }], T0 + 32 * 60, send), []);
  assert.equal((await alertsTick(cfg, st, [{ hex: 'ccc333', squawk: '7600' }], T0 + 3700, send)).length, 1);
  const boom = async (): Promise<void> => { throw new Error('down'); };
  const st2 = new AlertState();
  assert.deepEqual(await alertsTick(cfg, st2, [ac7700], T0, boom), []);
  assert.deepEqual(await alertsTick(cfg, st2, [ac7700], T0 + 30, boom), []);
  assert.equal((await alertsTick(cfg, st2, [ac7700], T0 + 150, send)).length, 1);
  const q: AlertConfig = { ...cfg, quiet_hours: { start: '23:00', end: '07:00', tz: 'UTC' } }, day = T0 - (T0 % 86400);
  assert.ok(inQuietHours(q, day + 23 * 3600 + 60)); assert.ok(inQuietHours(q, day + 3 * 3600)); assert.ok(!inQuietHours(q, day + 12 * 3600));
  const st3 = new AlertState();
  assert.deepEqual(await alertsTick(q, st3, [ac7700], day + 2 * 3600, send), []);
  assert.equal((await alertsTick(q, st3, [ac7700], day + 12 * 3600, send)).length, 1);
  assert.ok(!inQuietHours({ quiet_hours: { start: 'x', end: 'y' } }, T0));
});
test('ntfy request shape and header hygiene: topic URL, ASCII title, bearer token only when configured, status-only errors', async () => {
  const seen: any = {};
  const fake = (async (url: string, init: any) => { Object.assign(seen, { url, init }); return { ok: true, status: 200 }; }) as unknown as typeof fetch;
  await makeNtfySender(null, fake)(cfg, 'Tést', 'body', 4);
  assert.equal(seen.url, 'https://ntfy.example/secret-topic'); assert.equal(seen.init.body, 'body'); assert.equal(seen.init.method, 'POST');
  assert.ok(seen.init.headers['User-Agent'].startsWith('skywatch-adsb-server/')); assert.equal(seen.init.headers.Title, 'T?st'); assert.equal(seen.init.headers.Priority, '4');
  assert.equal(seen.init.headers.Authorization, undefined);
  await makeNtfySender('tk', fake)(cfg, 'T', 'b', 3); assert.equal(seen.init.headers.Authorization, 'Bearer tk');
  const bad = (async () => ({ ok: false, status: 500 })) as unknown as typeof fetch;
  await assert.rejects(makeNtfySender('tk', bad)(cfg, 'T', 'b', 3), (e: Error) => e.message === 'ntfy HTTP 500' && !e.message.includes('tk') && !e.message.includes('secret-topic'));
});
