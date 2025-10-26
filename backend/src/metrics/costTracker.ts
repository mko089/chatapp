import { config } from '../config.js';

export interface UsageRecord {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  costUsd: number;
  timestamp: string;
}

interface SessionTotals {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  costUsd: number;
}

const sessionUsage = new Map<string, { totals: SessionTotals; history: UsageRecord[] }>();

export function recordUsage(
  sessionId: string,
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  },
): UsageRecord | null {
  if (!usage) {
    return null;
  }
  const promptTokens = usage.prompt_tokens ?? 0;
  const completionTokens = usage.completion_tokens ?? 0;
  const totalTokens = usage.total_tokens ?? promptTokens + completionTokens;
  const costUsd =
    promptTokens * config.promptTokenCostUsd + completionTokens * config.completionTokenCostUsd;
  const record: UsageRecord = {
    promptTokens,
    completionTokens,
    totalTokens,
    costUsd,
    timestamp: new Date().toISOString(),
  };

  const existing = sessionUsage.get(sessionId) ?? {
    totals: { promptTokens: 0, completionTokens: 0, totalTokens: 0, costUsd: 0 },
    history: [],
  };
  existing.totals.promptTokens += record.promptTokens;
  existing.totals.completionTokens += record.completionTokens;
  existing.totals.totalTokens += record.totalTokens;
  existing.totals.costUsd += record.costUsd;
  existing.history.push(record);
  sessionUsage.set(sessionId, existing);
  return record;
}

export function getSessionTotals(sessionId: string): SessionTotals & { history: UsageRecord[] } {
  const existing = sessionUsage.get(sessionId);
  if (!existing) {
    return {
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      costUsd: 0,
      history: [],
    };
  }
  return {
    promptTokens: existing.totals.promptTokens,
    completionTokens: existing.totals.completionTokens,
    totalTokens: existing.totals.totalTokens,
    costUsd: existing.totals.costUsd,
    history: existing.history.slice(),
  };
}

export function getGlobalTotals(): SessionTotals {
  const totals = { promptTokens: 0, completionTokens: 0, totalTokens: 0, costUsd: 0 };
  for (const { totals: sessionTotals } of sessionUsage.values()) {
    totals.promptTokens += sessionTotals.promptTokens;
    totals.completionTokens += sessionTotals.completionTokens;
    totals.totalTokens += sessionTotals.totalTokens;
    totals.costUsd += sessionTotals.costUsd;
  }
  return totals;
}

export function getAllSessionsTotals(): Record<string, SessionTotals> {
  const entries: Record<string, SessionTotals> = {};
  for (const [sessionId, { totals }] of sessionUsage.entries()) {
    entries[sessionId] = { ...totals };
  }
  return entries;
}
