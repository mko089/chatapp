import { useCallback } from 'react';
import { useAuth } from '../auth/AuthProvider';

export function useAuthorizedFetch() {
  const { token } = useAuth();

  return useCallback(
    async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const headers = new Headers(
        init.headers ?? (input instanceof Request ? input.headers : undefined),
      );

      if (token) {
        headers.set('Authorization', `Bearer ${token}`);
      }

      const requestInit: RequestInit = {
        ...init,
        headers,
      };

      if (input instanceof Request) {
        return fetch(new Request(input, requestInit));
      }

      return fetch(input, requestInit);
    },
    [token],
  );
}
