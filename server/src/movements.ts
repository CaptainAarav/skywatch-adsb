// Recent movements (inferred): landings and take-offs near known airports, from aircraft.json only. Written to movements.json (rolling 24 h).
// Entries carry time, callsign, registration, type, airport ICAO, direction and an inferred runway. Never the receiver position or a distance from it.
import { isNum, truthy } from './util.js';

export const MOVE_KEEP_S = 24 * 3600;
export const NEAR_NM = 3.0;     // horizontal radius around an airport that counts as "at the airport"
export const LOW_FT = 800;      // height above the airport that counts as "on the runway or just above it"
export const LOST_S = 90;       // not heard for this long counts as gone
type Ac = Record<string, any>;
export interface Movement { t: number; callsign: string; reg: string; type: string; airport: string; dir: 'takeoff' | 'landing'; rwy: string | null }
interface Apt { icao: string; lat: number; lon: number; elev: number; rwy: Array<[string, number]> }

export function distNm(la1: number, lo1: number, la2: number, lo2: number): number {
  const r = Math.PI / 180, dy = (la2 - la1) * 60, dx = (lo2 - lo1) * 60 * Math.cos(((la1 + la2) * r) / 2);
  return Math.hypot(dx, dy);
}
const angDiff = (a: number, b: number): number => Math.abs((((a - b + 180) % 360) + 360) % 360 - 180);

export class Airports {
  private grid = new Map<string, Apt[]>();
  constructor(rows: unknown[][]) {
    for (const r of rows) {
      try {
        const lat = Number(r[4]), lon = Number(r[5]);
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
        const a: Apt = { icao: String(r[0]), lat, lon, elev: Number(r[6] || 0), rwy: [] };
        const rws = (r.length > 11 && r[11] ? r[11] : []) as unknown[][];
        for (const rw of rws) for (const ident of rw.slice(0, 2)) {
          const m = /^(\d+)/.exec(String(ident ?? ''));
          if (m) a.rwy.push([String(ident), (Number.parseInt(m[1]!, 10) % 36) * 10]);
        }
        const key = `${Math.trunc(a.lat * 5)},${Math.trunc(a.lon * 5)}`;
        (this.grid.get(key) ?? this.grid.set(key, []).get(key)!).push(a);
      } catch { /* skip a malformed row */ }
    }
  }
  near(lat: number, lon: number): Apt | null {
    let best: [number, Apt] | null = null;
    const ci = Math.trunc(lat * 5), cj = Math.trunc(lon * 5);
    for (let i = ci - 1; i <= ci + 1; i++) for (let j = cj - 1; j <= cj + 1; j++) for (const a of this.grid.get(`${i},${j}`) ?? []) {
      const d = distNm(lat, lon, a.lat, a.lon);
      if (d <= NEAR_NM && (best === null || d < best[0])) best = [d, a];
    }
    return best ? best[1] : null;
  }
}

export function inferRunway(ap: Apt, track: number | null | undefined): string | null {
  if (track === null || track === undefined || !ap.rwy.length) return null;
  let best = ap.rwy[0]!;
  for (const x of ap.rwy) if (angDiff(x[1], track) < angDiff(best[1], track)) best = x;
  return angDiff(best[1], track) <= 30 ? best[0] : null;
}

interface St { air: boolean; ground: boolean; first?: boolean; desc?: boolean; t?: number; lat?: number; lon?: number; agl?: number | null; trk?: number | null; gs?: number; rate?: number; ap?: Apt | null; low?: boolean; ac?: { hex: string; flight: string; reg: any; type: any } }

export class MovementTracker {
  private st = new Map<string, St>();
  private recent = new Map<string, number>();
  constructor(private ap: Airports) {}

  private emit(now: number, a: Apt, ac: { hex: string; flight: string; reg: any; type: any }, direction: 'takeoff' | 'landing', rwy: string | null, out: Movement[]): void {
    const key = `${ac.hex}|${a.icao}|${direction}`;
    if (now - (this.recent.get(key) ?? 0) < 1200) return;
    this.recent.set(key, now);
    out.push({ t: Math.trunc(now), callsign: ac.flight || '', reg: ac.reg || '', type: ac.type || '', airport: a.icao, dir: direction, rwy });
  }

  update(aircraft: Ac[], now: number): Movement[] {
    const out: Movement[] = [];
    const seen = new Set<string>();
    for (const r of aircraft) {
      const hexid = String(r.hex ?? '');
      const lat = r.lat, lon = r.lon;
      if (!hexid || lat === undefined || lat === null || lon === undefined || lon === null || ((r.seen_pos ?? r.seen ?? 0) || 0) > 30) continue;
      seen.add(hexid);
      const alt = r.alt_baro;
      const ground = alt === 'ground';
      const altFt: number | null = ground ? null : isNum(alt) ? alt : null;
      const ac = { hex: hexid, flight: String(r.flight ?? '').trim(), reg: r.r, type: r.t };
      let s = this.st.get(hexid);
      const ap = this.ap.near(lat, lon);
      const gs: number = r.gs || 0;
      const trk: number | null | undefined = r.track;
      const rate: number = r.baro_rate || 0;
      const agl: number | null = ap === null || altFt === null ? null : altFt - ap.elev;
      const low = ground || (agl !== null && agl <= LOW_FT);
      if (s === undefined) {
        s = { air: false, ground: false, first: true };
        this.st.set(hexid, s);
        // first sighting low, close to an airport and climbing away fast: a take-off we only caught the end of
        if (ap && !ground && agl !== null && agl <= 1500 && rate > 300 && gs >= 80 && gs <= 260) {
          this.emit(now, ap, ac, 'takeoff', inferRunway(ap, trk), out);
          s.air = true;
        }
      }
      if (ground) {
        if (s.air && ap && s.desc) this.emit(now, ap, ac, 'landing', inferRunway(ap, s.trk), out);
        s.ground = true; s.air = false; s.desc = false;
      } else {
        if (s.ground && ap && agl !== null && agl > 100 && gs >= 80 && rate >= 0) {
          this.emit(now, ap, ac, 'takeoff', inferRunway(ap, trk), out);     // was on the ground here, now airborne and still near
          s.ground = false;
        } else if (s.ground && (ap === null || (agl !== null && agl > 100))) {
          s.ground = false;
        }
        s.air = true;
        s.desc = Boolean(rate < -100 || (agl !== null && agl < 2000 && rate <= 0)) && Boolean(ap);
      }
      Object.assign(s, { t: now, lat, lon, agl, trk: trk !== undefined && trk !== null ? trk : s.trk, gs, rate, ap, low, ac });
      if (ap === null) s.desc = false;
    }
    // aircraft that went quiet low, near an airport, descending and slow, lined up with a runway: landing
    for (const [hexid, s] of [...this.st]) {
      if (seen.has(hexid) || now - (s.t ?? 0) < LOST_S) continue;
      const ap = s.ap;
      if (s.air && ap && truthy(s.desc) && s.agl !== null && s.agl !== undefined && s.agl <= LOW_FT && (s.gs ?? 0) < 170 && (s.rate ?? 0) <= 0 && inferRunway(ap, s.trk) !== null) {
        this.emit(now, ap, s.ac!, 'landing', inferRunway(ap, s.trk), out);
      }
      if (now - (s.t ?? 0) > 600) this.st.delete(hexid);
    }
    if (this.recent.size > 5000) for (const [k, t] of this.recent) if (now - t >= 3600) this.recent.delete(k);
    return out;
  }
}

/** The rolling document: drop entries older than 24 h, keep the newest 500. */
export function mergeMovements(doc: { movements?: Movement[] }, fresh: Movement[], now: number): Movement[] {
  let list = (doc.movements ?? []).filter((m) => m.t > now - MOVE_KEEP_S);
  if (fresh.length) list = [...list, ...fresh].slice(-500);
  return list;
}
