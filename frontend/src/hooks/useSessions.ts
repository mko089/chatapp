import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ApiClient } from '../api/client';
import type { SessionSummary } from '../types';

export function useSessions(params: {
  authReady: boolean;
  client: ApiClient;
  isSuperAdmin: boolean;
  currentUserId: string;
  setSessionParam?: (id: string) => void;
}) {
  const { authReady, client, isSuperAdmin, currentUserId, setSessionParam } = params;
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sessionFilter, setSessionFilter] = useState<'all' | 'self' | string>('self');
  const [knownOwners, setKnownOwners] = useState<string[]>([]);

  const refresh = useCallback(async (opts: { silent?: boolean } = {}) => {
    if (!authReady) return;
    const { silent = false } = opts;
    if (!silent) {
      setIsLoading(true);
      setError(null);
    }
    try {
      let scope: 'all' | undefined;
      let userId: string | undefined;
      if (isSuperAdmin) {
        if (sessionFilter === 'all') scope = 'all';
        else userId = sessionFilter === 'self' ? currentUserId : sessionFilter || undefined;
      }
      const list = await client.getSessions({ scope, userId });
      setSessions(list);
      if (isSuperAdmin) {
        setKnownOwners((prev) => {
          const merged = new Set(prev);
          if (currentUserId) merged.add(currentUserId);
          for (const entry of list) {
            const ownerId = entry.userId?.trim();
            if (ownerId) merged.add(ownerId);
          }
          return Array.from(merged).sort((a, b) => a.localeCompare(b));
        });
      }
      if (silent) setError(null);
    } catch (e) {
      if (!opts.silent) setError(e instanceof Error ? e.message : 'Nie udało się pobrać listy sesji');
    } finally {
      setIsLoading(false);
    }
  }, [authReady, client, isSuperAdmin, sessionFilter, currentUserId]);

  useEffect(() => {
    setSessionFilter(isSuperAdmin ? 'all' : 'self');
  }, [isSuperAdmin]);

  useEffect(() => {
    if (!authReady) return;
    void refresh({ silent: true });
  }, [authReady, refresh]);

  useEffect(() => {
    if (!authReady) return;
    void refresh({ silent: true });
  }, [sessionFilter, authReady, refresh]);

  useEffect(() => {
    if (!currentUserId) return;
    setKnownOwners((prev) => {
      if (prev.includes(currentUserId)) return prev;
      const next = [...prev, currentUserId].sort((a, b) => a.localeCompare(b));
      return next;
    });
  }, [currentUserId]);

  const availableSessionOwners = useMemo(() => {
    const base = new Set<string>();
    for (const owner of knownOwners) {
      if (owner && owner.trim().length > 0) base.add(owner.trim());
    }
    if (currentUserId) base.add(currentUserId);
    if (sessionFilter !== 'all' && sessionFilter !== 'self' && typeof sessionFilter === 'string' && sessionFilter.trim().length > 0) {
      base.add(sessionFilter.trim());
    }
    return Array.from(base).sort((a, b) => a.localeCompare(b));
  }, [knownOwners, currentUserId, sessionFilter]);

  const handleSessionFilterChange = useCallback((value: string) => {
    if (!isSuperAdmin) return;
    if (value === 'all' || value === 'self') setSessionFilter(value);
    else setSessionFilter(value);
  }, [isSuperAdmin]);

  return {
    sessions,
    isLoading,
    error,
    refresh,
    sessionFilter,
    setSessionFilter,
    handleSessionFilterChange,
    availableSessionOwners,
    knownOwners,
    async createSession() {
      const newId = (globalThis as any).crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2);
      if (setSessionParam) {
        try { setSessionParam(newId); } catch {}
      }
      try { await client.createStubSession(newId); } catch {}
      await refresh({ silent: true });
      return newId;
    },
    async navigateToSession(id: string) {
      if (!id) return;
      if (setSessionParam) {
        try { setSessionParam(id); } catch {}
      }
      await refresh({ silent: true });
    },
    async deleteSession(id: string) {
      await client.deleteSession(id);
      await refresh({ silent: true });
    },
  };
}
