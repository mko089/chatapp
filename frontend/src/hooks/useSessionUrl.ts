import { useCallback, useRef, useState } from 'react';

export function useSessionUrl() {
  const [sessionId, setSessionIdState] = useState<string | null>(null);
  const initialisedRef = useRef(false);

  const setSessionId = useCallback((id: string) => {
    setSessionIdState(id);
    try {
      const params = new URLSearchParams(window.location.search);
      params.set('session', id);
      window.history.replaceState(null, '', `${window.location.pathname}?${params.toString()}`);
    } catch {}
  }, []);

  const ensureSessionId = useCallback((): { id: string | null; created: boolean } => {
    if (initialisedRef.current) {
      return { id: sessionId, created: false };
    }
    try {
      const params = new URLSearchParams(window.location.search);
      const existing = params.get('session');
      if (existing && existing.trim().length > 0) {
        setSessionIdState(existing);
        initialisedRef.current = true;
        return { id: existing, created: false };
      }
      const generated = (globalThis as any).crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2);
      params.set('session', generated);
      window.history.replaceState(null, '', `${window.location.pathname}?${params.toString()}`);
      setSessionIdState(generated);
      initialisedRef.current = true;
      return { id: generated, created: true };
    } catch {
      return { id: sessionId, created: false };
    }
  }, [sessionId]);

  const resetInitialised = useCallback(() => {
    initialisedRef.current = false;
  }, []);

  return { sessionId, setSessionId, ensureSessionId, resetInitialised };
}

