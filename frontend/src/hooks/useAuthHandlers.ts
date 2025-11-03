import { useCallback, useMemo } from 'react';
import type { AuthContextValue } from '../auth/AuthProvider';
import { getKeycloakRuntime } from '../config/client';

export function useAuthHandlers(auth: AuthContextValue) {
  const { url, realm, clientId } = useMemo(() => getKeycloakRuntime(), []);
  const keycloakBase = (url || '').replace(/\/$/, '');

  const handleLogin = useCallback(() => {
    const redirectUri = `${window.location.origin}${window.location.pathname}`;
    void auth.login().catch(() => {
      if (keycloakBase && realm && clientId) {
        const authUrl = `${keycloakBase}/realms/${realm}/protocol/openid-connect/auth?client_id=${encodeURIComponent(
          clientId,
        )}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=openid`;
        window.location.href = authUrl;
      }
    });
  }, [auth, clientId, keycloakBase, realm]);

  const handleLogout = useCallback(async () => {
    const redirectUri = `${window.location.origin}${window.location.pathname}`;
    if (keycloakBase && realm && clientId) {
      const logoutUrl = `${keycloakBase}/realms/${realm}/protocol/openid-connect/logout?client_id=${encodeURIComponent(
        clientId,
      )}&post_logout_redirect_uri=${encodeURIComponent(redirectUri)}`;
      window.location.href = logoutUrl;
      return;
    }
    try {
      await auth.logout();
    } catch {
      // ignore
    } finally {
      window.location.href = redirectUri;
    }
  }, [auth, clientId, keycloakBase, realm]);

  return { handleLogin, handleLogout };
}

