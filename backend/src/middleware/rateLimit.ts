type Bucket = { count: number; windowStart: number };

export type RateState = { limit: number; remaining: number; resetEpochSeconds: number };

export function createFixedWindowRateLimiter(opts: { windowMs: number; limit: number }) {
  const store = new Map<string, Bucket>();
  const { windowMs, limit } = opts;

  function computeState(now: number, b: Bucket | undefined): RateState {
    const windowStart = b ? b.windowStart : now;
    const elapsed = now - windowStart;
    const resetMs = elapsed < windowMs ? windowMs - elapsed : 0;
    const resetEpochSeconds = Math.ceil((Date.now() + resetMs) / 1000);
    const used = b ? b.count : 0;
    const remaining = Math.max(0, limit - used);
    return { limit, remaining, resetEpochSeconds };
  }

  return {
    tryConsume(key: string): { allowed: boolean; state: RateState } {
      const now = Date.now();
      let b = store.get(key);
      if (!b || now - b.windowStart >= windowMs) {
        b = { count: 0, windowStart: now };
        store.set(key, b);
      }
      if (b.count < limit) {
        b.count += 1;
        return { allowed: true, state: computeState(now, b) };
      }
      return { allowed: false, state: computeState(now, b) };
    },
    peek(key: string): RateState {
      const now = Date.now();
      const b = store.get(key);
      return computeState(now, b);
    },
  };
}
