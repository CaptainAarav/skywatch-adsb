import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveUpstream } from '../src/proxy.js';
import { close, fakeReadsb, rawGet, startApp } from './helpers.js';

const ALLOWED = [
  '/data/receiver.json', '/data/aircraft.json', '/data/outline.json', '/data/multiOutline.json', '/data/aircraft.binCraft', '/data/aircraft.binCraft.zst', '/data/history_0.json', '/data/history_119.json',
  '/data/globe_0000.json', '/data/globe0001.binCraft', '/data/globeMil_42777.binCraft.zst', '/data/traces/ab/trace_recent_abc123.json', '/data/traces/ab/trace_full_~abc123.json',
  '/chunks/chunks.json', '/chunks/pf.json', '/chunks/978.json', '/chunks/chunk_1700000000.gz', '/globe_history/2026/11/13/heatmap/05.bin.ttf', '/globe_history/2026/11/13/traces/ab/trace_full_abc123.json',
  '/globeRates.json', '/version.json', '/graphs1090/', '/graphs1090/graphs/dump1090-localhost-aircraft-24h.png', '/db2/4.js', '/db2/icao_aircraft_types2.js', '/re-api/',
];
const DENIED = [
  '/', '/etc/passwd', '/data/', '/data/secret.json', '/data/aircraft.json/', '/data/aircraft.jsonx', '/data/stats.json', '/data/../etc/passwd', '/data/%2e%2e/etc/passwd', '/data/%2E%2E%2Fetc/passwd',
  '/data/aircraft.json%00', '/data/aircraft.json%2f..%2f..%2fx', '//evil.example/data/aircraft.json', '/data//aircraft.json', '/chunks/../x', '/chunks/a/b', '/chunks/%2e%2e', '/globe_history/../../etc/passwd',
  '/globe_history/2026/11/13/heatmap/../../../x', '/globe_history/skywatch/wx.json.bak', '/data\\aircraft.json', '/http://evil.example/', '/db2/../x.js', '/db2/a/b.js', '/db2/x.php', '/graphs1090/../x',
  '/data/traces/zz/trace_full_abc123.json', '/data/traces/ab/trace_full_abc12.json', '/.env', '/data/history_.json', '/re-api', '/re-api/x', '/graphs1090/graphs/a/b.png',
];

test('allowed paths resolve to themselves (no rewriting)', () => {
  for (const p of ALLOWED.filter((x) => !x.startsWith('/db2/'))) assert.deepEqual(resolveUpstream(p, ''), { candidates: [p] }, p);
});
test('the aircraft database is tried as db2/ first, then the versioned folder from the upstream version.json', () => {
  assert.deepEqual(resolveUpstream('/db2/4.js', '', '3.14.1725'), { candidates: ['/db2/4.js', '/db-3.14.1725/4.js'] });
  assert.deepEqual(resolveUpstream('/db2/4.js', '', '../x'), { candidates: ['/db2/4.js'] }, 'a hostile version string is never used');
});
test('everything else is refused, including traversal in every encoding', () => {
  for (const p of DENIED) assert.equal(resolveUpstream(p, ''), null, p);
});
test('query strings: dropped on data files, restricted to safe characters for the readsb API', () => {
  assert.deepEqual(resolveUpstream('/re-api/', '?json&box=50,53,-3,1'), { candidates: ['/re-api/?json&box=50,53,-3,1'] });
  assert.equal(resolveUpstream('/re-api/', '?json&x=http://evil'), null);
  assert.equal(resolveUpstream('/re-api/', '?' + 'a'.repeat(600)), null);
  assert.deepEqual(resolveUpstream('/data/aircraft.json', '?_=123'), { candidates: ['/data/aircraft.json'] });
});

test('no user-supplied URL can reach the proxy: absolute URLs and Host tricks only ever hit the configured upstream', async () => {
  const up = await fakeReadsb();
  const app = await startApp({ READSB_URL: up.url });
  try {
    for (const p of ['http://evil.example/data/aircraft.json', '/http://evil.example/', '//evil.example/data/aircraft.json', '/data/aircraft.json?url=http://evil.example', '/data/aircraft.json?host=evil.example']) await rawGet(app.base, p);
    assert.ok(up.hits.every((h) => h.startsWith('/data/aircraft.json')), 'upstream saw ' + JSON.stringify(up.hits));
    assert.ok(!up.hits.some((h) => h.includes('evil')), 'the query is never forwarded');
  } finally { await close(app.server); await close(up.server); }
});

test('the live proxy forwards allowed paths and nothing else', async () => {
  const up = await fakeReadsb();
  const app = await startApp({ READSB_URL: up.url });
  try {
    const ok = await rawGet(app.base, '/data/aircraft.json?_=1');
    assert.equal(ok.status, 200);
    assert.equal(JSON.parse(ok.body).aircraft.length, 2);
    assert.equal(ok.headers['set-cookie'], undefined, 'upstream cookies are not passed on');
    assert.equal(ok.headers['x-powered-by'], undefined, 'upstream headers other than the content ones are not passed on');
    const db = await rawGet(app.base, '/db2/4.js');
    assert.equal(db.status, 200); assert.equal(db.body, 'db-ok', 'db2/ maps to the versioned folder');
    for (const p of ['/secret.txt', '/data/secret.json', '/data/%2e%2e/secret.txt', '/data/../secret.txt']) {
      const r = await rawGet(app.base, p);
      assert.notEqual(r.status, 200, p); assert.ok(!r.body.includes('must never'), p);
    }
    assert.ok(!up.hits.includes('/secret.txt') && !up.hits.includes('/data/secret.json'), 'denied paths never reach the upstream: ' + JSON.stringify(up.hits));
    const head = await rawGet(app.base, '/data/receiver.json', 'HEAD');
    assert.equal(head.status, 200); assert.equal(head.body, '');
  } finally { await close(app.server); await close(up.server); }
});

test('POST, PUT, DELETE and friends are refused', async () => {
  const up = await fakeReadsb();
  const app = await startApp({ READSB_URL: up.url });
  try { for (const m of ['POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS']) assert.equal((await rawGet(app.base, '/data/aircraft.json', m)).status, 405, m); }
  finally { await close(app.server); await close(up.server); }
});
