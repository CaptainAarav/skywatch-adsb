// GET-only reverse proxy for the readsb / tar1090 data the web UI requests. ONLY the exact paths below are forwarded; the upstream base comes
// from configuration (READSB_URL), so there is no way to make the server fetch a URL a visitor chose (no open proxy, no SSRF).
import * as http from 'node:http';
import * as https from 'node:https';
import type { Config } from './config.js';

const HEX2 = '[0-9a-f]{2}', ICAO = '~?[0-9a-f]{6}', DATE = '\\d{4}/\\d{2}/\\d{2}';
/** Every path the front end requests (html/early.js, script.js, ui/*.js), anchored. Anything else is not proxied. */
export const ALLOWED: RegExp[] = [
  /^\/data\/(receiver|aircraft|outline|multiOutline)\.json$/,
  /^\/data\/aircraft\.binCraft(\.zst)?$/,
  /^\/data\/history_\d{1,4}\.json$/,
  /^\/data\/globe(Mil)?_?\d{4,5}\.(json|binCraft|binCraft\.zst)$/,
  new RegExp(`^/data/traces/${HEX2}/trace_(recent|full)_${ICAO}\\.json$`),
  /^\/chunks\/(chunks|pf|978)\.json$/,
  /^\/chunks\/[A-Za-z0-9_.-]{1,80}$/,
  new RegExp(`^/globe_history/${DATE}/traces/${HEX2}/trace_full_${ICAO}\\.json$`),
  new RegExp(`^/globe_history/${DATE}/heatmap/\\d{2}\\.bin\\.ttf$`),
  /^\/globeRates\.json$/,
  /^\/version\.json$/,
  /^\/graphs1090\/(graphs\/[A-Za-z0-9_.-]{1,80}\.(png|svg))?$/,
];
/** Aircraft database files the page asks for as db2/<file>; the web server upstream may keep them in a versioned folder (db-<version>/). */
export const DB_RE = /^\/db2\/[A-Za-z0-9_.-]{1,64}\.(js|json)$/;
/** readsb's own API; the query is built by the page (box, circle, ...) and may only contain these characters. */
export const API_PATH = '/re-api/';
export const API_QUERY_RE = /^\?[A-Za-z0-9_=.,&%-]{0,512}$/;

export interface Resolved { candidates: string[] }

/** The upstream path(s) to try for a request, or null when the request is not allowed. Pure: unit-tested without a network. */
export function resolveUpstream(rawPath: string, search: string, dbVersion?: string): Resolved | null {
  // No percent-encoding, backslash, NUL, dot-segment or double slash in any allowed path, so none is accepted: that rejects ../, %2e%2e/, %2f and friends outright.
  if (rawPath.length > 512 || !rawPath.startsWith('/') || /[%\\\0]/.test(rawPath) || rawPath.includes('//') || /(^|\/)\.\.?(\/|$)/.test(rawPath)) return null;
  if (rawPath === API_PATH) return search === '' || API_QUERY_RE.test(search) ? { candidates: [rawPath + search] } : null;
  if (DB_RE.test(rawPath)) {
    const file = rawPath.slice('/db2/'.length);
    const c = [rawPath];
    if (dbVersion && /^[0-9A-Za-z._-]{1,32}$/.test(dbVersion)) c.push(`/db-${dbVersion}/${file}`);
    return { candidates: c };
  }
  if (!ALLOWED.some((re) => re.test(rawPath))) return null;
  return { candidates: [rawPath] };               // any query on a data file (cache busters) is dropped, never forwarded
}

const PASS_HEADERS = ['content-type', 'content-encoding', 'cache-control', 'etag', 'last-modified', 'content-length'];

function fetchUpstream(url: URL, timeoutMs: number): Promise<http.IncomingMessage> {
  return new Promise((resolve, reject) => {
    const lib = url.protocol === 'https:' ? https : http;
    const req = lib.request(url, { method: 'GET', timeout: timeoutMs, headers: { 'accept-encoding': 'identity', 'user-agent': 'skywatch-server', accept: '*/*' } }, resolve);
    req.on('timeout', () => req.destroy(new Error('upstream timeout')));
    req.on('error', reject);
    req.end();
  });
}

let dbVersionCache: { v: string | undefined; at: number } = { v: undefined, at: 0 };
async function dbVersion(cfg: Config): Promise<string | undefined> {
  if (Date.now() - dbVersionCache.at < 600_000) return dbVersionCache.v;
  dbVersionCache = { v: undefined, at: Date.now() };
  try {
    const res = await fetchUpstream(new URL(cfg.readsbUrl + '/version.json'), 5000);
    const chunks: Buffer[] = []; let n = 0;
    for await (const c of res) { n += (c as Buffer).length; if (n > 4096) break; chunks.push(c as Buffer); }
    const v = JSON.parse(Buffer.concat(chunks).toString('utf8')).databaseVersion;
    if (typeof v === 'string') dbVersionCache.v = v;
  } catch { /* keep undefined */ }
  return dbVersionCache.v;
}

/** Handle one proxied GET/HEAD. Returns false when the path is not on the allow list (the caller answers 404). */
export async function handleProxy(cfg: Config, req: http.IncomingMessage, res: http.ServerResponse, pathname: string, search: string): Promise<boolean> {
  if (!cfg.readsbUrl) return false;
  const first = resolveUpstream(pathname, search);
  if (!first) return false;
  const r = DB_RE.test(pathname) ? resolveUpstream(pathname, search, await dbVersion(cfg)) : first;
  if (!r) return false;
  let up: http.IncomingMessage | null = null;
  for (const cand of r.candidates) {
    try {
      const u = await fetchUpstream(new URL(cfg.readsbUrl + cand), cfg.limits.upstreamTimeoutMs);
      if (u.statusCode === 200) { up = u; break; }
      u.resume();
      if (r.candidates.length === 1) { sendStatus(res, u.statusCode === 404 ? 404 : 502); return true; }
    } catch { if (r.candidates.length === 1) { sendStatus(res, 502); return true; } }
  }
  if (!up) { sendStatus(res, 404); return true; }
  const headers: Record<string, string> = {};
  for (const h of PASS_HEADERS) { const v = up.headers[h]; if (typeof v === 'string') headers[h] = v; }
  if (!headers['cache-control']) headers['cache-control'] = 'no-cache';
  res.writeHead(200, headers);
  if (req.method === 'HEAD') { up.destroy(); res.end(); return true; }
  let n = 0;
  up.on('data', (c: Buffer) => { n += c.length; if (n > cfg.limits.maxUpstreamBytes) { up!.destroy(); res.destroy(); } });
  up.on('error', () => res.destroy());
  up.pipe(res);
  return true;
}

function sendStatus(res: http.ServerResponse, code: number): void {
  res.writeHead(code, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
  res.end(code === 404 ? 'Not found\n' : 'Bad gateway\n');
}
