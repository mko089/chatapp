import type { BudgetRecord } from '../types/budget.js';
import { getBudget } from './budgetService.js';
import {
  getUsageTotals,
  type UsageTotals,
} from './usageService.js';

interface BudgetContext {
  accountId?: string | null;
  userId?: string | null;
  roles?: string[];
  now?: Date;
}

export interface BudgetWindow {
  from: Date;
  to: Date;
}

export interface BudgetStatus {
  budget: BudgetRecord;
  usage: UsageTotals;
  remainingCents: number;
  remainingUsd: number;
  window: { from: string; to: string };
  hardLimitBreached: boolean;
  softLimitBreached: boolean;
}

export interface BudgetEvaluationResult {
  statuses: BudgetStatus[];
  hardLimitBreaches: BudgetStatus[];
  softLimitBreaches: BudgetStatus[];
}

function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 0, 0, 0, 0));
}

function addMonths(date: Date, months: number): Date {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();
  const day = date.getUTCDate();
  const result = new Date(Date.UTC(year, month + months, 1, 0, 0, 0, 0));
  const maxDay = new Date(Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0)).getUTCDate();
  const clampedDay = Math.min(day, maxDay);
  result.setUTCDate(clampedDay);
  return result;
}

function resolveMonthlyWindow(now: Date, resetDay?: number | null): BudgetWindow {
  const utcNow = new Date(now);
  let start: Date;
  if (resetDay && resetDay >= 1 && resetDay <= 28) {
    start = new Date(Date.UTC(utcNow.getUTCFullYear(), utcNow.getUTCMonth(), resetDay, 0, 0, 0, 0));
    if (start > utcNow) {
      const previousMonth = addMonths(start, -1);
      start = new Date(Date.UTC(previousMonth.getUTCFullYear(), previousMonth.getUTCMonth(), resetDay, 0, 0, 0, 0));
    }
  } else {
    start = new Date(Date.UTC(utcNow.getUTCFullYear(), utcNow.getUTCMonth(), 1, 0, 0, 0, 0));
  }
  return { from: start, to: utcNow };
}

function resolveDailyWindow(now: Date): BudgetWindow {
  return { from: startOfUtcDay(now), to: new Date(now) };
}

function resolveRollingWindow(now: Date, days: number): BudgetWindow {
  const to = new Date(now);
  const from = new Date(to.getTime() - days * 24 * 60 * 60 * 1000);
  return { from, to };
}

function resolveWindow(budget: BudgetRecord, now: Date): BudgetWindow {
  switch (budget.period) {
    case 'monthly':
      return resolveMonthlyWindow(now, budget.resetDay ?? undefined);
    case 'daily':
      return resolveDailyWindow(now);
    case 'rolling_30d':
    default:
      return resolveRollingWindow(now, 30);
  }
}

async function evaluateBudget(budget: BudgetRecord, now: Date): Promise<BudgetStatus> {
  const window = resolveWindow(budget, now);
  const usage = getUsageTotals({
    scopeType: budget.scopeType,
    scopeId: budget.scopeId,
    from: window.from,
    to: window.to,
  });

  const remainingCents = budget.limitCents - usage.costCents;
  const remainingUsd = remainingCents / 100;
  const hardLimitBreached = remainingCents <= 0 && budget.hardLimit;
  const softLimitBreached = remainingCents <= 0 && !budget.hardLimit;

  return {
    budget,
    usage,
    remainingCents,
    remainingUsd,
    window: { from: window.from.toISOString(), to: window.to.toISOString() },
    hardLimitBreached,
    softLimitBreached,
  };
}

export async function evaluateBudgetsForContext(context: BudgetContext): Promise<BudgetEvaluationResult> {
  const now = context.now ?? new Date();
  const statuses: BudgetStatus[] = [];

  const seen = new Set<string>();

  async function pushBudget(scopeType: 'account' | 'role' | 'user', scopeId: string | null | undefined) {
    if (!scopeId || scopeId.trim().length === 0) {
      return;
    }
    const normalized = scopeId.trim();
    const key = `${scopeType}:${normalized.toLowerCase()}`;
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    const budget = await getBudget(scopeType, normalized);
    if (!budget) {
      return;
    }
    const status = await evaluateBudget(budget, now);
    statuses.push(status);
  }

  await pushBudget('account', context.accountId ?? undefined);

  for (const role of context.roles ?? []) {
    await pushBudget('role', role?.toString()?.toLowerCase());
  }

  await pushBudget('user', context.userId ?? undefined);

  const hardLimitBreaches = statuses.filter((status) => status.hardLimitBreached);
  const softLimitBreaches = statuses.filter((status) => status.softLimitBreached);

  return {
    statuses,
    hardLimitBreaches,
    softLimitBreaches,
  };
}
