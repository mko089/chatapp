import { useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '../api/queryKeys';
import { DEFAULT_MODEL_ORDER } from '../constants/chat';
import type { HealthResponse } from '../utils/health';

export function useModelsAndHealth(params: {
  baseUrl: string;
  authReady: boolean;
  token: string | null | undefined;
  authorizedFetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  selectedModel: string;
  setSelectedModel: (m: string) => void;
  canManageBudgets?: boolean;
}) {
  const { baseUrl, authReady, token, authorizedFetch, selectedModel, setSelectedModel, canManageBudgets = false } = params;

  const healthQuery = useQuery({
    queryKey: queryKeys.health(baseUrl, token),
    enabled: authReady,
    queryFn: async () => {
      const res = await authorizedFetch(`${baseUrl}/health`);
      if (!res.ok) throw new Error('Nie udało się pobrać statusu backendu');
      return (await res.json()) as HealthResponse;
    },
    refetchInterval: authReady ? 30_000 : false,
  });

  const availableModels = useMemo(() => {
    const modelsFromHealth = healthQuery.data?.openai.allowedModels ?? [];
    const merged = Array.from(new Set([...DEFAULT_MODEL_ORDER, ...modelsFromHealth]));
    return merged;
  }, [healthQuery.data?.openai.allowedModels]);

  useEffect(() => {
    if (availableModels.length > 0 && !availableModels.includes(selectedModel)) {
      setSelectedModel(availableModels[0]);
    }
  }, [availableModels, selectedModel, setSelectedModel]);

  const hasAdminAccess = () => {
    if (canManageBudgets) return true;
    const serverRoles = healthQuery.data?.rbac?.roles ?? [];
    for (const role of serverRoles) {
      const lowered = (role ?? '').toString().toLowerCase();
      if (lowered === 'owner' || lowered === 'admin' || lowered === '*') {
        return true;
      }
    }
    return false;
  };

  return { healthQuery, availableModels, hasAdminAccess };
}
