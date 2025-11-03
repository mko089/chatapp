import { useCallback, useState } from 'react';
import type { BudgetEvaluation, BudgetRecord } from '../types';
import type { ApiClient } from '../api/client';

export function useBudgets(params: {
  authReady: boolean;
  canManageBudgets: boolean;
  client: ApiClient;
  accountIdentifier: string;
  userId: string;
  primaryRole?: string;
}) {
  const { authReady, canManageBudgets, client, accountIdentifier, userId, primaryRole } = params;
  const [budgetDrawerOpen, setBudgetDrawerOpen] = useState(false);
  const [budgetItems, setBudgetItems] = useState<BudgetRecord[]>([]);
  const [budgetLoading, setBudgetLoading] = useState(false);
  const [budgetError, setBudgetError] = useState<string | null>(null);
  const [budgetEvaluation, setBudgetEvaluation] = useState<BudgetEvaluation | null>(null);

  const refreshBudgets = useCallback(async () => {
    if (!authReady || !canManageBudgets) return;
    setBudgetLoading(true);
    setBudgetError(null);
    try {
      const items = await client.listBudgets();
      setBudgetItems(items);
    } catch (err) {
      setBudgetError(err instanceof Error ? err.message : 'Nie udało się pobrać budżetów');
    } finally {
      setBudgetLoading(false);
    }
  }, [authReady, canManageBudgets, client]);

  const refreshBudgetEvaluation = useCallback(async () => {
    if (!authReady || !canManageBudgets) return;
    try {
      const result = await client.evaluateBudgets({ accountId: accountIdentifier || undefined, userId: userId || undefined, role: primaryRole || undefined });
      setBudgetEvaluation(result);
    } catch (err) {
      setBudgetError(err instanceof Error ? err.message : 'Nie udało się pobrać oceny budżetu');
    }
  }, [authReady, canManageBudgets, client, accountIdentifier, userId, primaryRole]);

  const handleCreateBudget = useCallback(async (input: { scopeType: string; scopeId: string; period: string; limitUsd: number; hardLimit?: boolean; resetDay?: number | null }) => {
    if (!authReady || !canManageBudgets) throw new Error('Brak uprawnień do zarządzania budżetami');
    await client.createBudget({
      scopeType: input.scopeType,
      scopeId: input.scopeId,
      period: input.period,
      currency: 'USD',
      limitCents: Math.round(input.limitUsd * 100),
      hardLimit: input.hardLimit,
      resetDay: input.resetDay ?? null,
    });
    await refreshBudgets();
    await refreshBudgetEvaluation();
  }, [authReady, canManageBudgets, client, refreshBudgets, refreshBudgetEvaluation]);

  const handleDeleteBudget = useCallback(async (budget: BudgetRecord) => {
    if (!authReady || !canManageBudgets) throw new Error('Brak uprawnień do zarządzania budżetami');
    await client.deleteBudget(budget.scopeType, budget.scopeId);
    await refreshBudgets();
    await refreshBudgetEvaluation();
  }, [authReady, canManageBudgets, client, refreshBudgets, refreshBudgetEvaluation]);

  const openBudgetDrawer = useCallback(() => {
    setBudgetDrawerOpen(true);
    void refreshBudgets();
    void refreshBudgetEvaluation();
  }, [refreshBudgets, refreshBudgetEvaluation]);

  const closeBudgetDrawer = useCallback(() => setBudgetDrawerOpen(false), []);

  return {
    budgetDrawerOpen,
    openBudgetDrawer,
    closeBudgetDrawer,
    budgetItems,
    budgetLoading,
    budgetError,
    budgetEvaluation,
    refreshBudgets,
    refreshBudgetEvaluation,
    handleCreateBudget,
    handleDeleteBudget,
  };
}

