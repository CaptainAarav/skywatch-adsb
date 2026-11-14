// History + polar recorder: samples aircraft.json and stats.json into rolling files the Graphs panel reads.
//   history.json  {"v":1,"interval":60,"fields":[...],"samples":[[t, with_pos, total, msg_s, range_nm, rssi, pos_s], ...]}
//   polar.json    {"v":1,"bins":36,"hours":{"<unix hour>":[max range nm per 10 degree bearing bin, ...]}}
// Only distances and bearings relative to the receiver are stored; no coordinates.
import { isNum, pyRound } from './util.js';

export const FIELDS = ['t', 'aircraft_with_pos', 'aircraft_total', 'messages_per_s', 'max_range_nm', 'avg_rssi', 'positions_per_s'];
export const BINS = 36;
type Ac = Record<string, any>;
export type Sample = [number, number, number, number | null, number | null, number | null, number | null];
export interface History { v: 1; interval: number; fields: string[]; samples: Sample[] }
export interface Polar { v: 1; bins: number; hours: Record<string, number[]> }

/** Port of sample(): one history row plus the per-bearing maxima. `now` is the sample time in seconds. */
export function buildSample(aircraftJson: Ac, statsJson: Ac | null, now: number): { sample: Sample; bins: number[] } {
  const lst: Ac[] = Array.isArray(aircraftJson?.aircraft) ? aircraftJson.aircraft : [];
  const withPos = lst.filter((a) => 'lat' in a || 'lastPosition' in a);
  const rng = lst.filter((a) => 'lat' in a && isNum(a.r_dst)).map((a) => a.r_dst as number);
  const rssi = lst.filter((a) => isNum(a.rssi) && (a.seen ?? 99) < 15).map((a) => a.rssi as number);
  let msg: number | null = null, pos: number | null = null, sig: number | null = null;
  try {
    const st = statsJson!.last1min;
    msg = pyRound(st.local.accepted[0] / 60.0, 1);
    pos = pyRound(st.position_count_total / 60.0, 2);
    sig = st.local.signal ?? null;
  } catch { /* stats.json unavailable: those fields stay null */ }
  const bins = new Array<number>(BINS).fill(0);
  for (const a of lst) {
    if ('lat' in a && isNum(a.r_dst) && isNum(a.r_dir)) {
      const i = Math.floor((((a.r_dir % 360) + 360) % 360) / (360 / BINS));
      bins[i] = Math.max(bins[i]!, a.r_dst);
    }
  }
  const avg = rssi.length ? rssi.reduce((x, y) => x + y, 0) / rssi.length : null;
  return {
    sample: [Math.trunc(now), withPos.length, lst.length, msg, rng.length ? pyRound(Math.max(...rng), 1) : null,
      sig !== null ? pyRound(sig, 1) : avg !== null ? pyRound(avg, 1) : null, pos],
    bins,
  };
}

/** Port of the append part of main(): trim to the retention window, merge the hour's bearing maxima, prune old hours. Returns new objects. */
export function appendSample(hist: History, polar: Polar, sample: Sample, bins: number[], interval: number, keepSeconds: number): { hist: History; polar: Polar } {
  const now = sample[0];
  const samples = [...hist.samples, sample].filter((x) => x[0] > now - keepSeconds);
  const hr = String(Math.floor(now / 3600));
  const hours: Record<string, number[]> = { ...polar.hours };
  const cur = hours[hr] ?? new Array<number>(BINS).fill(0);
  hours[hr] = cur.map((a, i) => Math.max(a, bins[i] ?? 0));
  const kept: Record<string, number[]> = {};
  for (const [k, v] of Object.entries(hours)) if (Number(k) * 3600 > now - keepSeconds) kept[k] = v;
  return { hist: { ...hist, interval, fields: FIELDS, samples }, polar: { ...polar, hours: kept } };
}

export const emptyHistory = (interval: number): History => ({ v: 1, interval, fields: FIELDS, samples: [] });
export const emptyPolar = (): Polar => ({ v: 1, bins: BINS, hours: {} });
