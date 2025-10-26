export function renderInlineValue(value: unknown, limit: number, emptyFallback: string): string {
  const normalized = normalizeValue(value);
  const rendered = renderValue(normalized, 0, 4);
  const flattened = rendered.replace(/\s+/g, ' ').trim();
  return clampText(flattened || emptyFallback, limit);
}

export function clampText(text: string, limit: number): string {
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}

function normalizeValue(value: unknown): unknown {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) {
      return '';
    }
    if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
      try {
        return JSON.parse(trimmed);
      } catch (error) {
        // ignore parse errors and fall back to raw string
      }
    }
    return trimmed;
  }
  return value;
}

function renderValue(value: unknown, depth: number, entryLimit: number): string {
  if (value === null || value === undefined) {
    return 'null';
  }

  if (depth > 3) {
    return '…';
  }

  if (typeof value === 'string') {
    const cleaned = value.replace(/[\t\r\n]+/g, ' ').replace(/"/g, "'");
    return `"${cleaned}"`;
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }

  if (Array.isArray(value)) {
    if (value.length === 0) {
      return '[]';
    }
    const parts = value.slice(0, entryLimit).map((item) => renderValue(item, depth + 1, entryLimit));
    const suffix = value.length > entryLimit ? ', …' : '';
    return `[${parts.join(', ')}${suffix}]`;
  }

  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) {
      return '{}';
    }
    const limited = entries.slice(0, entryLimit).map(([key, val]) => `"${key}": ${renderValue(val, depth + 1, entryLimit)}`);
    const suffix = entries.length > entryLimit ? ', …' : '';
    return `{${limited.join(', ')}${suffix}}`;
  }

  return String(value);
}
