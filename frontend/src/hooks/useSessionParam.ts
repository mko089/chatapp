import { useCallback } from 'react';

export function useSessionParam() {
  const get = useCallback((): string | null => {
    const params = new URLSearchParams(window.location.search);
    return params.get('session');
  }, []);

  const set = useCallback((id: string) => {
    const params = new URLSearchParams(window.location.search);
    params.set('session', id);
    window.history.replaceState(null, '', `${window.location.pathname}?${params.toString()}`);
  }, []);

  return { get, set };
}

