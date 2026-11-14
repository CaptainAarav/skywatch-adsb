// The three background loops (history + alerts, weather, movements). Each is ONE module's job; this file only schedules them and talks to the upstream
// and to DATA_DIR/skywatch/. Every loop catches its own errors, logs a short message (never a URL with credentials, never a token) and carries on.
import * as path from 'node:path';
import { promises as fs } from 'node:fs';
import type { Config } from './config.js';
import { AlertState, alertsTick, loadAlertsConfig, makeNtfySender } from './alerts.js';
import { appendSample, buildSample, emptyHistory, emptyPolar, type History, type Polar } from './history.js';
import { Airports, MovementTracker, mergeMovements, type Movement } from './movements.js';
import { atomicWrite, pyJson, readJson, sleep } from './util.js';
import { wxBox, wxFetch, wxPack } from './weather.js';

export const OUT_NAMES = ['history.json', 'polar.json', 'wx.json', 'movements.json'] as const;
export const outDir = (cfg: Config): string => path.join(cfg.dataDir, 'skywatch');

async function getJson(cfg: Config, name: string): Promise<any> {
  const r = await fetch(`${cfg.readsbUrl}/data/${name}`, { signal: AbortSignal.timeout(10_000), headers: { 'user-agent': 'skywatch-server' } });
  if (!r.ok) throw new Error(`upstream ${name} HTTP ${r.status}`);
  return r.json();
}

async function save(cfg: Config, name: string, obj: unknown): Promise<void> {
  const text = pyJson(obj);
  if (text.length > cfg.limits.maxDataFileBytes) { console.error(`recorder: ${name} would exceed the size cap, not written`); return; }
  await atomicWrite(path.join(outDir(cfg), name), text);
}

export async function historyLoop(cfg: Config, signal: AbortSignal): Promise<void> {
  const keep = cfg.history.keepDays * 86400, interval = cfg.history.intervalS;
  let hist = await readJson<History>(path.join(outDir(cfg), 'history.json'), emptyHistory(interval));
  let polar = await readJson<Polar>(path.join(outDir(cfg), 'polar.json'), emptyPolar());
  const alertState = new AlertState();
  const send = makeNtfySender(cfg.ntfyToken);
  let next = Date.now();
  while (!signal.aborted) {
    try {
      const ac = await getJson(cfg, 'aircraft.json');
      let stats: any = null;
      try { stats = await getJson(cfg, 'stats.json'); } catch { /* optional */ }
      const alerts = await loadAlertsConfig(cfg.alertsFile, cfg.publicDemo);
      if (alerts) await alertsTick(alerts, alertState, Array.isArray(ac.aircraft) ? ac.aircraft : [], Date.now() / 1000, send);
      const { sample, bins } = buildSample(ac, stats, Date.now() / 1000);
      ({ hist, polar } = appendSample(hist, polar, sample, bins, interval, keep));
      await save(cfg, 'history.json', hist);
      await save(cfg, 'polar.json', polar);
    } catch (e) { console.error('recorder: sample failed:', (e as Error).message); }
    next += interval * 1000;
    await sleep(Math.max(1000, next - Date.now()), signal);
  }
}

export async function weatherLoop(cfg: Config, signal: AbortSignal): Promise<void> {
  let backoff = 0;
  while (!signal.aborted) {
    let wait = cfg.weather.intervalS;
    try {
      let box = cfg.weather.box;
      if (!box) { const r = await getJson(cfg, 'receiver.json'); box = wxBox(Number(r.lat), Number(r.lon), cfg.weather.pad); }
      const metars = await wxFetch('metar', box);
      await sleep(3000, signal);                          // the API allows 100 requests a minute; we make 2 every 5
      const tafs = await wxFetch('taf', box);
      await save(cfg, 'wx.json', { v: 1, fetched_at: Math.trunc(Date.now() / 1000), stations: wxPack(metars, tafs) });
      backoff = 0;
    } catch (e) {
      if ((e as { status?: number }).status === 429) { backoff = Math.min(3600, Math.max(600, backoff * 2)); wait = backoff; }
      console.error('recorder: weather fetch failed:', (e as Error).message);
    }
    await sleep(wait * 1000, signal);
  }
}

export async function movementsLoop(cfg: Config, signal: AbortSignal): Promise<void> {
  let rows: unknown[][];
  try { rows = JSON.parse(await fs.readFile(path.join(cfg.staticDir, 'airport-db', 'airports.json'), 'utf8')).a ?? []; }
  catch (e) { console.error('recorder: movements off (no airport list):', (e as Error).message); return; }
  const file = path.join(outDir(cfg), 'movements.json');
  let doc = await readJson<{ v: number; movements: Movement[]; updated?: number; note?: string }>(file, { v: 1, movements: [] });
  const trk = new MovementTracker(new Airports(rows));
  while (!signal.aborted) {
    try {
      const now = Date.now() / 1000;
      const fresh = trk.update((await getJson(cfg, 'aircraft.json')).aircraft ?? [], now);
      doc.movements = mergeMovements(doc, fresh, now);
      let exists = true;
      try { await fs.access(file); } catch { exists = false; }
      if (fresh.length || !exists) { doc = { ...doc, v: 1, updated: Math.trunc(now), note: 'Inferred from receiver data' }; await save(cfg, 'movements.json', doc); }
    } catch (e) { console.error('recorder: movement detection failed:', (e as Error).message); }
    await sleep(cfg.movements.intervalS * 1000, signal);
  }
}

/** Start every enabled loop; resolves when they all stop (after the signal aborts). Needs the upstream. */
export function startRecorders(cfg: Config, signal: AbortSignal): Promise<unknown> {
  if (!cfg.readsbUrl) return Promise.resolve();
  const loops: Array<Promise<void>> = [];
  if (cfg.history.enabled) loops.push(historyLoop(cfg, signal));
  if (cfg.weather.enabled) loops.push(weatherLoop(cfg, signal));
  if (cfg.movements.enabled) loops.push(movementsLoop(cfg, signal));
  return Promise.allSettled(loops);
}
