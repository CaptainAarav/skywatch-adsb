import * as fs from 'node:fs';
import * as http from 'node:http';
import * as os from 'node:os';
import * as path from 'node:path';
import type { AddressInfo } from 'node:net';
import { loadConfig, type Config } from '../src/config.js';
import { createApp } from '../src/http.js';

export const FIX = path.join(__dirname, '..', '..', 'test', 'fixtures');
export const fx = (name: string): any => JSON.parse(fs.readFileSync(path.join(FIX, name), 'utf8'));
/** Normalise through JSON so undefined and key order do not matter: parity is on parsed values. */
export const norm = (o: unknown): unknown => JSON.parse(JSON.stringify(o));
export const tmpdir = (): string => fs.mkdtempSync(path.join(os.tmpdir(), 'skywatch-test-'));

export function listen(server: http.Server): Promise<number> {
  return new Promise((res) => server.listen(0, '127.0.0.1', () => res((server.address() as AddressInfo).port)));
}
export const close = (server: http.Server): Promise<void> => new Promise((res) => { server.closeAllConnections?.(); server.close(() => res()); });

/** A stand-in for readsb / tar1090: serves what the map would request, and records every path it was asked for. */
export async function fakeReadsb(extra: Record<string, string | Buffer> = {}): Promise<{ url: string; server: http.Server; hits: string[] }> {
  const hits: string[] = [];
  const files: Record<string, string | Buffer> = {
    '/data/receiver.json': JSON.stringify({ refresh: 1000, history: 1, lat: 51.5, lon: -1.0, readsb: true, binCraft: false }),
    '/data/aircraft.json': JSON.stringify({ now: Date.now() / 1000, messages: 5, aircraft: [{ hex: 'abc123', flight: 'TEST1', lat: 51.6, lon: -1.1, alt_baro: 3000, gs: 200, track: 90, r_dst: 10, r_dir: 45, seen: 0.3, seen_pos: 0.3, rssi: -20 }, { hex: 'def456', lat: 51.4, lon: -0.9, alt_baro: 'ground' }] }),
    '/data/stats.json': JSON.stringify({ last1min: { local: { accepted: [600, 0], signal: -18.5 }, position_count_total: 120 } }),
    '/version.json': JSON.stringify({ tar1090Version: 'x', databaseVersion: '9.9.9' }),
    '/db-9.9.9/4.js': 'db-ok', '/chunks/chunks.json': '{"chunks":[]}', '/secret.txt': 'must never be served', '/data/secret.json': '{"secret":1}',
    ...extra,
  };
  const server = http.createServer((req, res) => {
    const p = (req.url ?? '').split('?')[0]!;
    hits.push(req.url ?? '');
    const f = files[p];
    if (f === undefined) { res.writeHead(404); return void res.end('nope'); }
    res.writeHead(200, { 'content-type': p.endsWith('.json') ? 'application/json' : 'text/plain', 'set-cookie': 'leak=1', 'x-powered-by': 'fake' });
    res.end(f);
  });
  const port = await listen(server);
  return { url: `http://127.0.0.1:${port}`, server, hits };
}

export function makeConfig(over: Record<string, string | undefined> = {}): Config {
  const dataDir = over.DATA_DIR ?? tmpdir();
  const staticDir = over.STATIC_DIR ?? (() => { const d = tmpdir(); fs.writeFileSync(path.join(d, 'index.html'), '<!doctype html><title>t</title>'); fs.writeFileSync(path.join(d, 'app.js'), 'x=1'); fs.writeFileSync(path.join(d, '.secret'), 'no'); return d; })();
  return loadConfig({ DATA_DIR: dataDir, STATIC_DIR: staticDir, ...over } as NodeJS.ProcessEnv);
}

export async function startApp(over: Record<string, string | undefined> = {}): Promise<{ base: string; cfg: Config; server: http.Server }> {
  const cfg = makeConfig(over);
  const server = createApp(cfg);
  const port = await listen(server);
  return { base: `http://127.0.0.1:${port}`, cfg, server };
}

/** Raw request so paths are sent exactly as written (fetch would normalise ../ away). */
export function rawGet(base: string, rawPath: string, method = 'GET'): Promise<{ status: number; body: string; headers: http.IncomingHttpHeaders }> {
  return new Promise((resolve, reject) => {
    const u = new URL(base);
    const req = http.request({ host: u.hostname, port: u.port, method, path: rawPath }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8'), headers: res.headers }));
    });
    req.on('error', reject);
    req.end();
  });
}
