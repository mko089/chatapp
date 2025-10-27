import Keycloak, { type KeycloakInstance, type KeycloakInitOptions, type KeycloakTokenParsed } from 'keycloak-js';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

type AuthUser = {
  sub?: string;
  name?: string;
  username?: string;
  email?: string;
  accountId?: string;
  roles: string[];
};

type AuthContextValue = {
  enabled: boolean;
  ready: boolean;
  isAuthenticated: boolean;
  token: string | null;
  user?: AuthUser;
  error: string | null;
  login: () => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<string | null>;
};

const defaultAuthValue: AuthContextValue = {
  enabled: false,
  ready: true,
  isAuthenticated: true,
  token: null,
  user: undefined,
  error: null,
  login: async () => {},
  logout: async () => {},
  refresh: async () => null,
};

const AuthContext = createContext<AuthContextValue>(defaultAuthValue);

type KeycloakConfigShape = {
  enabled: boolean;
  url: string;
  realm: string;
  clientId: string;
  silentCheckSsoUrl?: string;
  initOptions: KeycloakInitOptions;
  error?: string | null;
};

function resolveKeycloakConfig(): KeycloakConfigShape {
  const flagRaw = (import.meta.env.VITE_KEYCLOAK_ENABLED ?? 'false').toString().trim().toLowerCase();
  const flagEnabled = flagRaw !== 'false' && flagRaw !== '0' && flagRaw !== '';

  const url = (import.meta.env.VITE_KEYCLOAK_URL ?? '').toString().trim();
  const realm = (import.meta.env.VITE_KEYCLOAK_REALM ?? '').toString().trim();
  const clientId = (import.meta.env.VITE_KEYCLOAK_CLIENT_ID ?? '').toString().trim();
  const providedSilent = (import.meta.env.VITE_KEYCLOAK_SILENT_CHECK_SSO ?? '').toString().trim();
  const silentCheckSsoUrl = (providedSilent.length > 0
    ? providedSilent
    : (typeof window !== 'undefined' ? `${window.location.origin}/silent-check-sso.html` : '')
  ) || undefined;

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
    silentCheckSsoUrl,
    initOptions: {
      onLoad: 'check-sso',
      checkLoginIframe: false,
      enableLogging: false,
      pkceMethod: 'S256',
      // Use silent SSO via iframe when available to avoid full-page redirects
      silentCheckSsoRedirectUri: silentCheckSsoUrl,
      // Prevent redirect fallback when silent SSO fails (e.g., HTTP context or 3rd-party cookies blocked)
      silentCheckSsoFallback: false,
      // Ensure the redirect lands back on the app root without hash fragments
      redirectUri: typeof window !== 'undefined' ? `${window.location.origin}${window.location.pathname}` : undefined,
    },
    error,
  };
}

function collectRoles(token: KeycloakTokenParsed | undefined, clientId: string): string[] {
  if (!token) {
    return [];
  }

  const roles = new Set<string>();

  const realmRoles = (token.realm_access?.roles ?? []) as unknown;
  if (Array.isArray(realmRoles)) {
    for (const role of realmRoles) {
      if (typeof role === 'string' && role.length > 0) {
        roles.add(role);
      }
    }
  }

  const resourceAccess = token.resource_access as Record<string, { roles?: string[] }> | undefined;
  if (resourceAccess && typeof resourceAccess === 'object') {
    const candidateResources = [clientId, ...Object.keys(resourceAccess)];
    for (const key of candidateResources) {
      const resource = resourceAccess[key];
      if (!resource) continue;
      const resourceRoles = resource.roles ?? [];
      if (!Array.isArray(resourceRoles)) continue;
      for (const role of resourceRoles) {
        if (typeof role === 'string' && role.length > 0) {
          roles.add(role);
        }
      }
    }
  }

  const groups = token.groups as unknown;
  if (Array.isArray(groups)) {
    for (const group of groups) {
      if (typeof group === 'string' && group.length > 0) {
        roles.add(group);
      }
    }
  }

  return [...roles];
}

function extractAccountId(token: KeycloakTokenParsed | undefined): string | undefined {
  if (!token) {
    return undefined;
  }

  const candidateKeys = ['accountId', 'account_id', 'account', 'tenant', 'tenantId', 'orgId', 'organizationId'];
  for (const key of candidateKeys) {
    const value = (token as Record<string, unknown>)[key];
    if (typeof value === 'string' && value.length > 0) {
      return value;
    }
  }
  return undefined;
}

function buildUser(token: KeycloakTokenParsed | undefined, clientId: string): AuthUser | undefined {
  if (!token) {
    return undefined;
  }

  return {
    sub: typeof token.sub === 'string' ? token.sub : undefined,
    name: typeof token.name === 'string' ? token.name : undefined,
    username: typeof token.preferred_username === 'string' ? token.preferred_username : undefined,
    email: typeof token.email === 'string' ? token.email : undefined,
    accountId: extractAccountId(token),
    roles: collectRoles(token, clientId),
  };
}

type AuthProviderProps = {
  children: ReactNode;
};

export function AuthProvider({ children }: AuthProviderProps) {
  const keycloakConfig = useMemo(resolveKeycloakConfig, []);
  const [state, setState] = useState<AuthContextValue>(() => ({
    enabled: keycloakConfig.enabled,
    ready: !keycloakConfig.enabled,
    isAuthenticated: !keycloakConfig.enabled,
    token: null,
    user: undefined,
    error: keycloakConfig.error ?? null,
    login: async () => {},
    logout: async () => {},
    refresh: async () => null,
  }));

  const keycloakRef = useRef<KeycloakInstance | null>(null);

  const updateFromInstance = useCallback(
    (kc: KeycloakInstance | null, options?: { authenticated?: boolean; error?: string | null }) => {
      if (!kc) {
        setState((prev) => ({
          ...prev,
          enabled: keycloakConfig.enabled,
          ready: !keycloakConfig.enabled,
          isAuthenticated: !keycloakConfig.enabled,
          token: null,
          user: undefined,
          error: options?.error ?? keycloakConfig.error ?? null,
        }));
        return;
      }

      const authenticated = options?.authenticated ?? Boolean(kc.authenticated && kc.token);

      setState({
        enabled: true,
        ready: true,
        isAuthenticated: authenticated,
        token: authenticated ? kc.token ?? null : null,
        user: authenticated ? buildUser(kc.tokenParsed, keycloakConfig.clientId) : undefined,
        error: options?.error ?? null,
        login: async () => {},
        logout: async () => {},
        refresh: async () => null,
      });
    },
    [keycloakConfig.clientId, keycloakConfig.enabled, keycloakConfig.error],
  );

  useEffect(() => {
    if (!keycloakConfig.enabled) {
      updateFromInstance(null);
      return;
    }

    const keycloak = new Keycloak({
      url: keycloakConfig.url,
      realm: keycloakConfig.realm,
      clientId: keycloakConfig.clientId,
    });

    keycloakRef.current = keycloak;
    let cancelled = false;

    const applyAuthenticatedState = (authenticated: boolean) => {
      if (cancelled) return;
      updateFromInstance(keycloak, { authenticated, error: null });
    };

    const applyErrorState = (message: string) => {
      if (cancelled) return;
      updateFromInstance(keycloak, { authenticated: false, error: message });
    };

    keycloak
      .init(keycloakConfig.initOptions)
      .then((authenticated) => {
        applyAuthenticatedState(Boolean(authenticated));
      })
      .catch((error) => {
        console.error('Keycloak init failed', error);
        applyErrorState('Nie udało się połączyć z usługą logowania.');
      });

    keycloak.onAuthSuccess = () => {
      applyAuthenticatedState(true);
    };

    keycloak.onAuthError = (error) => {
      console.error('Keycloak authentication error', error);
      applyErrorState('Wystąpił problem podczas logowania.');
    };

    keycloak.onAuthLogout = () => {
      applyAuthenticatedState(false);
    };

    keycloak.onTokenExpired = async () => {
      try {
        await keycloak.updateToken(60);
        applyAuthenticatedState(true);
      } catch (error) {
        console.warn('Token refresh failed', error);
        applyErrorState('Sesja wygasła — zaloguj się ponownie.');
      }
    };

    return () => {
      cancelled = true;
      keycloakRef.current = null;
    };
  }, [keycloakConfig, updateFromInstance]);

  const login = useCallback(async () => {
    if (!keycloakConfig.enabled) {
      return;
    }
    if (!keycloakRef.current) {
      updateFromInstance(null, { error: 'Logowanie nie jest gotowe. Spróbuj ponownie za chwilę.' });
      return;
    }

    try {
      await keycloakRef.current.login();
    } catch (error) {
      console.error('Keycloak login failed', error);
      updateFromInstance(keycloakRef.current, { authenticated: false, error: 'Nie udało się rozpocząć logowania.' });
    }
  }, [keycloakConfig.enabled, updateFromInstance]);

  const logout = useCallback(async () => {
    if (!keycloakConfig.enabled) {
      return;
    }
    if (!keycloakRef.current) {
      return;
    }

    try {
      await keycloakRef.current.logout({ redirectUri: window.location.origin + window.location.pathname });
    } catch (error) {
      console.error('Keycloak logout failed', error);
      updateFromInstance(keycloakRef.current, { authenticated: false, error: 'Wylogowanie nie powiodło się.' });
    }
  }, [keycloakConfig.enabled, updateFromInstance]);

  const refresh = useCallback(async () => {
    if (!keycloakConfig.enabled || !keycloakRef.current) {
      return null;
    }

    try {
      const refreshed = await keycloakRef.current.updateToken(60);
      if (refreshed) {
        updateFromInstance(keycloakRef.current, { authenticated: true, error: null });
      }
      return keycloakRef.current.token ?? null;
    } catch (error) {
      console.warn('Token refresh failed', error);
      updateFromInstance(keycloakRef.current, { authenticated: false, error: 'Sesja wygasła — zaloguj się ponownie.' });
      return null;
    }
  }, [keycloakConfig.enabled, updateFromInstance]);

  const value = useMemo<AuthContextValue>(
    () => ({
      enabled: state.enabled,
      ready: state.ready,
      isAuthenticated: state.isAuthenticated,
      token: state.token,
      user: state.user,
      error: state.error,
      login,
      logout,
      refresh,
    }),
    [login, refresh, logout, state.enabled, state.error, state.isAuthenticated, state.ready, state.token, state.user],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  return useContext(AuthContext);
}
