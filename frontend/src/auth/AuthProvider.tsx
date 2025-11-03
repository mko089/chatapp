import { type KeycloakInstance, type KeycloakTokenParsed, type KeycloakInitOptions } from 'keycloak-js';
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

import { resolveKeycloakConfig as resolveKcCfg } from './config';
import { createKeycloak } from './keycloakAdapter';
import { LAST_BASE_STORAGE_KEY, resolveApiBaseUrl as resolveApiBaseUrlExt, buildProfileBaseCandidates as buildProfileBaseCandidatesExt } from '../utils/apiBase';

type AuthUser = {
  sub?: string;
  name?: string;
  username?: string;
  email?: string;
  accountId?: string;
  roles: string[];
};

type AuthServerProfile = {
  user?: {
    sub: string;
    email: string | null;
    name: string | null;
    username: string | null;
    accountId: string | null;
    roles: string[];
    issuedAt: string | null;
    expiresAt: string | null;
  };
  diagnostics: {
    identityHints: string[];
    normalizedRoles: string[];
    adminCandidates: string[];
    ownerCandidates: string[];
    isSuperAdmin: boolean;
  };
  config: {
    rbac: {
      ownerUsers: string[];
      adminUsers: string[];
      defaultRoles: string[];
      fallbackRoles: string[];
    };
    auth: {
      issuer: string | null;
      audience: string | null;
      optionalAuthPaths: string[];
      publicPaths: string[];
    };
  };
};

export type AuthContextValue = {
  enabled: boolean;
  ready: boolean;
  isAuthenticated: boolean;
  token: string | null;
  user?: AuthUser;
  serverProfile: AuthServerProfile | null;
  isSuperAdmin: boolean;
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
  serverProfile: null,
  isSuperAdmin: false,
  error: null,
  login: async () => {},
  logout: async () => {},
  refresh: async () => null,
};

const AuthContext = createContext<AuthContextValue>(defaultAuthValue);

// config type moved to ./config

// resolveKeycloakConfig moved to ./config

// resolveApiBaseUrl moved to utils/apiBase

// normalizeBaseUrl moved to utils/apiBase

// buildProfileBaseCandidates moved to utils/apiBase

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
  const keycloakConfig = useMemo(resolveKcCfg, []);
  const [state, setState] = useState<AuthContextValue>(() => ({
    enabled: keycloakConfig.enabled,
    ready: !keycloakConfig.enabled,
    // Never assume authenticated when Keycloak is disabled; require explicit login
    isAuthenticated: false,
    token: null,
    user: undefined,
    serverProfile: null,
    isSuperAdmin: false,
    error: keycloakConfig.error ?? null,
    login: async () => {},
    logout: async () => {},
    refresh: async () => null,
  }));

  const keycloakRef = useRef<KeycloakInstance | null>(null);
  const apiBaseUrlRef = useRef<string>(resolveApiBaseUrlExt());

  const refreshServerProfile = useCallback(async (token: string | null) => {
    if (!token) {
      setState((prev) => ({
        ...prev,
        serverProfile: null,
        isSuperAdmin: false,
      }));
      return null;
    }

    const bases = buildProfileBaseCandidatesExt(apiBaseUrlRef.current);
    let lastError: unknown = null;

    for (const base of bases) {
      try {
        const response = await fetch(`${base}/auth/profile`, {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/json',
          },
        });

        if (!response.ok) {
          lastError = new Error(`Profile fetch failed (${response.status})`);
          // Tolerate non-401 errors during base discovery (e.g. 404 from dev server
          // when using a stale /api prefix). Only stop immediately on 401, which
          // indicates an invalid or missing token and will not be fixed by
          // switching origins.
          if (response.status !== 401) {
            continue;
          }
          break;
        }

        const payload = (await response.json()) as AuthServerProfile;

        apiBaseUrlRef.current = base;
        if (typeof window !== 'undefined') {
          try {
            window.localStorage.setItem(LAST_BASE_STORAGE_KEY, base);
          } catch {
            // ignore storage errors (e.g. quota exceeded)
          }
        }

        setState((prev) => {
          const serverUser = payload.user;
          const mergedUser: AuthUser | undefined = serverUser
            ? (() => {
                const normalised = normaliseServerUser(serverUser);
                const mergedRoles = Array.from(
                  new Set([...(prev.user?.roles ?? []), ...normalised.roles]),
                );
                return {
                  ...prev.user,
                  ...normalised,
                  roles: mergedRoles,
                };
              })()
            : prev.user;

          return {
            ...prev,
            user: mergedUser,
            serverProfile: payload,
            isSuperAdmin: Boolean(payload?.diagnostics?.isSuperAdmin),
          };
        });

        return payload;
      } catch (error) {
        lastError = error;
        const message = error instanceof Error ? error.message : String(error ?? '');
        const isNetworkIssue = error instanceof TypeError || /Failed to fetch|NetworkError|ERR_/i.test(message);
        if (isNetworkIssue) {
          continue;
        }
        break;
      }
    }

    if (lastError) {
      // W dev często testujemy różne originy; zmniejszamy hałas w konsoli
      // i logujemy jako info.
      console.info('Nie udało się pobrać profilu użytkownika z backendu', lastError);
    }

    setState((prev) => ({
      ...prev,
      serverProfile: null,
      isSuperAdmin: false,
    }));
    return null;
  }, []);

  const updateFromInstance = useCallback(
    (kc: KeycloakInstance | null, options?: { authenticated?: boolean; error?: string | null }) => {
      if (!kc) {
        setState((prev) => ({
          ...prev,
          enabled: keycloakConfig.enabled,
          ready: !keycloakConfig.enabled,
          isAuthenticated: keycloakConfig.enabled ? false : prev.isAuthenticated,
          token: null,
          user: keycloakConfig.enabled ? undefined : prev.user,
          serverProfile: null,
          isSuperAdmin: false,
          error: options?.error ?? keycloakConfig.error ?? null,
        }));
        if (keycloakConfig.enabled) {
          void refreshServerProfile(null);
        }
        return;
      }

      const authenticated = options?.authenticated ?? Boolean(kc.authenticated && kc.token);

      setState((prev) => ({
        ...prev,
        enabled: true,
        ready: true,
        isAuthenticated: authenticated,
        token: authenticated ? kc.token ?? null : null,
        user: authenticated ? buildUser(kc.tokenParsed, keycloakConfig.clientId) : undefined,
        serverProfile: authenticated ? prev.serverProfile : null,
        isSuperAdmin: authenticated ? prev.isSuperAdmin : false,
        error: options?.error ?? null,
      }));

      void refreshServerProfile(authenticated && kc.token ? kc.token : null);
    },
    [keycloakConfig.clientId, keycloakConfig.enabled, keycloakConfig.error, refreshServerProfile],
  );

  useEffect(() => {
    if (!keycloakConfig.enabled) {
      updateFromInstance(null);
      return;
    }

    const keycloak = createKeycloak(keycloakConfig);

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
      // Fallback: spróbuj przekierować bezpośrednio na endpoint Keycloak
      console.error('Keycloak login failed, redirecting directly to Keycloak', error);
      try {
        const redirectUri = typeof window !== 'undefined' ? (window.location.origin + window.location.pathname) : '';
        const base = keycloakConfig.url.replace(/\/$/, '');
        const url = `${base}/realms/${keycloakConfig.realm}/protocol/openid-connect/auth?client_id=${encodeURIComponent(
          keycloakConfig.clientId,
        )}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=openid`;
        if (redirectUri) {
          window.location.href = url;
          return;
        }
      } catch (e) {
        // ignore
      }
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
      serverProfile: state.serverProfile,
      isSuperAdmin: state.isSuperAdmin,
      error: state.error,
      login,
      logout,
      refresh,
    }),
    [
      login,
      refresh,
      logout,
      state.enabled,
      state.error,
      state.isAuthenticated,
      state.ready,
      state.token,
      state.user,
      state.serverProfile,
      state.isSuperAdmin,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  return useContext(AuthContext);
}
function normaliseServerUser(user: NonNullable<AuthServerProfile['user']>): AuthUser {
  return {
    sub: user.sub ?? undefined,
    name: user.name ?? undefined,
    username: user.username ?? undefined,
    email: user.email ?? undefined,
    accountId: user.accountId ?? undefined,
    roles: Array.isArray(user.roles) ? user.roles : [],
  };
}
