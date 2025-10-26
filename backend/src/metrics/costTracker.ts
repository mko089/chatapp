import { config } from '../config.js';

const TOKENS_PER_MILLION = 1_000_000;

type Pricing = {
  input: number;
  output: number;
  cachedInput?: number;
};

const MODEL_PRICING: Array<{ match: string; pricing: Pricing }> = [
  { match: 'gpt-5-pro', pricing: { input: 15 / TOKENS_PER_MILLION, output: 120 / TOKENS_PER_MILLION } },
  { match: 'gpt-5-mini', pricing: { input: 0.25 / TOKENS_PER_MILLION, cachedInput: 0.025 / TOKENS_PER_MILLION, output: 2 / TOKENS_PER_MILLION } },
  { match: 'gpt-5-nano', pricing: { input: 0.05 / TOKENS_PER_MILLION, cachedInput: 0.005 / TOKENS_PER_MILLION, output: 0.4 / TOKENS_PER_MILLION } },
  { match: 'gpt-5', pricing: { input: 1.25 / TOKENS_PER_MILLION, cachedInput: 0.125 / TOKENS_PER_MILLION, output: 10 / TOKENS_PER_MILLION } },
  { match: 'gpt-4.1-nano', pricing: { input: 0.1 / TOKENS_PER_MILLION, cachedInput: 0.025 / TOKENS_PER_MILLION, output: 0.4 / TOKENS_PER_MILLION } },
  { match: 'gpt-4.1-mini', pricing: { input: 0.4 / TOKENS_PER_MILLION, cachedInput: 0.1 / TOKENS_PER_MILLION, output: 1.6 / TOKENS_PER_MILLION } },
  { match: 'gpt-4.1', pricing: { input: 2 / TOKENS_PER_MILLION, cachedInput: 0.5 / TOKENS_PER_MILLION, output: 8 / TOKENS_PER_MILLION } },
];

export interface UsageRecord {
  promptTokens: number;
  cachedPromptTokens: number;
  completionTokens: number;
  totalTokens: number;
  costUsd: number;
  timestamp: string;
  model: string;
}

interface SessionTotals {
  promptTokens: number;
  cachedPromptTokens: number;
  completionTokens: number;
  totalTokens: number;
  costUsd: number;
}

const sessionUsage = new Map<string, { totals: SessionTotals; history: UsageRecord[] }>();

function resolvePricing(model?: string): Pricing | null {
  if (!model) {
    return null;
  }
  const normalized = model.toLowerCase();
  for (const entry of MODEL_PRICING) {
    if (normalized === entry.match || normalized.startsWith(`${entry.match}-`)) {
      return entry.pricing;
    }
  }
  return null;
}

export function recordUsage(
  sessionId: string,
  usage: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    prompt_tokens_details?: { cached_tokens?: number };
  } | undefined,
  model?: string,
): UsageRecord | null {
  if (!usage) {
    return null;
  }
  const promptTokens = usage.prompt_tokens ?? 0;
  const cachedPromptTokens = usage.prompt_tokens_details?.cached_tokens ?? 0;
  const completionTokens = usage.completion_tokens ?? 0;
  const totalTokens = usage.total_tokens ?? promptTokens + completionTokens;
  const pricing = resolvePricing(model);
  const promptRate = pricing?.input ?? config.promptTokenCostUsd;
  const cachedRate = pricing?.cachedInput ?? promptRate;
  const completionRate = pricing?.output ?? config.completionTokenCostUsd;

  const cachedPortion = Math.min(cachedPromptTokens, promptTokens);
  const normalPromptTokens = Math.max(promptTokens - cachedPortion, 0);
  const costUsd =
    normalPromptTokens * promptRate + cachedPortion * cachedRate + completionTokens * completionRate;
  const record: UsageRecord = {
    promptTokens,
    cachedPromptTokens: cachedPortion,
    completionTokens,
    totalTokens,
    costUsd,
    timestamp: new Date().toISOString(),
    model: model ?? 'unknown',
  };

  const existing = sessionUsage.get(sessionId) ?? {
    totals: { promptTokens: 0, cachedPromptTokens: 0, completionTokens: 0, totalTokens: 0, costUsd: 0 },
    history: [],
  };
  existing.totals.promptTokens += record.promptTokens;
  existing.totals.cachedPromptTokens += record.cachedPromptTokens;
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
      cachedPromptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      costUsd: 0,
      history: [],
    };
  }
  return {
    promptTokens: existing.totals.promptTokens,
    cachedPromptTokens: existing.totals.cachedPromptTokens,
    completionTokens: existing.totals.completionTokens,
    totalTokens: existing.totals.totalTokens,
    costUsd: existing.totals.costUsd,
    history: existing.history.slice(),
  };
}

export function getGlobalTotals(): SessionTotals {
  const totals = { promptTokens: 0, cachedPromptTokens: 0, completionTokens: 0, totalTokens: 0, costUsd: 0 };
  for (const { totals: sessionTotals } of sessionUsage.values()) {
    totals.promptTokens += sessionTotals.promptTokens;
    totals.cachedPromptTokens += sessionTotals.cachedPromptTokens;
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
