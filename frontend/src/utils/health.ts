import type { UseQueryResult } from '@tanstack/react-query';

export type StatusDescriptor = {
  label: string;
  status: 'ok' | 'error' | 'loading';
  description?: string;
};

export type HealthResponse = {
  backend: 'ok';
  mcp: { status: 'ok' | 'error' | 'unknown'; error?: string };
  openai: { status: 'ok' | 'error' | 'unknown'; error?: string; model: string; allowedModels: string[] };
  rbac: { enabled: boolean; roles: string[] };
};

export function buildStatuses(healthQuery: UseQueryResult<HealthResponse>): StatusDescriptor[] {
  if (healthQuery.isLoading || healthQuery.isFetching) {
    return [
      { label: 'MCP', status: 'loading' },
      { label: 'OpenAI (…)', status: 'loading' },
    ];
  }

  if (healthQuery.isError || !healthQuery.data) {
    const description = healthQuery.error instanceof Error ? healthQuery.error.message : undefined;
    return [
      { label: 'MCP', status: 'error', description },
      { label: 'OpenAI (…)', status: 'error', description },
    ];
  }

  const mcpStatus = healthQuery.data.mcp.status === 'ok' ? 'ok' : 'error';
  const openAiStatus = healthQuery.data.openai.status === 'ok' ? 'ok' : 'error';

  return [
    {
      label: 'MCP',
      status: mcpStatus,
      description: healthQuery.data.mcp.error,
    },
    {
      label: `OpenAI (${healthQuery.data.openai.model ?? '…'})`,
      status: openAiStatus,
      description: healthQuery.data.openai.error,
    },
  ];
}

export type UsageSummary = {
  promptTokens: number;
  cachedPromptTokens?: number;
  completionTokens: number;
  totalTokens: number;
  costUsd: number;
  model?: string;
};

export function extractUsageSummary(value: any): UsageSummary | null {
  if (!value) {
    return null;
  }
  const totals = value.totals ?? value;
  const promptTokens = Number(totals.promptTokens ?? 0);
  const cachedPromptTokens = Number(totals.cachedPromptTokens ?? totals.cached_prompt_tokens ?? 0);
  const completionTokens = Number(totals.completionTokens ?? 0);
  const totalTokens = Number(
    totals.totalTokens ?? totals.total_tokens ?? promptTokens + completionTokens,
  );
  const costUsd = Number(totals.costUsd ?? totals.cost_usd ?? 0);

  if (
    [promptTokens, completionTokens, totalTokens, costUsd].every((num) => Number.isFinite(num))
  ) {
    return {
      promptTokens,
      cachedPromptTokens,
      completionTokens,
      totalTokens,
      costUsd,
    };
  }
  return null;
}

