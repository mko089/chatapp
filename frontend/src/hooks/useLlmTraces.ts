import { useCallback, useState } from 'react';
import type { ApiClient } from '../api/client';

export function useLlmTraces(params: { authReady: boolean; client: ApiClient; sessionId: string | null }) {
  const { authReady, client, sessionId } = params;
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!authReady || !sessionId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await client.getLlmTraces(sessionId, 200);
      setItems(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Nie udało się pobrać logów LLM');
    } finally {
      setLoading(false);
    }
  }, [authReady, client, sessionId]);

  const openModal = useCallback(() => {
    setOpen(true);
    setItems([]);
    setError(null);
    setLoading(true);
    void refresh();
  }, [refresh]);

  const closeModal = useCallback(() => setOpen(false), []);

  return { open, openModal, closeModal, items, loading, error, refresh };
}

