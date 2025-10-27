import { randomUUID } from 'node:crypto';
import { getDb } from './index.js';
import type { BudgetRecord, BudgetScope, BudgetPeriod, BudgetUpsertInput } from '../types/budget.js';

function mapRow(row: any): BudgetRecord {
  return {
    id: row.id,
    scopeType: row.scope_type as BudgetScope,
    scopeId: row.scope_id,
    period: row.period as BudgetPeriod,
    currency: row.currency,
    limitCents: Number(row.limit_cents) ?? 0,
    hardLimit: Boolean(row.hard_limit),
    resetDay: row.reset_day === null || row.reset_day === undefined ? null : Number(row.reset_day),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function listBudgets(): BudgetRecord[] {
  const db = getDb();
  const rows = db.prepare(
    `SELECT id, scope_type, scope_id, period, currency, limit_cents, hard_limit, reset_day, created_at, updated_at
     FROM budgets
     ORDER BY scope_type, scope_id`,
  ).all();
  return rows.map(mapRow);
}

export function findBudget(scopeType: BudgetScope, scopeId: string): BudgetRecord | null {
  const db = getDb();
  const row = db.prepare(
    `SELECT id, scope_type, scope_id, period, currency, limit_cents, hard_limit, reset_day, created_at, updated_at
     FROM budgets
     WHERE scope_type = ? AND scope_id = ?`,
  ).get(scopeType, scopeId);
  if (!row) {
    return null;
  }
  return mapRow(row);
}

export function upsertBudget(input: BudgetUpsertInput): BudgetRecord {
  const db = getDb();
  const id = input.id ?? randomUUID();
  const params = {
    id,
    scope_type: input.scopeType,
    scope_id: input.scopeId,
    period: input.period,
    currency: input.currency ?? 'USD',
    limit_cents: input.limitCents,
    hard_limit: input.hardLimit ? 1 : 0,
    reset_day: input.resetDay ?? null,
  };

  db.prepare(
    `INSERT INTO budgets (id, scope_type, scope_id, period, currency, limit_cents, hard_limit, reset_day)
     VALUES (@id, @scope_type, @scope_id, @period, @currency, @limit_cents, @hard_limit, @reset_day)
     ON CONFLICT(scope_type, scope_id) DO UPDATE SET
       period = excluded.period,
       currency = excluded.currency,
       limit_cents = excluded.limit_cents,
       hard_limit = excluded.hard_limit,
       reset_day = excluded.reset_day,
       updated_at = datetime('now')`,
  ).run(params);

  const row = db.prepare(
    `SELECT id, scope_type, scope_id, period, currency, limit_cents, hard_limit, reset_day, created_at, updated_at
     FROM budgets
     WHERE scope_type = ? AND scope_id = ?`,
  ).get(input.scopeType, input.scopeId);

  if (!row) {
    throw new Error('Failed to retrieve budget after upsert');
  }

  return mapRow(row);
}

export function deleteBudget(scopeType: BudgetScope, scopeId: string): boolean {
  const db = getDb();
  const result = db.prepare(`DELETE FROM budgets WHERE scope_type = ? AND scope_id = ?`).run(scopeType, scopeId);
  return Number(result.changes ?? 0) > 0;
}
