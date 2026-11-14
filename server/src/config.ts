// Configuration: environment variables, optionally overridden by DATA_DIR/skywatch-config.json. Never reads a URL from a request.
import * as fs from 'node:fs';
import * as path from 'node:path';

export interface Config {
  port: number;
  host: string;
  /** Base URL of the readsb / tar1090 web server whose data is proxied and recorded. Fixed here; never taken from a request. null = static + recorders off. */
  readsbUrl: string | null;
  dataDir: string;
  staticDir: string;
  /** Public demo: alerts are disabled even when a config file exists; nothing owner-specific is exposed. */
  publicDemo: boolean;
  trustProxy: boolean;
  weather: { enabled: boolean; intervalS: number; pad: number; box: number[] | null };
  movements: { enabled: boolean; intervalS: number };
  history: { enabled: boolean; intervalS: number; keepDays: number };
  alertsFile: string;
  ntfyToken: string | null;
  rateLimit: { burst: number; perSecond: number };
  limits: { requestTimeoutMs: number; upstreamTimeoutMs: number; maxUrlLength: number; maxUpstreamBytes: number; maxDataFileBytes: number };
}

const bool = (v: string | undefined, d: boolean): boolean => (v === undefined || v === '' ? d : !/^(0|false|no|off)$/i.test(v));
const int = (v: string | undefined, d: number, min = 0, max = Number.MAX_SAFE_INTEGER): number => {
  const n = v === undefined || v === '' ? d : Number.parseInt(v, 10);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : d;
};

/** Validate the upstream base URL once at start-up. Only http(s), no credentials, no query, no fragment. */
export function parseUpstream(u: string | undefined): string | null {
  if (!u) return null;
  let url: URL;
  try { url = new URL(u); } catch { throw new Error('READSB_URL is not a valid URL'); }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('READSB_URL must be http or https');
  if (url.username || url.password) throw new Error('READSB_URL must not contain credentials (use a network-level allow list)');
  if (url.search || url.hash) throw new Error('READSB_URL must not contain a query or fragment');
  return url.origin + url.pathname.replace(/\/+$/, '');
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const dataDir = path.resolve(env.DATA_DIR || '/data');
  let file: Record<string, unknown> = {};
  try { file = JSON.parse(fs.readFileSync(path.join(dataDir, 'skywatch-config.json'), 'utf8')); } catch { /* optional */ }
  const fb = (k: string, e: string | undefined, d: boolean): boolean => (e !== undefined && e !== '' ? bool(e, d) : typeof file[k] === 'boolean' ? (file[k] as boolean) : d);
  const box = env.WX_BOX ? env.WX_BOX.split(',').map((x) => Math.trunc(Number(x))).filter(Number.isFinite) : null;
  return {
    port: int(env.PORT, 8080, 1, 65535),
    host: env.HOST || '0.0.0.0',
    readsbUrl: parseUpstream(env.READSB_URL),
    dataDir,
    staticDir: path.resolve(env.STATIC_DIR || path.join(__dirname, '..', '..', '..', 'html')),
    publicDemo: fb('publicDemo', env.PUBLIC_DEMO, false),
    trustProxy: bool(env.TRUST_PROXY, false),
    weather: { enabled: fb('weather', env.WEATHER, true), intervalS: Math.max(300, int(env.WX_INTERVAL, 300)), pad: int(env.WX_PAD, 3, 0, 20), box: box && box.length === 4 ? box : null },
    movements: { enabled: fb('movements', env.MOVEMENTS, true), intervalS: Math.max(5, int(env.MOVE_INTERVAL, 10)) },
    history: { enabled: fb('history', env.HISTORY, true), intervalS: Math.max(5, int(env.SAMPLE_INTERVAL, 60)), keepDays: int(env.KEEP_DAYS, 7, 1, 30) },
    alertsFile: env.ALERTS_FILE || path.join(dataDir, 'skywatch-alerts.json'),
    ntfyToken: env.NTFY_TOKEN || null,
    rateLimit: { burst: int(env.RATE_BURST, 600, 10), perSecond: int(env.RATE_PER_SECOND, 30, 1) },
    limits: { requestTimeoutMs: 15_000, upstreamTimeoutMs: 15_000, maxUrlLength: 2048, maxUpstreamBytes: 128 * 1024 * 1024, maxDataFileBytes: 24 * 1024 * 1024 },
  };
}
