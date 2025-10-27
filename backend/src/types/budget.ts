export type BudgetScope = 'account' | 'role' | 'user';
export type BudgetPeriod = 'monthly' | 'daily' | 'rolling_30d';

export interface BudgetRecord {
  id: string;
  scopeType: BudgetScope;
  scopeId: string;
  period: BudgetPeriod;
  currency: string;
  limitCents: number;
  hardLimit: boolean;
  resetDay: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface BudgetUpsertInput {
  id?: string;
  scopeType: BudgetScope;
  scopeId: string;
  period: BudgetPeriod;
  currency?: string;
  limitCents: number;
  hardLimit?: boolean;
  resetDay?: number | null;
}
