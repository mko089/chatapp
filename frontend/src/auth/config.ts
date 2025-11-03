import type { KeycloakInitOptions } from 'keycloak-js';

export type KeycloakConfigShape = {
  enabled: boolean;
  url: string;
  realm: string;
  clientId: string;
  checkSso: boolean;
  silentCheckSsoUrl?: string;
  initOptions: KeycloakInitOptions;
  error?: string | null;
};

export function resolveKeycloakConfig(): KeycloakConfigShape {
  const rc = (typeof window !== 'undefined' ? (window as any).__CHATAPP_CONFIG : undefined) || {};
  const kc = (rc as any).keycloak || {};
  const flagRaw = (kc.enabled ?? (import.meta as any)?.env?.VITE_KEYCLOAK_ENABLED ?? 'false').toString().trim().toLowerCase();
  const flagEnabled = flagRaw !== 'false' && flagRaw !== '0' && flagRaw !== '';

  const pick = (...values: unknown[]) => {
    for (const v of values) {
      if (v === undefined || v === null) continue;
      const s = v.toString().trim();
      if (s.length > 0) return s;
    }
    return '';
  };

  const url = pick(kc.url, (import.meta as any)?.env?.VITE_KEYCLOAK_URL);
  const realm = pick(kc.realm, (import.meta as any)?.env?.VITE_KEYCLOAK_REALM);
  const clientId = pick(kc.clientId, (import.meta as any)?.env?.VITE_KEYCLOAK_CLIENT_ID);

  const checkSsoRaw = (kc.checkSso ?? (import.meta as any)?.env?.VITE_KEYCLOAK_CHECK_SSO ?? 'true').toString().trim().toLowerCase();
  const checkSso = !(checkSsoRaw === 'false' || checkSsoRaw === '0' || checkSsoRaw === '');

  const providedSilent = (kc.silentCheckSso ?? (import.meta as any)?.env?.VITE_KEYCLOAK_SILENT_CHECK_SSO ?? '').toString().trim();
  const silentCheckSsoUrl = checkSso
    ? ((providedSilent.length > 0
        ? providedSilent
        : (typeof window !== 'undefined' ? `${window.location.origin}/silent-check-sso.html` : '')) || undefined)
    : undefined;

  const hasConfig = Boolean(url && realm && clientId);
  const enabled = flagEnabled && hasConfig;

  const error = flagEnabled && !hasConfig
    ? 'Brakuje konfiguracji Keycloak (URL, realm lub clientId). Autoryzacja została tymczasowo wyłączona.'
    : null;

  return {
    enabled,
    url,
    realm,
    clientId,
    checkSso,
    silentCheckSsoUrl,
    initOptions: {
      ...(checkSso ? { onLoad: 'check-sso' as const } : {}),
      checkLoginIframe: false,
      enableLogging: false,
      pkceMethod: 'S256',
      ...(checkSso && silentCheckSsoUrl ? { silentCheckSsoRedirectUri: silentCheckSsoUrl } : {}),
      silentCheckSsoFallback: Boolean(checkSso && silentCheckSsoUrl),
    },
    error,
  };
}

