import { useEffect, useRef } from 'react';

export function useSessionContextSync(params: {
  enabled: boolean;
  sessionId: string | null;
  baseUrl: string;
  authorizedFetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  projectId: string | null;
  currentDocPath: string | null;
  debounceMs?: number;
}) {
  const { enabled, sessionId, baseUrl, authorizedFetch, projectId, currentDocPath, debounceMs = 300 } = params;
  const lastSerializedRef = useRef<string>('');
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!enabled || !sessionId) {
      return;
    }
    const payload = { projectId, currentDocPath };
    const serialized = JSON.stringify(payload);
    if (serialized === lastSerializedRef.current) {
      return;
    }
    if (timerRef.current) {
      clearTimeout(timerRef.current as any);
    }
    timerRef.current = setTimeout(() => {
      lastSerializedRef.current = serialized;
      void authorizedFetch(`${baseUrl}/sessions/${sessionId}/context`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: serialized,
      }).catch(() => {});
    }, debounceMs);

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current as any);
        timerRef.current = null;
      }
    };
  }, [enabled, sessionId, baseUrl, authorizedFetch, projectId, currentDocPath, debounceMs]);
}
