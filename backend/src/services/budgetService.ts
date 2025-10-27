import type { BudgetRecord, BudgetScope, BudgetUpsertInput } from '../types/budget.js';
import {
  listBudgets as repoListBudgets,
  findBudget as repoFindBudget,
  upsertBudget as repoUpsertBudget,
  deleteBudget as repoDeleteBudget,
} from '../db/budgetRepository.js';

export async function listBudgets(): Promise<BudgetRecord[]> {
  return repoListBudgets();
}

export async function getBudget(scopeType: BudgetScope, scopeId: string): Promise<BudgetRecord | null> {
  return repoFindBudget(scopeType, scopeId);
}

export async function upsertBudget(input: BudgetUpsertInput): Promise<BudgetRecord> {
  if (!input.limitCents || input.limitCents < 0) {
    throw new Error('Budget limit must be a non-negative integer representing cents');
  }

  if (!input.scopeId || input.scopeId.trim().length === 0) {
    throw new Error('scopeId is required');
  }

  if (input.resetDay !== undefined && input.resetDay !== null) {
    if (!Number.isInteger(input.resetDay) || input.resetDay < 1 || input.resetDay > 28) {
      throw new Error('resetDay must be an integer between 1 and 28');
    }
  }

  return repoUpsertBudget({
    ...input,
    scopeId: input.scopeId.trim(),
    currency: input.currency ?? 'USD',
    hardLimit: input.hardLimit ?? false,
  });
}

export async function deleteBudget(scopeType: BudgetScope, scopeId: string): Promise<boolean> {
  return repoDeleteBudget(scopeType, scopeId);
}
