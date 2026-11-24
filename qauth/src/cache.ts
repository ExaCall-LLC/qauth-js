/**
 * A small time-limited cache: answers are kept briefly and then asked for
 * again, so a change in qAuth (a role removed, a key revoked) takes effect
 * soon. Concurrent asks for the same key share one call. Only successful
 * answers are kept; a failure is never cached.
 */
export class TtlCache<T> {
  private readonly items = new Map<string, { value: T; until: number }>();
  private readonly inflight = new Map<string, Promise<T>>();

  constructor(
    private readonly ttlMs: number,
    private readonly now: () => number = () => Date.now(),
    private readonly maxItems = 10_000,
  ) {}

  /** ttl 0 = no cache (concurrent asks still share one call). */
  async get(key: string, load: () => Promise<T>, keep: (v: T) => boolean = () => true): Promise<T> {
    const hit = this.items.get(key);
    if (hit && hit.until > this.now()) return hit.value;
    const running = this.inflight.get(key);
    if (running) return running;
    const p = load()
      .then((value) => {
        if (this.ttlMs > 0 && keep(value)) this.set(key, value);
        return value;
      })
      .finally(() => this.inflight.delete(key));
    this.inflight.set(key, p);
    return p;
  }

  /** Drop every entry whose key starts with `prefix` ("" = everything). */
  forget(prefix: string): void {
    for (const k of this.items.keys()) if (k.startsWith(prefix)) this.items.delete(k);
  }

  get size(): number {
    return this.items.size;
  }

  private set(key: string, value: T) {
    if (this.items.size >= this.maxItems) {
      const t = this.now();
      for (const [k, v] of this.items) if (v.until <= t) this.items.delete(k);
      if (this.items.size >= this.maxItems) this.items.delete(this.items.keys().next().value as string);
    }
    this.items.set(key, { value, until: this.now() + this.ttlMs });
  }
}
