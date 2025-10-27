import { getDb } from '../db/index.js';

export interface UsageEvent {
  sessionId?: string;
  accountId?: string | null;
  userId?: string | null;
  roles?: string[];
  model: string;
  promptTokens: number;
  cachedPromptTokens: number;
  completionTokens: number;
  totalTokens: number;
  costUsd: number;
  occurredAt?: string;
  toolName?: string | null;
}

export interface UsageTotals {
  promptTokens: number;
  cachedPromptTokens: number;
  completionTokens: number;
  totalTokens: number;
  costCents: number;
}

export interface UsageTotalsQuery {
  scopeType: 'account' | 'role' | 'user' | 'session';
  scopeId: string;
  from?: Date;
  to?: Date;
}

export function recordUsageEvent(event: UsageEvent): void {
  const db = getDb();
  const occurredAt = event.occurredAt ?? new Date().toISOString();
  const primaryRole = event.roles?.[0] ?? null;
  const costCents = Math.round((event.costUsd ?? 0) * 100);

  db.prepare(
    `INSERT INTO usage_records (
        id,
        account_id,
        user_id,
        role,
        model,
        prompt_tokens,
        cached_prompt_tokens,
        completion_tokens,
        cost_cents,
        occurred_at,
        session_id,
        tool_name
      ) VALUES (
        lower(hex(randomblob(16))),
        @account_id,
        @user_id,
        @role,
        @model,
        @prompt_tokens,
        @cached_prompt_tokens,
        @completion_tokens,
        @cost_cents,
        @occurred_at,
        @session_id,
        @tool_name
      )`,
  ).run({
    account_id: event.accountId ?? null,
    user_id: event.userId ?? null,
    role: primaryRole ?? null,
    model: event.model,
    prompt_tokens: event.promptTokens,
    cached_prompt_tokens: event.cachedPromptTokens,
    completion_tokens: event.completionTokens,
    cost_cents: costCents,
    occurred_at: occurredAt,
    session_id: event.sessionId ?? null,
    tool_name: event.toolName ?? null,
  });
}

function queryTotals(conditions: string[], params: Record<string, unknown>): UsageTotals {
  const db = getDb();
  const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const row = db.prepare(
    `SELECT
        IFNULL(SUM(prompt_tokens), 0) AS prompt_tokens,
        IFNULL(SUM(cached_prompt_tokens), 0) AS cached_prompt_tokens,
        IFNULL(SUM(completion_tokens), 0) AS completion_tokens,
        IFNULL(SUM(prompt_tokens + completion_tokens), 0) AS total_tokens,
        IFNULL(SUM(cost_cents), 0) AS cost_cents
     FROM usage_records
     ${whereClause}`,
  ).get(params) as Record<string, unknown> | undefined;

  return {
    promptTokens: Number(row?.prompt_tokens ?? 0),
    cachedPromptTokens: Number(row?.cached_prompt_tokens ?? 0),
    completionTokens: Number(row?.completion_tokens ?? 0),
    totalTokens: Number(row?.total_tokens ?? 0),
    costCents: Number(row?.cost_cents ?? 0),
  };
}

export function getUsageTotals(query: UsageTotalsQuery): UsageTotals {
  const conditions: string[] = [];
  const params: Record<string, unknown> = {};

  switch (query.scopeType) {
    case 'account':
      conditions.push('account_id = @scopeId');
      params.scopeId = query.scopeId;
      break;
    case 'role':
      conditions.push('role = @scopeId');
      params.scopeId = query.scopeId;
      break;
    case 'user':
      conditions.push('user_id = @scopeId');
      params.scopeId = query.scopeId;
      break;
    case 'session':
      conditions.push('session_id = @scopeId');
      params.scopeId = query.scopeId;
      break;
    default:
      throw new Error(`Unsupported scope type: ${query.scopeType}`);
  }

  if (query.from) {
    conditions.push('occurred_at >= @from');
    params.from = query.from.toISOString();
  }
  if (query.to) {
    conditions.push('occurred_at <= @to');
    params.to = query.to.toISOString();
  }

  return queryTotals(conditions, params);
}

export function getUsageTotalsForAccount(accountId: string, from?: Date, to?: Date): UsageTotals {
  return getUsageTotals({ scopeType: 'account', scopeId: accountId, from, to });
}

export function getUsageTotalsForSession(sessionId: string): UsageTotals {
  return getUsageTotals({ scopeType: 'session', scopeId: sessionId });
}

export function getGlobalUsageTotals(from?: Date, to?: Date): UsageTotals {
  const conditions: string[] = [];
  const params: Record<string, unknown> = {};
  if (from) {
    conditions.push('occurred_at >= @from');
    params.from = from.toISOString();
  }
  if (to) {
    conditions.push('occurred_at <= @to');
    params.to = to.toISOString();
  }
  return queryTotals(conditions, params);
}
