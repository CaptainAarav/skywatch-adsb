// Integration: the server on a random port against a fake local readsb; the front-end data fetched THROUGH the server; the recorders writing files the UI reads.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as http from 'node:http';
import * as path from 'node:path';
import { close, fakeReadsb, listen, makeConfig, rawGet, startApp, tmpdir } from './helpers.js';
import { historyLoop, movementsLoop, outDir } from '../src/recorder.js';
import { loadAlertsConfig } from '../src/alerts.js';
import { atomicWrite } from '../src/util.js';
import { RateLimiter } from '../src/ratelimit.js';
import { parseUpstream } from '../src/config.js';

const waitFor = async (f: () => boolean, ms = 8000): Promise<void> => { const t = Date.now(); while (!f()) { if (Date.now() - t > ms) throw new Error('timed out'); await new Promise((r) => setTimeout(r, 50)); } };

test('front-end data through the server: receiver.json, aircraft.json, health, static page', async () => {
  const up = await fakeReadsb();
  const app = await startApp({ READSB_URL: up.url });
  try {
    const rec = JSON.parse((await rawGet(app.base, '/data/receiver.json')).body); assert.equal(rec.readsb, true);
    const ac = JSON.parse((await rawGet(app.base, '/data/aircraft.json')).body); assert.equal(ac.aircraft[0].hex, 'abc123');
    const health = JSON.parse((await rawGet(app.base, '/api/health')).body);
    assert.deepEqual(Object.keys(health).sort(), ['ok', 'publicDemo', 'upstream', 'version']);
    assert.ok(!JSON.stringify(health).includes('127.0.0.1'), 'health never reveals the upstream address');
    assert.equal((await rawGet(app.base, '/')).status, 200);
  } finally { await close(app.server); await close(up.server); }
});

test('recorders write the files the UI reads, at the URLs the UI requests', async () => {
  const up = await fakeReadsb();
  const rows = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'test', 'fixtures', 'airports.json'), 'utf8'));
  const staticDir = tmpdir(); fs.mkdirSync(path.join(staticDir, 'airport-db')); fs.writeFileSync(path.join(staticDir, 'airport-db', 'airports.json'), JSON.stringify(rows)); fs.writeFileSync(path.join(staticDir, 'index.html'), 'x');
  const app = await startApp({ READSB_URL: up.url, STATIC_DIR: staticDir, WEATHER: '0' });
  const ac = new AbortController();
  try {
    const done = [historyLoop(app.cfg, ac.signal), movementsLoop(app.cfg, ac.signal)];
    await waitFor(() => fs.existsSync(path.join(outDir(app.cfg), 'history.json')) && fs.existsSync(path.join(outDir(app.cfg), 'movements.json')) && fs.existsSync(path.join(outDir(app.cfg), 'polar.json')));
    ac.abort(); await Promise.all(done);
    const hist = JSON.parse((await rawGet(app.base, '/globe_history/skywatch/history.json')).body);
    assert.equal(hist.v, 1); assert.deepEqual(hist.fields, ['t', 'aircraft_with_pos', 'aircraft_total', 'messages_per_s', 'max_range_nm', 'avg_rssi', 'positions_per_s']);
    assert.equal(hist.samples[0][1], 2); assert.equal(hist.samples[0][2], 2); assert.equal(hist.samples[0][3], 10);
    const polar = JSON.parse((await rawGet(app.base, '/globe_history/skywatch/polar.json')).body); assert.equal(polar.bins, 36);
    const mv = JSON.parse((await rawGet(app.base, '/globe_history/skywatch/movements.json')).body); assert.equal(mv.v, 1); assert.deepEqual(mv.movements, []); assert.equal(mv.note, 'Inferred from receiver data');
    for (const name of ['history.json', 'polar.json', 'movements.json']) assert.ok(!/51\.\d{3,}|-1\.0\d/.test(fs.readFileSync(path.join(outDir(app.cfg), name), 'utf8')) || name === 'history.json', name + ' carries no coordinates');
    assert.ok(!fs.readdirSync(outDir(app.cfg)).some((f) => f.endsWith('.tmp')), 'no temp files left behind');
  } finally { ac.abort(); await close(app.server); await close(up.server); }
});

test('a missing recorder file is a plain 404 (the UI then shows its "no data" state), never an error page with details', async () => {
  const app = await startApp({});
  try { for (const n of ['wx', 'movements', 'history', 'polar']) { const r = await rawGet(app.base, `/globe_history/skywatch/${n}.json`); assert.equal(r.status, 404); assert.equal(r.body, 'Not found\n'); } }
  finally { await close(app.server); }
});

test('static-only mode (no READSB_URL): the site is served, no data is proxied, recorders do nothing', async () => {
  const app = await startApp({});
  try {
    assert.equal(app.cfg.readsbUrl, null);
    assert.equal((await rawGet(app.base, '/')).status, 200);
    assert.equal((await rawGet(app.base, '/data/aircraft.json')).status, 404);
    assert.equal(JSON.parse((await rawGet(app.base, '/api/health')).body).upstream, false);
  } finally { await close(app.server); }
});

test('alerts are OFF by default and only turn on when skywatch-alerts.json exists', async () => {
  const dir = tmpdir();
  const file = path.join(dir, 'skywatch-alerts.json');
  assert.equal(await loadAlertsConfig(file, false), null, 'no file: off');
  fs.writeFileSync(file, JSON.stringify({ enabled: false, ntfy: { topic: 't' } })); assert.equal(await loadAlertsConfig(file, false), null, 'enabled:false: off');
  fs.writeFileSync(file, '{not json'); assert.equal(await loadAlertsConfig(file, false), null, 'unreadable: off');
  fs.writeFileSync(file, JSON.stringify({ ntfy: { topic: '' } })); assert.equal(await loadAlertsConfig(file, false), null, 'no topic: off');
  fs.writeFileSync(file, JSON.stringify({ ntfy: { topic: 'my-topic' }, rules: [{ type: 'emergency' }] }));
  assert.notEqual(await loadAlertsConfig(file, false), null, 'valid file: on');
  assert.equal(makeConfig({ DATA_DIR: dir }).alertsFile, file, 'the default location is DATA_DIR/skywatch-alerts.json');
});

test('an emergency in the feed sends a notification to the configured ntfy only when alerts are configured; never in publicDemo', async () => {
  const posts: Array<{ url: string; body: string; headers: http.IncomingHttpHeaders }> = [];
  const ntfy = http.createServer((req, res) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => { posts.push({ url: req.url ?? '', body: b, headers: req.headers }); res.writeHead(200); res.end('{}'); }); });
  const ntfyPort = await listen(ntfy);
  const feed = JSON.stringify({ now: 1, aircraft: [{ hex: 'abc123', flight: 'EMG1', squawk: '7700', alt_baro: 5000, lat: 51.6, lon: -1.1 }] });
  const up = await fakeReadsb({ '/data/aircraft.json': feed });
  try {
    for (const scenario of ['no-file', 'public-demo', 'configured']) {
      posts.length = 0;
      const dir = tmpdir();
      if (scenario !== 'no-file') fs.writeFileSync(path.join(dir, 'skywatch-alerts.json'), JSON.stringify({ ntfy: { topic: 'tp', url: `http://127.0.0.1:${ntfyPort}` }, rules: [{ type: 'emergency' }] }));
      const cfg = makeConfig({ READSB_URL: up.url, DATA_DIR: dir, PUBLIC_DEMO: scenario === 'public-demo' ? '1' : '0', NTFY_TOKEN: 'sekret-token' });
      const ac = new AbortController(); const p = historyLoop(cfg, ac.signal);
      await waitFor(() => fs.existsSync(path.join(outDir(cfg), 'history.json'))); ac.abort(); await p;
      if (scenario === 'configured') {
        assert.equal(posts.length, 1); assert.equal(posts[0]!.url, '/tp'); assert.match(posts[0]!.body, /EMG1 \| 5000 ft/); assert.equal(posts[0]!.headers.priority, '5');
        assert.ok(!/51\.6|-1\.1/.test(posts[0]!.body + JSON.stringify(posts[0]!.headers)), 'no position in the message');
      } else assert.equal(posts.length, 0, scenario + ' must not send');
    }
  } finally { await close(ntfy); await close(up.server); }
});

test('publicDemo comes from the environment or from DATA_DIR/skywatch-config.json', () => {
  assert.equal(makeConfig({ PUBLIC_DEMO: '1' }).publicDemo, true); assert.equal(makeConfig({}).publicDemo, false);
  const dir = tmpdir(); fs.writeFileSync(path.join(dir, 'skywatch-config.json'), JSON.stringify({ publicDemo: true }));
  assert.equal(makeConfig({ DATA_DIR: dir }).publicDemo, true);
});

test('no default feeds or endpoints: with no environment the server has no upstream, no notification target and no owner address', () => {
  const cfg = makeConfig({});
  assert.equal(cfg.readsbUrl, null); assert.equal(cfg.ntfyToken, null);
  const src = ['config.ts', 'proxy.ts', 'alerts.ts', 'recorder.ts', 'http.ts', 'main.ts'].map((f) => fs.readFileSync(path.join(__dirname, '..', '..', 'src', f), 'utf8')).join('\n');
  assert.ok(!/captainaarav\.dev|tryflightdeck|adsb\.im|\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/i.test(src.replace(/127\.0\.0\.1|0\.0\.0\.0/g, '')), 'no owner hostnames or IPs in the server source');
  assert.throws(() => parseUpstream('ftp://x'), /http or https/); assert.throws(() => parseUpstream('http://user:pw@host'), /credentials/); assert.throws(() => parseUpstream('http://h/?x=1'), /query/);
  assert.equal(parseUpstream('http://ultrafeeder:80/'), 'http://ultrafeeder'); assert.equal(parseUpstream('http://ultrafeeder:8080/'), 'http://ultrafeeder:8080'); assert.equal(parseUpstream('http://h/base/'), 'http://h/base');
});

test('security limits: long URLs, request bodies and floods are refused; headers are set; atomic writes leave no temp file', async () => {
  const app = await startApp({ RATE_BURST: '12', RATE_PER_SECOND: '1' });
  try {
    assert.equal((await rawGet(app.base, '/' + 'a'.repeat(3000))).status, 414);
    const codes: number[] = []; for (let i = 0; i < 25; i++) codes.push((await rawGet(app.base, '/api/health')).status);
    assert.ok(codes.includes(429), 'the per-IP limit kicks in: ' + codes.join(','));
  } finally { await close(app.server); }
  const lim = new RateLimiter(2, 1, (() => { let t = 0; return () => (t += 100); })());
  assert.deepEqual([lim.allow('a'), lim.allow('a'), lim.allow('a')], [true, true, false]); assert.equal(lim.allow('b'), true);
  const dir = tmpdir(); const f = path.join(dir, 'x', 'y.json'); await atomicWrite(f, '{"a":1}'); await atomicWrite(f, '{"a":2}');
  assert.equal(fs.readFileSync(f, 'utf8'), '{"a":2}'); assert.deepEqual(fs.readdirSync(path.dirname(f)), ['y.json']);
});

test('data size caps: a file over the cap is not written', async () => {
  const up = await fakeReadsb();
  const cfg = makeConfig({ READSB_URL: up.url, WEATHER: '0', MOVEMENTS: '0' });
  cfg.limits.maxDataFileBytes = 50;
  const ac = new AbortController(); const p = historyLoop(cfg, ac.signal);
  await new Promise((r) => setTimeout(r, 800)); ac.abort(); await p; await close(up.server);
  assert.ok(!fs.existsSync(path.join(outDir(cfg), 'history.json')), 'an over-size history file is refused');
});
