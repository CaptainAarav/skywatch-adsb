// Weather recorder: METAR and TAF from aviationweather.gov (keyless, no CORS headers, so browsers cannot call it) for ONE bounding box of whole
// degrees around the receiver, written to wx.json: {v, fetched_at, stations: {ICAO: {m: metar, t: taf}}}. The box is never written to a file.
type Obj = Record<string, any>;

export const WX_URL = 'https://aviationweather.gov/api/data';
export const WX_UA = 'skywatch-adsb-server/1.0 (+https://github.com/CaptainAarav/skywatch-adsb)';

export function wxBox(lat: number, lon: number, pad: number): number[] {
  return [Math.max(-90, Math.floor(lat) - pad), Math.max(-180, Math.floor(lon) - pad), Math.min(90, Math.ceil(lat) + pad), Math.min(180, Math.ceil(lon) + pad)];
}

const clouds = (cl: unknown): unknown[] => (Array.isArray(cl) ? cl.filter((c) => c && typeof c === 'object' && !Array.isArray(c)).map((c: Obj) => [c.cover ?? null, c.base ?? null]) : []);
const n = (v: unknown): any => (v === undefined ? null : v);

/** Port of wx_pack(): the latest observation per station wins; the latest TAF per station wins. */
export function wxPack(metars: Obj[], tafs: Obj[]): Record<string, { m?: Obj; t?: Obj }> {
  const st: Record<string, { m?: Obj; t?: Obj }> = {};
  const byObs = [...metars].sort((a, b) => (a.obsTime || 0) - (b.obsTime || 0));
  for (const m of byObs) {
    const k = m.icaoId;
    if (!k) continue;
    (st[k] ??= {}).m = {
      raw: n(m.rawOb), obs: n(m.obsTime), wdir: n(m.wdir), wspd: n(m.wspd), wgst: n(m.wgst), vis: n(m.visib), qnh: n(m.altim), temp: n(m.temp),
      dew: n(m.dewp), clouds: clouds(m.clouds), cat: n(m.fltCat), wx: n(m.wxString),
    };
  }
  const byIssue = [...tafs].sort((a, b) => { const x = a.issueTime || '', y = b.issueTime || ''; return x < y ? -1 : x > y ? 1 : 0; });
  for (const t of byIssue) {
    const k = t.icaoId;
    if (!k) continue;
    (st[k] ??= {}).t = {
      raw: n(t.rawTAF), issue: n(t.issueTime), from: n(t.validTimeFrom), to: n(t.validTimeTo),
      f: (Array.isArray(t.fcsts) ? t.fcsts : []).map((f: Obj) => ({
        from: n(f.timeFrom), to: n(f.timeTo), chg: n(f.fcstChange), prob: n(f.probability), wdir: n(f.wdir), wspd: n(f.wspd), wgst: n(f.wgst), vis: n(f.visib),
        clouds: clouds(f.clouds), vv: n(f.vertVis),
      })),
    };
  }
  return st;
}

export async function wxFetch(kind: 'metar' | 'taf', box: number[], fetchFn: typeof fetch = fetch): Promise<Obj[]> {
  const url = `${WX_URL}/${kind}?bbox=${box.join(',')}&format=json`;
  const r = await fetchFn(url, { headers: { 'User-Agent': WX_UA }, signal: AbortSignal.timeout(60_000) });
  if (r.status === 204) return [];
  if (!r.ok) throw Object.assign(new Error(`weather HTTP ${r.status}`), { status: r.status });
  const j = await r.json();
  return Array.isArray(j) ? j : [];
}
