export async function retry<T>(
  fn: () => Promise<T>,
  options?: { retries?: number; baseDelayMs?: number; maxDelayMs?: number; shouldRetry?: (err: any, attempt: number) => boolean },
) {
  const retries = options?.retries ?? 2;
  const base = options?.baseDelayMs ?? 200;
  const maxDelay = options?.maxDelayMs ?? 1000;
  let attempt = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      return await fn();
    } catch (err) {
      const allowed = options?.shouldRetry ? options.shouldRetry(err, attempt) : true;
      if (attempt >= retries || !allowed) throw err;
      const delay = Math.min(maxDelay, base * Math.pow(2, attempt));
      await new Promise((r) => setTimeout(r, delay));
      attempt += 1;
    }
  }
}
