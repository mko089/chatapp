export type RuntimeConfig = NonNullable<typeof window.__CHATAPP_CONFIG>;

const getRC = (): RuntimeConfig => ({ ...(window.__CHATAPP_CONFIG || {}) });

export function getInitialApiBaseUrl(): string {
  const rc = getRC();
  const explicit = (rc.chatApiUrl || '').toString().trim();
  if (explicit) return explicit;

  if (typeof window !== 'undefined') {
    try {
      const persisted = window.localStorage.getItem('chatapi:last-base')?.trim();
      if (persisted) return persisted;
    } catch {}
  }

  const fallbackPort = (typeof import.meta !== 'undefined' && (import.meta as any)?.env?.VITE_CHATAPI_PORT) || '4025';
  if (typeof window !== 'undefined') {
    try {
      const u = new URL(window.location.href);
      u.port = fallbackPort;
      return u.origin;
    } catch {}
  }
  return `http://localhost:${fallbackPort}`;
}

export function getChatStreamingEnabled(): boolean {
  const rc = getRC();
  if (typeof rc.chatStreaming !== 'undefined') {
    const v = rc.chatStreaming;
    if (typeof v === 'boolean') return v;
    return v.toString().toLowerCase() !== 'false' && v.toString() !== '0';
  }
  const raw = (typeof import.meta !== 'undefined' && (import.meta as any)?.env?.VITE_CHAT_STREAMING) ?? 'false';
  return raw.toString().toLowerCase() !== 'false' && raw.toString() !== '0';
}

export function getKeycloakRuntime() {
  const rc = getRC();
  const kc = rc.keycloak || {};
  const enabledRaw = kc.enabled ?? ((typeof import.meta !== 'undefined' && (import.meta as any)?.env?.VITE_KEYCLOAK_ENABLED) ?? 'false');
  const enabled = enabledRaw.toString().toLowerCase() !== 'false' && enabledRaw.toString() !== '0' && enabledRaw.toString() !== '';
  const pick = (...values: unknown[]) => {
    for (const v of values) {
      if (v === undefined || v === null) continue;
      const s = v.toString().trim();
      if (s.length > 0) return s;
    }
    return '';
  };

  const url = pick(kc.url, ((typeof import.meta !== 'undefined' && (import.meta as any)?.env?.VITE_KEYCLOAK_URL) || ''));
  const realm = pick(kc.realm, ((typeof import.meta !== 'undefined' && (import.meta as any)?.env?.VITE_KEYCLOAK_REALM) || ''));
  const clientId = pick(kc.clientId, ((typeof import.meta !== 'undefined' && (import.meta as any)?.env?.VITE_KEYCLOAK_CLIENT_ID) || ''));
  const providedSilent = pick(kc.silentCheckSso, ((typeof import.meta !== 'undefined' && (import.meta as any)?.env?.VITE_KEYCLOAK_SILENT_CHECK_SSO) || ''));
  const silentCheckSso = providedSilent || (typeof window !== 'undefined' ? `${window.location.origin}/silent-check-sso.html` : '');

  return { enabled, url, realm, clientId, silentCheckSso };
}
