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
  rawArgs?: unknown;
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
  userId?: string | null;
  accountId?: string | null;
  projectId?: string | null;
  currentDocPath?: string | null;
  title?: string;
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

export interface ToolGroupRecord {
  id: string;
  name: string;
  description: string | null;
  sortOrder: number;
  metadata?: Record<string, unknown> | null;
}

export interface ToolDefinitionRecord {
  id: string;
  groupId: string;
  name: string;
  description: string | null;
  isActive: boolean;
  metadata?: Record<string, unknown> | null;
}

export interface RoleToolGroupPermissionRecord {
  id: string;
  role: string;
  groupId: string;
  scope: string;
  allowed: boolean;
  source: string;
  updatedBy: string | null;
  updatedAt: string;
}

export interface RoleToolPermissionRecord {
  id: string;
  role: string;
  toolId: string;
  scope: string;
  allowed: boolean;
  reason: string | null;
  source: string;
  updatedBy: string | null;
  updatedAt: string;
}

export interface ToolAccessMatrixGroup {
  group: ToolGroupRecord;
  tools: ToolDefinitionRecord[];
}

export interface ToolAccessMatrix {
  roles: string[];
  groups: ToolAccessMatrixGroup[];
  groupPermissions: Record<string, Record<string, RoleToolGroupPermissionRecord>>;
  toolPermissions: Record<string, Record<string, RoleToolPermissionRecord>>;
  version: number;
}

export interface ToolAccessMatrixResponse {
  matrix: ToolAccessMatrix;
}
