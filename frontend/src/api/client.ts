import type { BudgetEvaluation, BudgetRecord, SessionSummary, ToolInvocation, ToolInfo, ChatMessage } from '../types';
import type { HealthResponse } from '../utils/health';

export class ApiError extends Error {
  status: number;
  body?: string;
  constructor(message: string, status: number, body?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }
}

async function fetchJson<T>(authorizedFetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>, url: string, init?: RequestInit): Promise<T> {
  const res = await authorizedFetch(url, init);
  if (!res.ok) {
    let body: string | undefined;
    try { body = await res.text(); } catch {}
    throw new ApiError(`Request failed (${res.status})`, res.status, body);
  }
  return res.json() as Promise<T>;
}

export type ApiClient = ReturnType<typeof createApiClient>;

export function createApiClient(baseUrl: string, authorizedFetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>) {
  return {
    async getHealth(): Promise<HealthResponse> {
      return fetchJson<HealthResponse>(authorizedFetch, `${baseUrl}/health`);
    },
    async getTools(): Promise<ToolInfo[]> {
      const data = await fetchJson<ToolInfo[] | { tools?: ToolInfo[] }>(authorizedFetch, `${baseUrl}/mcp/tools`);
      return Array.isArray(data) ? data : Array.isArray((data as any)?.tools) ? ((data as any).tools as ToolInfo[]) : [];
    },
    async getSessions(params?: { scope?: 'all'; userId?: string }): Promise<SessionSummary[]> {
      const usp = new URLSearchParams();
      if (params?.scope) usp.set('scope', params.scope);
      if (params?.userId) usp.set('userId', params.userId);
      type SessionsListResponse = { sessions: SessionSummary[] } | SessionSummary[];
      const data = await fetchJson<SessionsListResponse>(authorizedFetch, `${baseUrl}/sessions${usp.toString() ? `?${usp.toString()}` : ''}`);
      return Array.isArray(data) ? data : Array.isArray(data?.sessions) ? data.sessions : [];
    },
    async getSession(id: string): Promise<{ messages: ChatMessage[]; toolHistory?: ToolInvocation[]; toolResults?: ToolInvocation[]; projectId?: string | null; currentDocPath?: string | null }> {
      type SessionDetailResponse = {
        messages: ChatMessage[];
        toolHistory?: ToolInvocation[];
        toolResults?: ToolInvocation[];
        projectId?: string | null;
        currentDocPath?: string | null;
      };
      return fetchJson<SessionDetailResponse>(authorizedFetch, `${baseUrl}/sessions/${id}`);
    },
    async deleteSession(id: string): Promise<void> {
      await fetchJson<unknown>(authorizedFetch, `${baseUrl}/sessions/${id}`, { method: 'DELETE' });
    },
    async createStubSession(id: string): Promise<void> {
      await authorizedFetch(`${baseUrl}/sessions/${id}`).catch(() => {});
    },
    async postSessionContext(id: string, payload: { projectId: string | null; currentDocPath: string | null }): Promise<void> {
      await authorizedFetch(`${baseUrl}/sessions/${id}/context`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }).catch(() => {});
    },
    async listBudgets(): Promise<BudgetRecord[]> {
      type BudgetsListResponse = { items?: BudgetRecord[] } | BudgetRecord[];
      const data = await fetchJson<BudgetsListResponse>(authorizedFetch, `${baseUrl}/admin/budgets`);
      return Array.isArray(data) ? data : Array.isArray(data?.items) ? (data.items as BudgetRecord[]) : [];
    },
    async evaluateBudgets(params: { accountId?: string; userId?: string; role?: string }): Promise<BudgetEvaluation | null> {
      const usp = new URLSearchParams();
      if (params.accountId) usp.set('accountId', params.accountId);
      if (params.userId) usp.set('userId', params.userId);
      if (params.role) usp.set('role', params.role);
      type EvaluateResponse = { result?: BudgetEvaluation } | BudgetEvaluation | null;
      const data = await fetchJson<EvaluateResponse>(authorizedFetch, `${baseUrl}/admin/budgets/evaluate${usp.toString() ? `?${usp.toString()}` : ''}`);
      if (!data) return null;
      if ((data as any).result) return (data as any).result as BudgetEvaluation;
      return data as BudgetEvaluation;
    },
    async createBudget(payload: { scopeType: string; scopeId: string; period: string; currency: string; limitCents: number; hardLimit?: boolean; resetDay?: number | null }): Promise<void> {
      const res = await authorizedFetch(`${baseUrl}/admin/budgets`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(`Nie udało się zapisać budżetu (${res.status})`);
    },
    async deleteBudget(scopeType: string, scopeId: string): Promise<void> {
      await fetchJson<unknown>(authorizedFetch, `${baseUrl}/admin/budgets/${scopeType}/${encodeURIComponent(scopeId)}`, { method: 'DELETE' });
    },
    async getLlmTraces(sessionId: string, limit = 200): Promise<unknown[]> {
      const usp = new URLSearchParams();
      usp.set('sessionId', sessionId);
      usp.set('limit', String(limit));
      type LlmTracesResponse = { items?: unknown[] } | unknown[];
      const data = await fetchJson<LlmTracesResponse>(authorizedFetch, `${baseUrl}/admin/llm-traces?${usp.toString()}`);
      return Array.isArray(data) ? data : Array.isArray((data as any)?.items) ? ((data as any).items as unknown[]) : [];
    },
  };
}
