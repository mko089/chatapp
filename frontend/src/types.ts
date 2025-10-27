export type ChatRole = 'system' | 'user' | 'assistant' | 'tool';

export interface ChatMessageMetadata {
  llmDurationMs?: number;
}

export interface ChatMessage {
  role: ChatRole;
  content: string;
  timestamp?: string;
  metadata?: ChatMessageMetadata;
}

export interface ToolInvocation {
  name: string;
  args: unknown;
  result: unknown;
  timestamp?: string;
}

export interface ToolInfo {
  name: string;
  description?: string;
  serverId: string;
}

export interface ToolGroupInfo {
  serverId: string;
  tools: ToolInfo[];
}

export interface SessionSummary {
  id: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  toolResultCount: number;
  lastMessagePreview?: string;
  lastMessageRole?: 'user' | 'assistant';
  lastMessageAt?: string;
}

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

export interface UsageTotals {
  promptTokens: number;
  cachedPromptTokens: number;
  completionTokens: number;
  totalTokens: number;
  costCents: number;
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

export interface BudgetEvaluation {
  statuses: BudgetStatus[];
  hardLimitBreaches: BudgetStatus[];
  softLimitBreaches: BudgetStatus[];
}
