import { useMemo } from 'react';
import type { AuthContextValue } from '../auth/AuthProvider';

export function useAuthGate(auth: AuthContextValue) {
  const authed = auth.isAuthenticated;
  const authLoading = auth.enabled && !auth.ready;
  const requireAuth = useMemo(() => {
    try {
      const rc = (typeof window !== 'undefined' ? (window as any).__CHATAPP_CONFIG : undefined) || {};
      const raw = (rc.requireAuth ?? (import.meta as any)?.env?.VITE_REQUIRE_AUTH ?? 'true').toString().trim().toLowerCase();
      return !(raw === 'false' || raw === '0' || raw === '');
    } catch {
      return true;
    }
  }, []);
  const requiresLogin = !authed && !authLoading && requireAuth;
  return { authed, authLoading, requireAuth, requiresLogin };
}

