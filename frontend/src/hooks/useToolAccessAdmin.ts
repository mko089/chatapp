import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  RoleToolGroupPermissionRecord,
  RoleToolPermissionRecord,
  ToolAccessMatrix,
  ToolDefinitionRecord,
} from '../types';
import { useAuthorizedFetch } from './useAuthorizedFetch';

type AuthorizedFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export type PendingChange = {
  type: 'group' | 'tool';
  role: string;
  targetId: string;
  allowed: boolean | null;
  reason?: string | null;
};

function getGroupKey(role: string, groupId: string) {
  return `group:${role}:${groupId}`;
}

function getToolKey(role: string, toolId: string) {
  return `tool:${role}:${toolId}`;
}

function stateFromPermission(record: RoleToolGroupPermissionRecord | RoleToolPermissionRecord | undefined): 'allow' | 'deny' | 'inherit' {
  if (!record) return 'inherit';
  return record.allowed ? 'allow' : 'deny';
}

export function useToolAccessAdmin(baseUrl: string, open: boolean) {
  const authorizedFetch = useAuthorizedFetch() as AuthorizedFetch;
  const queryClient = useQueryClient();
  const [pendingChanges, setPendingChanges] = useState<Map<string, PendingChange>>(new Map());
  const [selectedRole, setSelectedRole] = useState<string | null>(null);
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const matrixQuery = useQuery({
    queryKey: ['tool-access-matrix'],
    enabled: open,
    queryFn: async (): Promise<ToolAccessMatrix> => {
      const response = await authorizedFetch(`${baseUrl}/admin/tool-access`);
      if (!response.ok) {
        throw new Error(`Nie udało się pobrać konfiguracji narzędzi (${response.status})`);
      }
      const data = (await response.json()) as { matrix: ToolAccessMatrix };
      return data.matrix;
    },
  });

  const matrix = matrixQuery.data;

  const roles = useMemo(() => (matrix ? [...matrix.roles].sort((a, b) => a.localeCompare(b)) : []), [matrix]);
  const groups = useMemo(() => {
    if (!matrix) return [];
    return [...matrix.groups].sort((a, b) => {
      const orderDiff = (a.group.sortOrder ?? 0) - (b.group.sortOrder ?? 0);
      if (orderDiff !== 0) return orderDiff;
      return a.group.name.localeCompare(b.group.name);
    });
  }, [matrix]);

  useEffect(() => {
    if (!open) {
      setPendingChanges(new Map());
      setSelectedRole(null);
      setSelectedGroupId(null);
      setSaveError(null);
      return;
    }
    if (matrix) {
      if (!selectedRole || !matrix.roles.includes(selectedRole)) {
        setSelectedRole(matrix.roles[0] ?? null);
      }
      if (!selectedGroupId || !matrix.groups.some((entry) => entry.group.id === selectedGroupId)) {
        setSelectedGroupId(matrix.groups[0]?.group.id ?? null);
      }
    }
  }, [open, matrix, selectedRole, selectedGroupId]);

  const originalGroupState = (role: string, groupId: string): 'allow' | 'deny' | 'inherit' => {
    if (!matrix) return 'inherit';
    const entry = matrix.groupPermissions[role]?.[groupId];
    return stateFromPermission(entry);
  };
  const groupState = (role: string, groupId: string): 'allow' | 'deny' | 'inherit' => {
    const key = getGroupKey(role, groupId);
    const pending = pendingChanges.get(key);
    if (pending) return pending.allowed === null ? 'inherit' : pending.allowed ? 'allow' : 'deny';
    return originalGroupState(role, groupId);
  };

  const originalToolState = (role: string, toolId: string): 'allow' | 'deny' | 'inherit' => {
    if (!matrix) return 'inherit';
    const entry = matrix.toolPermissions[role]?.[toolId];
    return stateFromPermission(entry);
  };
  const toolState = (role: string, toolId: string): 'allow' | 'deny' | 'inherit' => {
    const key = getToolKey(role, toolId);
    const pending = pendingChanges.get(key);
    if (pending) return pending.allowed === null ? 'inherit' : pending.allowed ? 'allow' : 'deny';
    return originalToolState(role, toolId);
  };
  const toolReason = (role: string, toolId: string): string => {
    const key = getToolKey(role, toolId);
    const pending = pendingChanges.get(key);
    if (pending && pending.reason !== undefined && pending.reason !== null) return pending.reason;
    if (!matrix) return '';
    const original = matrix.toolPermissions[role]?.[toolId];
    return original?.reason ?? '';
  };

  const updatePendingChanges = (updater: (prev: Map<string, PendingChange>) => Map<string, PendingChange>) => {
    setPendingChanges((prev) => updater(new Map(prev)));
  };

  const setGroupState = (role: string, groupId: string, state: 'allow' | 'deny' | 'inherit') => {
    if (!matrix) return;
    const original = originalGroupState(role, groupId);
    const desiredAllowed = state === 'inherit' ? null : state === 'allow';
    const originalAllowed = original === 'inherit' ? null : original === 'allow';
    updatePendingChanges((draft) => {
      const key = getGroupKey(role, groupId);
      if (desiredAllowed === originalAllowed) {
        draft.delete(key);
      } else {
        draft.set(key, { type: 'group', role, targetId: groupId, allowed: desiredAllowed });
      }
      return draft;
    });
  };

  const setToolState = (role: string, toolId: string, state: 'allow' | 'deny' | 'inherit') => {
    if (!matrix) return;
    const original = originalToolState(role, toolId);
    const desiredAllowed = state === 'inherit' ? null : state === 'allow';
    const originalAllowed = original === 'inherit' ? null : original === 'allow';
    const originalReason = matrix.toolPermissions[role]?.[toolId]?.reason ?? null;
    updatePendingChanges((draft) => {
      const key = getToolKey(role, toolId);
      if (desiredAllowed === originalAllowed) {
        const pending = draft.get(key);
        if (pending && (pending.reason ?? null) === (originalReason ?? null) && pending.allowed === desiredAllowed) {
          draft.delete(key);
        } else if (!pending) {
          // no-op
        } else {
          draft.set(key, { type: 'tool', role, targetId: toolId, allowed: desiredAllowed, reason: pending?.reason ?? originalReason ?? null });
        }
      } else {
        draft.set(key, { type: 'tool', role, targetId: toolId, allowed: desiredAllowed, reason: desiredAllowed === null ? null : originalReason });
      }
      return draft;
    });
  };

  const setToolReason = (role: string, toolId: string, reason: string) => {
    const trimmed = reason.trim();
    const currentState = toolState(role, toolId);
    if (currentState === 'inherit') return;
    const original = originalToolState(role, toolId);
    const originalReason = matrix?.toolPermissions[role]?.[toolId]?.reason ?? '';
    updatePendingChanges((draft) => {
      const key = getToolKey(role, toolId);
      const allowed = currentState === 'allow';
      if (currentState === original && trimmed === (originalReason ?? '')) {
        draft.delete(key);
        return draft;
      }
      draft.set(key, { type: 'tool', role, targetId: toolId, allowed, reason: trimmed.length > 0 ? trimmed : null });
      return draft;
    });
  };

  const resetPending = () => {
    setPendingChanges(new Map());
    setSaveError(null);
    matrixQuery.refetch().catch(() => {});
  };

  const applyMutation = useMutation({
    mutationFn: async (): Promise<{ updated: number; version: number; matrix: ToolAccessMatrix }> => {
      if (!matrix) throw new Error('Brak danych matrycy');
      const changesPayload = Array.from(pendingChanges.values()).map((change) => ({ ...change, scope: 'global' }));
      if (changesPayload.length === 0) return { updated: 0, version: matrix.version, matrix };
      const response = await authorizedFetch(`${baseUrl}/admin/tool-access`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ version: matrix.version, changes: changesPayload }),
      });
      if (response.status === 409) throw new Error('Konflikt wersji — odśwież dane i spróbuj ponownie.');
      if (!response.ok) {
        const text = await response.text();
        throw new Error(text || `Błąd zapisu (${response.status})`);
      }
      return (await response.json()) as any;
    },
    onSuccess: (data) => {
      queryClient.setQueryData(['tool-access-matrix'], data.matrix);
      setPendingChanges(new Map());
      setSaveError(null);
    },
    onError: (error: unknown) => {
      if (error instanceof Error) setSaveError(error.message);
      else setSaveError('Nie udało się zapisać zmian.');
    },
  });

  const selectedGroup = useMemo(() => {
    if (!matrix || !selectedGroupId) return null;
    return matrix.groups.find((entry) => entry.group.id === selectedGroupId) ?? null;
  }, [matrix, selectedGroupId]);

  const pendingCount = pendingChanges.size;
  const isSaving = applyMutation.isPending;

  return {
    matrixQuery,
    matrix,
    roles,
    groups,
    selectedRole,
    setSelectedRole,
    selectedGroupId,
    setSelectedGroupId,
    groupState,
    toolState,
    toolReason,
    setGroupState,
    setToolState,
    setToolReason,
    resetPending,
    applyMutation,
    selectedGroup,
    pendingCount,
    isSaving,
    saveError,
  } as const;
}

