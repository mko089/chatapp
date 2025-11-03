export const LAST_BASE_STORAGE_KEY = 'chatapi:last-base';

export function normalizeBaseUrl(value: string | null | undefined): string {
  if (!value) return '';
  return value.replace(/\/+$/, '');
}

export function resolveApiBaseUrl(): string {
  const explicit = ((typeof window !== 'undefined' && (window as any).__CHATAPP_CONFIG?.chatApiUrl) || (import.meta as any)?.env?.VITE_CHATAPI_URL || '').toString().trim();
  if (explicit) return explicit;

  if (typeof window !== 'undefined') {
    try {
      const persisted = window.localStorage.getItem(LAST_BASE_STORAGE_KEY)?.trim();
      if (persisted) return persisted;
    } catch {}
  }

  if (typeof window !== 'undefined') {
    try {
      const current = new URL(window.location.href);
      const fallbackPort = ((import.meta as any)?.env?.VITE_CHATAPI_PORT as string | undefined) ?? '4025';
      current.port = fallbackPort;
      return current.origin;
    } catch {}
  }

  const fallbackPort = ((import.meta as any)?.env?.VITE_CHATAPI_PORT as string | undefined) ?? '4025';
  return `http://localhost:${fallbackPort}`;
}

export function buildProfileBaseCandidates(current: string): string[] {
  const fallbackPort = ((import.meta as any)?.env?.VITE_CHATAPI_PORT as string | undefined) ?? '4025';
  const candidates = new Set<string>();

  const addCandidate = (value: string | null | undefined) => {
    const normalized = normalizeBaseUrl(value);
    if (normalized) candidates.add(normalized);
  };

  addCandidate(current);

  try {
    const parsed = new URL(current);
    addCandidate(parsed.origin);
    if (parsed.protocol === 'https:') {
      const httpVariant = new URL(parsed.href);
      httpVariant.protocol = 'http:';
      if (!httpVariant.port) httpVariant.port = fallbackPort;
      addCandidate(httpVariant.origin);
    }
  } catch {}

  if (typeof window !== 'undefined') {
    try {
      const fromLocation = new URL(window.location.href);
      fromLocation.port = fromLocation.port || fallbackPort;
      addCandidate(fromLocation.origin);
      if (fromLocation.protocol === 'https:') {
        const httpLocation = new URL(fromLocation.href);
        httpLocation.protocol = 'http:';
        if (!httpLocation.port) httpLocation.port = fallbackPort;
        addCandidate(httpLocation.origin);
      }
    } catch {}
  }

  addCandidate(`http://localhost:${fallbackPort}`);
  addCandidate(`http://127.0.0.1:${fallbackPort}`);

  return Array.from(candidates);
}

