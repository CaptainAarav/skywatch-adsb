// Small helpers shared by the modules. Python-compatible JSON and rounding keep the written files identical in schema AND value to the
// recorder this server replaces.
import { promises as fs } from 'node:fs';
import * as path from 'node:path';

/** Python's round(x, n): the exact binary value is rounded, and an exact tie goes to the even neighbour (JS toFixed would round ties up). */
export function pyRound(x: number, n = 0): number {
  if (!Number.isFinite(x)) return x;
  const digits = Math.min(100, n + 40);
  const str = Math.abs(x).toFixed(digits), dot = str.indexOf('.');
  const tail = str.slice(dot + 1 + n);
  if (/^50*$/.test(tail)) {                                   // exact tie: truncate, then step up only when the kept last digit is odd
    const kept = str.slice(0, n === 0 ? dot : dot + 1 + n);
    const lastDigit = Number(kept[kept.length - 1]);
    const lower = Number(kept);
    const r = lastDigit % 2 === 0 ? lower : lower + 10 ** -n;
    return Number((x < 0 ? -r : r).toFixed(n));
  }
  return Number(x.toFixed(n));
}

/** Python's json.dump(..., separators=(',', ':')) with ensure_ascii: non-ASCII characters are written as \\uXXXX. */
export function pyJson(o: unknown): string {
  return JSON.stringify(o).replace(/[\u0080-￿]/g, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
}

/** Write a file atomically: temp file in the same directory, then rename. Never leaves a half-written file behind. */
export async function atomicWrite(file: string, data: string): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  try {
    await fs.writeFile(tmp, data, { mode: 0o644 });
    await fs.rename(tmp, file);
  } catch (e) {
    await fs.rm(tmp, { force: true }).catch(() => undefined);
    throw e;
  }
}

export async function readJson<T>(file: string, fallback: T): Promise<T> {
  try { return JSON.parse(await fs.readFile(file, 'utf8')) as T; } catch { return fallback; }
}

export const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
/** Python truthiness for the values that occur in readsb JSON. */
export const truthy = (v: unknown): boolean => !(v === undefined || v === null || v === false || v === 0 || v === '' || (Array.isArray(v) && v.length === 0));
export const sleep = (ms: number, signal?: AbortSignal): Promise<void> => new Promise((res) => {
  const t = setTimeout(res, ms);
  signal?.addEventListener('abort', () => { clearTimeout(t); res(); }, { once: true });
});
