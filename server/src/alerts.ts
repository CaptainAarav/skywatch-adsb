// Optional alert sender (ntfy). OFF unless the alerts config file exists, and never on in public-demo mode. See docs/ALERTS.md.
// The message carries callsign, registration, type, altitude and the reason. It never carries the receiver position or any distance from it.
import { promises as fs } from 'node:fs';
import { isNum } from './util.js';

type Ac = Record<string, any>;
export const EMERGENCY_SQ: Record<string, string> = { '7500': 'hijack', '7600': 'radio failure', '7700': 'general emergency' };
export interface Rule { type?: string; value?: unknown }
export interface AlertConfig { enabled?: boolean; ntfy: { topic: string; url?: string; token?: string }; rules?: Rule[]; dedupe_minutes?: number; max_per_hour?: number; quiet_hours?: { start: string; end: string; tz?: string } }

/** The parsed config, or null when alerts are off: missing, unreadable, enabled:false, or no ntfy topic. */
export async function loadAlertsConfig(file: string, publicDemo: boolean): Promise<AlertConfig | null> {
  if (publicDemo) return null;
  let raw: string;
  try { raw = await fs.readFile(file, 'utf8'); } catch { return null; }
  let cfg: unknown;
  try { cfg = JSON.parse(raw); } catch { console.error('alerts: config unreadable'); return null; }
  return validateAlertsConfig(cfg);
}

export function validateAlertsConfig(cfg: unknown): AlertConfig | null {
  const c = cfg as Record<string, any>;
  if (!c || typeof c !== 'object' || Array.isArray(c) || c.enabled === false || !c.ntfy || typeof c.ntfy !== 'object' || Array.isArray(c.ntfy)) return null;
  if (!c.ntfy.topic) return null;
  if (c.ntfy.url !== undefined && !/^https?:\/\//i.test(String(c.ntfy.url))) return null;
  return c as AlertConfig;
}

const lc = (v: unknown): string => String(v ?? '').trim();
export function alertReason(ac: Ac, rules: Rule[]): string | null {
  const hexid = String(ac.hex ?? '').toLowerCase().replace(/^~+/, '');
  const flight = lc(ac.flight).toUpperCase();
  const reg = lc(ac.r).toUpperCase();
  const typ = lc(ac.t).toUpperCase();
  const sq = String(ac.squawk ?? '');
  const flags = Number(ac.dbFlags || 0);
  for (const r of rules) {
    const k = r.type, v = lc(r.value);
    if (k === 'emergency' && (sq in EMERGENCY_SQ || (ac.emergency !== undefined && ac.emergency !== null && ac.emergency !== 'none'))) {
      return 'emergency squawk ' + sq + (sq in EMERGENCY_SQ ? ' (' + EMERGENCY_SQ[sq] + ')' : '');
    }
    if (k === 'military' && flags & 1) return 'military aircraft';
    if (k === 'interesting' && flags & 2) return 'interesting aircraft';
    if (!v) continue;
    if (k === 'hex' && hexid === v.toLowerCase()) return 'hex ' + v.toUpperCase();
    if (k === 'reg' && reg === v.toUpperCase()) return 'registration ' + reg;
    if (k === 'callsign_prefix' && flight.startsWith(v.toUpperCase())) return 'callsign ' + v.toUpperCase() + '*';
    if (k === 'type' && typ === v.toUpperCase()) return 'type ' + typ;
  }
  return null;
}

/** Minutes since midnight of `now` (seconds) in the given IANA zone, or the server's local zone when none is given. */
function minutesOfDay(now: number, tz?: string): number {
  if (!tz) { const d = new Date(now * 1000); return d.getHours() * 60 + d.getMinutes(); }
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: 'numeric', minute: 'numeric', hourCycle: 'h23' }).formatToParts(new Date(now * 1000));
  const h = Number(parts.find((p) => p.type === 'hour')!.value), m = Number(parts.find((p) => p.type === 'minute')!.value);
  return h * 60 + m;
}
export function inQuietHours(cfg: Pick<AlertConfig, 'quiet_hours'>, now: number = Date.now() / 1000): boolean {
  const q = cfg.quiet_hours;
  if (!q || typeof q !== 'object') return false;
  try {
    const cur = minutesOfDay(now, q.tz);
    const [sh, sm] = String(q.start).split(':').map((x) => { const n = Number(x); if (!Number.isInteger(n) || /\D/.test(x.trim())) throw new Error('bad time'); return n; });
    const [eh, em] = String(q.end).split(':').map((x) => { const n = Number(x); if (!Number.isInteger(n) || /\D/.test(x.trim())) throw new Error('bad time'); return n; });
    const a = sh! * 60 + sm!, b = eh! * 60 + em!;
    return a <= b ? a <= cur && cur < b : cur >= a || cur < b;
  } catch { console.error('alerts: bad quiet_hours, ignoring'); return false; }
}

export const asciiHeader = (s: unknown): string => String(s).replace(/[^\x20-\x7e]/g, '?').slice(0, 200);

export function alertMessage(ac: Ac, reason: string): [string, string] {
  const flight = lc(ac.flight) || String(ac.hex ?? '').toUpperCase();
  const parts = [flight];
  const reg = ac.r, typ = ac.t;
  if (reg || typ) parts.push([reg, typ].filter((x) => x).join(' '));
  const alt = ac.alt_baro;
  parts.push(alt === 'ground' ? 'on the ground' : isNum(alt) ? String(Math.trunc(alt)) + ' ft' : 'altitude unknown');
  return [flight + ': ' + reason, parts.join(' | ')];
}

export class AlertState {
  seen = new Map<string, number>();
  sent: number[] = [];
  due(cfg: AlertConfig, hexid: string, reason: string, now: number): boolean {
    if (inQuietHours(cfg, now)) return false;
    const ded = Math.max(1, Math.trunc(Number(cfg.dedupe_minutes ?? 30))) * 60;
    if (now - (this.seen.get(hexid + '\0' + reason) ?? 0) < ded) return false;
    this.sent = this.sent.filter((t) => now - t < 3600);
    return this.sent.length < Math.trunc(Number(cfg.max_per_hour ?? 10));
  }
  mark(hexid: string, reason: string, now: number): void {
    this.seen.set(hexid + '\0' + reason, now);
    this.sent.push(now);
    if (this.seen.size > 2000) for (const [k, t] of this.seen) if (now - t >= 7200) this.seen.delete(k);
  }
}

export type Sender = (cfg: AlertConfig, title: string, body: string, priority: number) => Promise<unknown>;
export function makeNtfySender(token: string | null, fetchFn: typeof fetch = fetch): Sender {
  return async (cfg, title, body, priority) => {
    const n = cfg.ntfy;
    const url = (n.url || 'https://ntfy.sh').replace(/\/+$/, '') + '/' + encodeURIComponent(n.topic);
    const headers: Record<string, string> = { 'User-Agent': 'skywatch-adsb-server/1.0', Title: asciiHeader(title), Priority: String(priority), Tags: 'airplane' };
    const tok = token || n.token;
    if (tok) headers.Authorization = 'Bearer ' + tok;
    const r = await fetchFn(url, { method: 'POST', body, headers, signal: AbortSignal.timeout(10_000) });
    if (!r.ok) throw new Error('ntfy HTTP ' + r.status);      // status only: never the URL or the token
    return r.status;
  };
}

/** One pass over the current aircraft; returns the (title, body) pairs actually sent. */
export async function alertsTick(cfg: AlertConfig, st: AlertState, aircraft: Ac[], now: number, send: Sender): Promise<Array<[string, string]>> {
  const out: Array<[string, string]> = [];
  for (const ac of aircraft) {
    const reason = alertReason(ac, cfg.rules ?? []);
    if (!reason) continue;
    const hexid = String(ac.hex ?? '');
    if (!st.due(cfg, hexid, reason, now)) continue;
    const [title, body] = alertMessage(ac, reason);
    try { await send(cfg, title, body, reason.startsWith('emergency') ? 5 : 3); }
    catch (e) {
      console.error('alerts: send failed:', (e as Error).message);
      st.seen.set(hexid + '\0' + reason, now - Math.max(1, Math.trunc(Number(cfg.dedupe_minutes ?? 30))) * 60 + 120);   // retry in 2 min
      continue;
    }
    st.mark(hexid, reason, now);
    out.push([title, body]);
  }
  return out;
}
