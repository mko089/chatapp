function isLikelyJson(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length < 2) {
    return false;
  }
  const first = trimmed[0];
  const last = trimmed[trimmed.length - 1];
  return (first === '{' && last === '}') || (first === '[' && last === ']');
}

export function normalizeStructuredValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeStructuredValue(item));
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, val]) => [key, normalizeStructuredValue(val)]),
    );
  }
  if (typeof value === 'string') {
    const normalized = value.replace(/\r\n/g, '\n');
    if (isLikelyJson(normalized)) {
      try {
        return normalizeStructuredValue(JSON.parse(normalized));
      } catch (error) {
        return normalized;
      }
    }
    return normalized;
  }
  return value;
}

export function formatStructuredValue(value: unknown, space = 2, fallback = 'null'): string {
  if (value === undefined) {
    return fallback;
  }
  const normalized = normalizeStructuredValue(value ?? null);
  if (
    normalized === null ||
    typeof normalized === 'number' ||
    typeof normalized === 'boolean'
  ) {
    return String(normalized);
  }
  if (typeof normalized === 'string') {
    return normalized;
  }
  try {
    return JSON.stringify(normalized, null, space);
  } catch (error) {
    return fallback;
  }
}

