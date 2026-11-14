// The HTTP server: GET/HEAD only. Routing, in order: /api/health, the recorder files at /globe_history/skywatch/*.json, the allow-listed proxy, the static site.
import * as http from 'node:http';
import * as path from 'node:path';
import type { Config } from './config.js';
import { handleProxy } from './proxy.js';
import { RateLimiter } from './ratelimit.js';
import { serveStatic } from './static.js';
import { OUT_NAMES, outDir } from './recorder.js';
import { promises as fs } from 'node:fs';

export const VERSION = '1.0.0';
const BASE_HEADERS = { 'x-content-type-options': 'nosniff', 'referrer-policy': 'strict-origin-when-cross-origin' } as const;   // no CSP: it could break the app

function reply(res: http.ServerResponse, code: number, body: string, extra: Record<string, string> = {}): void {
  res.writeHead(code, { ...BASE_HEADERS, 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store', ...extra });
  res.end(body);
}

export function createApp(cfg: Config): http.Server {
  const limiter = new RateLimiter(cfg.rateLimit.burst, cfg.rateLimit.perSecond);
  const server = http.createServer({ maxHeaderSize: 8192, requestTimeout: cfg.limits.requestTimeoutMs, headersTimeout: 10_000, keepAliveTimeout: 5000 }, async (req, res) => {
    for (const [k, v] of Object.entries(BASE_HEADERS)) res.setHeader(k, v);
    try {
      if (req.method !== 'GET' && req.method !== 'HEAD') return reply(res, 405, 'Method not allowed\n', { allow: 'GET, HEAD' });
      if (req.headers['content-length'] && req.headers['content-length'] !== '0') return reply(res, 413, 'No request body is accepted\n');
      const raw = req.url ?? '/';
      if (raw.length > cfg.limits.maxUrlLength) return reply(res, 414, 'URI too long\n');
      const ip = (cfg.trustProxy && typeof req.headers['x-forwarded-for'] === 'string' ? req.headers['x-forwarded-for'].split(',')[0]!.trim() : req.socket.remoteAddress) || 'unknown';
      if (!limiter.allow(ip)) return reply(res, 429, 'Too many requests\n', { 'retry-after': '5' });
      const q = raw.indexOf('?');
      const pathname = q < 0 ? raw : raw.slice(0, q), search = q < 0 ? '' : raw.slice(q);
      if (!pathname.startsWith('/')) return reply(res, 400, 'Bad request\n');

      if (pathname === '/api/health') {
        // liveness only: no upstream address, no paths, nothing about the owner
        res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
        return void res.end(JSON.stringify({ ok: true, version: VERSION, upstream: cfg.readsbUrl !== null, publicDemo: cfg.publicDemo }));
      }
      const m = /^\/globe_history\/skywatch\/([a-z]+\.json)$/.exec(pathname);
      if (m && (OUT_NAMES as readonly string[]).includes(m[1]!)) {
        let body: Buffer;
        try { body = await fs.readFile(path.join(outDir(cfg), m[1]!)); } catch { return reply(res, 404, 'Not found\n'); }
        res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-cache', 'content-length': body.length });
        return void res.end(req.method === 'HEAD' ? undefined : body);
      }
      if (await handleProxy(cfg, req, res, pathname, search)) return;
      if (serveStatic(cfg.staticDir, req, res, pathname)) return;
      reply(res, 404, 'Not found\n');
    } catch { if (!res.headersSent) reply(res, 500, 'Server error\n'); else res.destroy(); }
  });
  server.on('clientError', (_e, socket) => { socket.destroy(); });
  return server;
}
