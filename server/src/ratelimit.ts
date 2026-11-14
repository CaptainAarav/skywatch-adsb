// Per-IP token bucket. In memory, bounded (old entries are dropped), no persistent identifiers.
export class RateLimiter {
  private buckets = new Map<string, { tokens: number; at: number }>();
  constructor(private burst: number, private perSecond: number, private now: () => number = Date.now) {}
  allow(key: string): boolean {
    const t = this.now();
    let b = this.buckets.get(key);
    if (!b) {
      if (this.buckets.size > 20000) this.prune(t);
      b = { tokens: this.burst, at: t };
      this.buckets.set(key, b);
    }
    b.tokens = Math.min(this.burst, b.tokens + ((t - b.at) / 1000) * this.perSecond);
    b.at = t;
    if (b.tokens < 1) return false;
    b.tokens -= 1;
    return true;
  }
  private prune(t: number): void { for (const [k, b] of this.buckets) if (t - b.at > 60_000) this.buckets.delete(k); if (this.buckets.size > 20000) this.buckets.clear(); }
}
