type State = {
  failures: number;
  lastFailureAt: number;
  openUntil: number; // epoch ms; 0 means closed
};

const breakers = new Map<string, State>();

export class CircuitOpenError extends Error {
  code = 'circuit.open';
  constructor(public key: string) {
    super(`Circuit breaker open for ${key}`);
    this.name = 'CircuitOpenError';
  }
}

export type BreakerOptions = {
  failureThreshold?: number; // failures to open
  windowMs?: number; // lookback window for failures
  openMs?: number; // how long to stay open
};

const DEFAULTS: Required<BreakerOptions> = {
  failureThreshold: 5,
  windowMs: 30_000,
  openMs: 30_000,
};

export async function runWithBreaker<T>(key: string, fn: () => Promise<T>, opts?: BreakerOptions): Promise<T> {
  const now = Date.now();
  const s = breakers.get(key) ?? { failures: 0, lastFailureAt: 0, openUntil: 0 };
  const cfg = { ...DEFAULTS, ...(opts ?? {}) };

  if (s.openUntil && now < s.openUntil) {
    throw new CircuitOpenError(key);
  }

  try {
    const res = await fn();
    // on success, reset
    s.failures = 0;
    s.lastFailureAt = 0;
    s.openUntil = 0;
    breakers.set(key, s);
    return res;
  } catch (err) {
    const recent = now - s.lastFailureAt <= cfg.windowMs;
    s.failures = recent ? s.failures + 1 : 1;
    s.lastFailureAt = now;
    if (s.failures >= cfg.failureThreshold) {
      s.openUntil = now + cfg.openMs;
    }
    breakers.set(key, s);
    throw err;
  }
}

