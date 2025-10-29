import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, QueryClient, QueryClientProvider, type UseQueryResult } from '@tanstack/react-query';
import { MessageList } from './components/MessageList';
import { ChatInput, type ChatInputHandle } from './components/ChatInput';
import { AppHeader } from './components/AppHeader';
import { ToolDock } from './components/ToolDock';
import { BudgetDrawer, type BudgetFormState } from './components/BudgetDrawer';
import { renderInlineValue } from './utils/inlineFormat';
import { usePersistentState } from './hooks/usePersistentState';
import type {
  ChatMessage,
  ToolInvocation,
  ToolGroupInfo,
  ToolInfo,
  SessionSummary,
  BudgetRecord,
  BudgetEvaluation,
} from './types';
import { AuthProvider, useAuth } from './auth/AuthProvider';
import { useAuthorizedFetch } from './hooks/useAuthorizedFetch';
import { useChatStream } from './hooks/useChatStream';

const queryClient = new QueryClient();
const systemMessage: ChatMessage = {
  role: 'system',
  content:
    'You are a helpful assistant working with Garden MCP tools (meters, employee, posbistro, fincost, garden).\n' +
    '- When using posbistro tools: if the user mentions "Garden Bistro" use location alias "gardenbistro" unless another alias is specified.\n' +
    '- Prefer posbistro_item_sales_today (requires { location }) to get today\'s revenue; if a daily range is needed, use normalized_item_sales_daily_totals with { from, to } in YYYY-MM-DD.\n' +
    '- For item_sales_today responses, there is a summary entry (data_type == "summary"); treat its gross_expenditures_total as today\'s gross revenue and present it clearly.\n' +
    '- For normalized_item_sales_daily_totals, parse the JSON inside the text content and sum days[*].gross to produce total revenue for the requested range; include the date range and currency in the final answer.\n' +
    '- If the API requires from/to, default both to today in the user\'s timezone.\n' +
    '- Never call write/update/delete tools unless explicitly asked.',
};

const DEFAULT_MODEL_ORDER = ['gpt-5', 'gpt-5-mini', 'gpt-5-nano', 'gpt-4o-mini', 'gpt-4.1-mini', 'gpt-4.1-nano'];

type HealthResponse = {
  backend: 'ok';
  mcp: { status: 'ok' | 'error' | 'unknown'; error?: string };
  openai: { status: 'ok' | 'error' | 'unknown'; error?: string; model: string; allowedModels: string[] };
  rbac: { enabled: boolean; roles: string[] };
};

type UsageSummary = {
  promptTokens: number;
  cachedPromptTokens?: number;
  completionTokens: number;
  totalTokens: number;
  costUsd: number;
  model?: string;
};

function isLikelyJson(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length < 2) {
    return false;
  }
  const first = trimmed[0];
  const last = trimmed[trimmed.length - 1];
  return (first === '{' && last === '}') || (first === '[' && last === ']');
}

function normalizeStructuredValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeStructuredValue(item));
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, val]) => [key, normalizeStructuredValue(val)]),
    );
  }
  if (typeof value === 'string') {
    const normalized = value.replace(/\r\n/g, '\n');
    if (isLikelyJson(normalized)) {
      try {
        return normalizeStructuredValue(JSON.parse(normalized));
      } catch (error) {
        return normalized;
      }
    }
    return normalized;
  }
  return value;
}

function formatStructuredValue(value: unknown, space = 2, fallback = 'null'): string {
  if (value === undefined) {
    return fallback;
  }
  const normalized = normalizeStructuredValue(value ?? null);
  if (
    normalized === null ||
    typeof normalized === 'number' ||
    typeof normalized === 'boolean'
  ) {
    return String(normalized);
  }
  if (typeof normalized === 'string') {
    return normalized;
  }
  try {
    return JSON.stringify(normalized, null, space);
  } catch (error) {
    return fallback;
  }
}

function AppContent() {
  const auth = useAuth();
  const authorizedFetch = useAuthorizedFetch();
  const chatStream = useChatStream();
  const authReady = !auth.enabled || (auth.ready && auth.isAuthenticated);
  const authLoading = auth.enabled && !auth.ready;
  const requiresLogin = auth.enabled && auth.ready && !auth.isAuthenticated;

  const [baseUrl, setBaseUrl] = useState<string>(() => {
    const explicit = (import.meta as any)?.env?.VITE_CHATAPI_URL as string | undefined;
    if (explicit && explicit.length > 0) {
      return explicit;
    }

    const fallbackPort = (import.meta as any)?.env?.VITE_CHATAPI_PORT ?? '4025';
    if (typeof window !== 'undefined') {
      try {
        const url = new URL(window.location.href);
        url.port = fallbackPort;
        return url.origin;
      } catch (error) {
        // ignore and fall through to localhost fallback
      }
    }
    return `http://localhost:${fallbackPort}`;
  });
  const triedFallbackRef = useRef(false);
  const [history, setHistory] = useState<ChatMessage[]>([]);
  const [toolResults, setToolResults] = useState<ToolInvocation[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const streamAbortRef = useRef<AbortController | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [isRestoring, setIsRestoring] = useState(false);
  const [selectedToolResult, setSelectedToolResult] = useState<ToolInvocation | null>(null);
  const [assistantToolCounts, setAssistantToolCounts] = useState<number[]>([]);
  const [pendingMessages, setPendingMessages] = useState<ChatMessage[]>([]);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [isToolsOpen, setIsToolsOpen] = useState(() => {
    if (typeof window === 'undefined') {
      return true;
    }
    return window.innerWidth >= 900;
  });
  const [sessionSummaries, setSessionSummaries] = useState<SessionSummary[]>([]);
  const [isSessionDrawerOpen, setIsSessionDrawerOpen] = useState(false);
  const [isSessionsLoading, setIsSessionsLoading] = useState(false);
  const [sessionsError, setSessionsError] = useState<string | null>(null);
  const [selectedToolInfo, setSelectedToolInfo] = useState<ToolInfo | null>(null);
  const hasInitialisedSession = useRef(false);
  const [budgetDrawerOpen, setBudgetDrawerOpen] = useState(false);
  const [budgetItems, setBudgetItems] = useState<BudgetRecord[]>([]);
  const [budgetLoading, setBudgetLoading] = useState(false);
  const [budgetError, setBudgetError] = useState<string | null>(null);
  const [budgetEvaluation, setBudgetEvaluation] = useState<BudgetEvaluation | null>(null);
  const [budgetWarning, setBudgetWarning] = useState(false);
  const clampFont = useCallback((value: number) => Math.min(1.6, Math.max(0.6, value)), []);

  const [fontScale, setFontScale] = usePersistentState<number>('chat-font-scale', 1.1, {
    deserialize: (value) => {
      const parsed = Number.parseFloat(value);
      if (Number.isNaN(parsed)) {
        return null;
      }
      return clampFont(parsed);
    },
    serialize: (value) => value.toString(),
  });

  const [showInlineTools, setShowInlineTools] = usePersistentState<boolean>('chat-show-inline-tools', true, {
    deserialize: (value) => {
      if (value === 'true') return true;
      if (value === 'false') return false;
      return null;
    },
    serialize: (value) => (value ? 'true' : 'false'),
  });
  const [usageSummary, setUsageSummary] = useState<UsageSummary | null>(null);
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [selectedModel, setSelectedModel] = usePersistentState<string>('chat-selected-model', '');
  const [favoriteToolKeys, setFavoriteToolKeys] = usePersistentState<string[]>('chat-favorite-tools', []);
  const [uiPeriod, setUiPeriod] = usePersistentState<'today' | 'yesterday' | '7d'>('chat-ui-period', 'today');
  const [uiLocation, setUiLocation] = usePersistentState<string>('chat-ui-location', '');
  const dockSearchRef = useRef<HTMLInputElement>(null);
  const chatInputRef = useRef<HTMLTextAreaElement>(null);
  const chatInputHandleRef = useRef<ChatInputHandle>(null);

  const userDisplayName = useMemo(() => {
    if (!auth.user) {
      return '';
    }
    return (
      auth.user.name ||
      auth.user.email ||
      auth.user.username ||
      auth.user.sub ||
      'Użytkownik'
    );
  }, [auth.user]);

  const userRoles = auth.user?.roles ?? [];
  const normalizedRoles = useMemo(() => userRoles.map((role) => role.toLowerCase()), [userRoles]);
  const accountIdentifier = auth.user?.accountId ?? '';
  const authTooltip = useMemo(() => {
    if (!auth.user) {
      return '';
    }
    const segments: string[] = [];
    if (auth.user.email) {
      segments.push(`Email: ${auth.user.email}`);
    }
    if (accountIdentifier) {
      segments.push(`Konto: ${accountIdentifier}`);
    }
    if (usageSummary && Number.isFinite(usageSummary.costUsd)) {
      segments.push(`Koszt sesji: $${usageSummary.costUsd.toFixed(4)}`);
    }
    return segments.join('\n');
  }, [accountIdentifier, auth.user, usageSummary]);

  const canManageBudgets = useMemo(() => normalizedRoles.some((role) => role === 'owner' || role === 'admin'), [normalizedRoles]);

  const keycloakBaseUrl = useMemo(() => ((import.meta.env.VITE_KEYCLOAK_URL as string | undefined) ?? '').replace(/\/$/, ''), []);
  const keycloakRealm = (import.meta.env.VITE_KEYCLOAK_REALM as string | undefined) ?? '';
  const keycloakClientId = (import.meta.env.VITE_KEYCLOAK_CLIENT_ID as string | undefined) ?? '';

  const handleLogin = useCallback(() => {
    const redirectUri = `${window.location.origin}${window.location.pathname}`;
    void auth.login().catch(() => {
      if (keycloakBaseUrl && keycloakRealm && keycloakClientId) {
        const authUrl = `${keycloakBaseUrl}/realms/${keycloakRealm}/protocol/openid-connect/auth?client_id=${encodeURIComponent(
          keycloakClientId,
        )}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=openid`;
        window.location.href = authUrl;
      }
    });
  }, [auth, keycloakBaseUrl, keycloakRealm, keycloakClientId]);

  const refreshUsage = useCallback(
    async (id: string) => {
      if (!authReady) {
        return;
      }
      try {
        const res = await authorizedFetch(`${baseUrl}/metrics/cost`);
        if (!res.ok) {
          return;
        }
        const data = await res.json();
        const sessionTotals = data?.sessions?.[id];
        const normalized = extractUsageSummary(sessionTotals);
        setUsageSummary(normalized);
      } catch (error) {
        // ignore errors
      }
    },
    [authReady, authorizedFetch, baseUrl],
  );

  const handleLogout = useCallback(async () => {
    const redirectUri = `${window.location.origin}${window.location.pathname}`;
    if (keycloakBaseUrl && keycloakRealm && keycloakClientId) {
      const logoutUrl = `${keycloakBaseUrl}/realms/${keycloakRealm}/protocol/openid-connect/logout?client_id=${encodeURIComponent(keycloakClientId)}&post_logout_redirect_uri=${encodeURIComponent(redirectUri)}`;
      window.location.href = logoutUrl;
      return;
    }
    try {
      await auth.logout();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Nie udało się wylogować');
    } finally {
      window.location.href = redirectUri;
    }
  }, [auth, keycloakBaseUrl, keycloakRealm, keycloakClientId]);

  const refreshSessionList = useCallback(
    async (options: { silent?: boolean } = {}) => {
      if (!authReady) {
        return;
      }
      const { silent = false } = options;
      if (!silent) {
        setIsSessionsLoading(true);
        setSessionsError(null);
      }
      try {
        const res = await authorizedFetch(`${baseUrl}/sessions`);
        if (!res.ok) {
          throw new Error(`Nie udało się pobrać listy sesji (${res.status})`);
        }
        const data = await res.json();
        const entries = Array.isArray(data?.sessions) ? (data.sessions as SessionSummary[]) : [];
        setSessionSummaries(entries);
        if (silent) {
          setSessionsError(null);
        }
      } catch (error) {
        if (!silent) {
          setSessionsError(error instanceof Error ? error.message : 'Nie udało się pobrać listy sesji');
        }
      } finally {
        setIsSessionsLoading(false);
      }
    },
    [authReady, authorizedFetch, baseUrl],
  );

  const refreshBudgets = useCallback(async () => {
    if (!authReady || !hasAdminAccess()) {
      return;
    }
    setBudgetLoading(true);
    setBudgetError(null);
    try {
      const res = await authorizedFetch(`${baseUrl}/admin/budgets`);
      if (!res.ok) {
        const body = await res.text();
        throw new Error(body || `Nie udało się pobrać budżetów (${res.status})`);
      }
      const data = await res.json();
      const items = Array.isArray(data?.items) ? (data.items as BudgetRecord[]) : [];
      setBudgetItems(items);
    } catch (err) {
      setBudgetError(err instanceof Error ? err.message : 'Nie udało się pobrać budżetów');
    } finally {
      setBudgetLoading(false);
    }
  }, [authReady, canManageBudgets, authorizedFetch, baseUrl]);

  const userId = auth.user?.sub ?? '';

  const refreshBudgetEvaluation = useCallback(async () => {
    if (!authReady || !hasAdminAccess()) {
      return;
    }
    try {
      const params = new URLSearchParams();
      if (accountIdentifier) {
        params.set('accountId', accountIdentifier);
      }
      if (userId) {
        params.set('userId', userId);
      }
      const primaryRole = normalizedRoles[0];
      if (primaryRole) {
        params.set('role', primaryRole);
      }
      const query = params.toString();
      const res = await authorizedFetch(`${baseUrl}/admin/budgets/evaluate${query ? `?${query}` : ''}`);
      if (!res.ok) {
        const body = await res.text();
        throw new Error(body || `Nie udało się pobrać oceny budżetu (${res.status})`);
      }
      const data = await res.json();
      setBudgetEvaluation((data?.result as BudgetEvaluation) ?? null);
    } catch (err) {
      setBudgetError(err instanceof Error ? err.message : 'Nie udało się pobrać oceny budżetu');
    }
  }, [authReady, canManageBudgets, authorizedFetch, baseUrl, accountIdentifier, userId, normalizedRoles]);

  const handleCreateBudget = useCallback(
    async (input: BudgetFormState) => {
      if (!authReady || !hasAdminAccess()) {
        throw new Error('Brak uprawnień do zarządzania budżetami');
      }
      const payload = {
        scopeType: input.scopeType,
        scopeId: input.scopeId,
        period: input.period,
        currency: 'USD',
        limitCents: Math.round(input.limitUsd * 100),
        hardLimit: input.hardLimit,
        resetDay: input.resetDay,
      };
      const res = await authorizedFetch(`${baseUrl}/admin/budgets`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const body = await res.text();
        throw new Error(body || `Nie udało się zapisać budżetu (${res.status})`);
      }
      await refreshBudgets();
      await refreshBudgetEvaluation();
    },
    [authReady, canManageBudgets, authorizedFetch, baseUrl, refreshBudgets, refreshBudgetEvaluation],
  );

  const handleDeleteBudget = useCallback(
    async (budget: BudgetRecord) => {
      if (!authReady || !hasAdminAccess()) {
        throw new Error('Brak uprawnień do zarządzania budżetami');
      }
      const res = await authorizedFetch(
        `${baseUrl}/admin/budgets/${budget.scopeType}/${encodeURIComponent(budget.scopeId)}`,
        {
          method: 'DELETE',
        },
      );
      if (!res.ok) {
        const body = await res.text();
        throw new Error(body || `Nie udało się usunąć budżetu (${res.status})`);
      }
      await refreshBudgets();
      await refreshBudgetEvaluation();
    },
    [authReady, canManageBudgets, authorizedFetch, baseUrl, refreshBudgets, refreshBudgetEvaluation],
  );

  const handleBudgetsRefresh = useCallback(() => {
    void refreshBudgets();
    void refreshBudgetEvaluation();
  }, [refreshBudgets, refreshBudgetEvaluation]);

  const healthQuery = useQuery({
    queryKey: ['health', baseUrl, auth.token],
    enabled: authReady,
    queryFn: async () => {
      const res = await authorizedFetch(`${baseUrl}/health`);
      if (!res.ok) throw new Error('Nie udało się pobrać statusu backendu');
      return (await res.json()) as HealthResponse;
    },
    refetchInterval: authReady ? 30_000 : false,
  });

  // If explicit base URL is unreachable (e.g. stale LAN IP), try sensible fallbacks once
  useEffect(() => {
    if (!authReady || !healthQuery.isError || triedFallbackRef.current) {
      return;
    }
    const err: unknown = healthQuery.error;
    const message = (err && typeof err === 'object' && 'message' in err ? (err as any).message : '') as string;
    const isNetworkError = err instanceof TypeError || /fetch|network|Failed to|ERR_CONNECTION_REFUSED/i.test(message);
    if (!isNetworkError) return;

    const fallbackPort = (import.meta as any)?.env?.VITE_CHATAPI_PORT ?? '4025';
    const candidates: string[] = [];
    // Prefer same host, different port
    if (typeof window !== 'undefined') {
      try {
        const u = new URL(window.location.href);
        u.port = fallbackPort;
        candidates.push(u.origin);
      } catch {}
    }
    // Then localhost variants
    candidates.push(`http://localhost:${fallbackPort}`, `http://127.0.0.1:${fallbackPort}`);

    const unique = candidates.filter((c, i, arr) => c && c !== baseUrl && arr.indexOf(c) === i);
    if (unique.length > 0) {
      triedFallbackRef.current = true;
      setBaseUrl(unique[0]);
    }
  }, [authReady, baseUrl, healthQuery.error, healthQuery.isError]);

  // Effective admin access: either token roles or server-side RBAC says owner/admin
  const hasAdminAccess = useCallback(() => {
    if (canManageBudgets) return true;
    const serverRoles = healthQuery.data?.rbac?.roles ?? [];
    for (const role of serverRoles) {
      const lowered = (role ?? '').toString().toLowerCase();
      if (lowered === 'owner' || lowered === 'admin') {
        return true;
      }
    }
    return false;
  }, [canManageBudgets, healthQuery.data?.rbac?.roles]);

  useEffect(() => {
    if (!authReady) {
      return;
    }
    void refreshSessionList({ silent: true });
  }, [authReady, refreshSessionList]);

  useEffect(() => {
    const modelsFromHealth = healthQuery.data?.openai.allowedModels ?? [];
    const merged = Array.from(new Set([...DEFAULT_MODEL_ORDER, ...modelsFromHealth]));
    if (merged.length > 0) {
      setAvailableModels(merged);
      if (!merged.includes(selectedModel)) {
        setSelectedModel(merged[0]);
      }
    }
  }, [healthQuery.data?.openai.allowedModels, selectedModel, setSelectedModel]);

  const formatArgs = (args: unknown) => formatStructuredValue(args, 0, '{}');

  const formatResult = (result: unknown) => formatStructuredValue(result ?? null, 2, 'null');

  const filterDisplayMessages = useCallback(
    (messages: ChatMessage[]): ChatMessage[] =>
      (messages ?? []).filter((msg) => msg.role !== 'system' && msg.role !== 'tool'),
    [],
  );

  const formatPosbistroSummaryInline = useCallback((tool: ToolInvocation): string | null => {
    const result = tool.result as any;
    if (!result || typeof result !== 'object') {
      return null;
    }

    const type = typeof result.type === 'string' ? result.type : '';
    if (!type.startsWith('posbistro.') || !type.endsWith('.summary')) {
      return null;
    }

    const baseType = typeof result.tool === 'string' ? result.tool : type.replace(/\.summary$/, '');
    const readableName = baseType.split('.').pop() ?? baseType;

    const getLocation = (): string | null => {
      if (typeof result.location === 'string' && result.location.trim().length > 0) {
        return result.location;
      }
      if (tool.args && typeof tool.args === 'object' && tool.args !== null) {
        const candidate = (tool.args as Record<string, unknown>).location;
        if (typeof candidate === 'string' && candidate.trim().length > 0) {
          return candidate;
        }
      }
      return null;
    };

    const parseNumber = (value: unknown): number | null => {
      const num = typeof value === 'string' ? Number(value) : (typeof value === 'number' ? value : NaN);
      return Number.isFinite(num) ? num : null;
    };

    const location = getLocation();
    const from = typeof result.from === 'string' ? result.from : undefined;
    const to = typeof result.to === 'string' ? result.to : undefined;
    const period = from && to ? `${from} → ${to}` : from ?? to ?? undefined;

    const gross = parseNumber(result.gross ?? result.summary?.gross_expenditures_total);
    const net = parseNumber(result.net ?? result.summary?.net_expenditures_total);

    const entries = Array.isArray(result.entries) ? result.entries : [];
    const entryCount = entries.length;
    const topItems = entries
      .map((entry: any) => (typeof entry?.item_name === 'string' ? entry.item_name : null))
      .filter((name: string | null): name is string => Boolean(name))
      .slice(0, 3);

    const formatter = new Intl.NumberFormat('pl-PL', {
      style: 'currency',
      currency: 'PLN',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });

    const grossLabel = gross !== null ? formatter.format(gross) : 'brak danych';
    const netLabel = net !== null ? formatter.format(net) : 'brak danych';
    const locationLabel = location ? ` @ ${location}` : '';
    const periodLabel = period ? ` • ${period}` : '';
    const entriesLabel = entryCount > 0 ? `${entryCount} pozycji` : '0 pozycji';
    const topLabel = topItems.length > 0 ? ` • Top: ${topItems.join(', ')}` : '';

    return `• ${readableName} summary${locationLabel}${periodLabel} ⇒ ${entriesLabel}, brutto ${grossLabel} (netto ${netLabel})${topLabel}`;
  }, []);

  const formatInlineSummary = useCallback((tool: ToolInvocation): string => {
    const specialized = formatPosbistroSummaryInline(tool);
    if (specialized) {
      return specialized;
    }
    const argsInline = renderInlineValue(tool.args, 220, '{}');
    const resultInline = renderInlineValue(tool.result ?? null, 320, 'null');
    return `• Called ${tool.name}(${argsInline})\n  └ ${resultInline}`;
  }, [formatPosbistroSummaryInline]);

  const formatInlinePretty = useCallback((tool: ToolInvocation): string => {
    const header = `Called ${tool.name}`;

    const prettyArgs = formatStructuredValue(tool.args, 2, '{}');
    const prettyResult = formatStructuredValue(tool.result ?? null, 2, 'null');

    const argsSection = prettyArgs.includes('\n') ? `Args:\n${prettyArgs}` : `Args: ${prettyArgs}`;
    const resultSection = prettyResult.includes('\n') ? `Result:\n${prettyResult}` : `Result: ${prettyResult}`;

    return `${header}\n${argsSection}\n${resultSection}`;
  }, []);

  const sessionContext = useMemo(() => {
    const metrics = deriveSessionInsights(toolResults);
    const model = selectedModel || availableModels[0] || healthQuery.data?.openai.model || 'gpt-4.1';
    if (!metrics) {
      return { model };
    }
    return { ...metrics, model };
  }, [toolResults, selectedModel, availableModels, healthQuery.data?.openai.model]);

  const suggestedPrompts = useMemo(() => {
    const effectiveLocation = (uiLocation || (sessionContext as any)?.location || '').toString();
    const locLabel = effectiveLocation || 'gardenbistro';
    const periodLabel = uiPeriod === 'today' ? 'dziś' : uiPeriod === 'yesterday' ? 'wczoraj' : 'ostatnich 7 dni';
    const range = uiPeriod === '7d' ? 'z ostatnich 7 dni' : periodLabel;
    return [
      `Pokaż obroty ${locLabel} ${range}`,
      `Zestawienie brutto/netto ${range} (${locLabel})`,
      `Top 5 pozycji sprzedaży ${periodLabel} (${locLabel})`,
      `Ile paragonów było ${periodLabel} w ${formatHumanLocation(locLabel)}?`,
      `Porównaj ${uiPeriod === 'today' ? 'dzisiaj vs wczoraj' : 'ostatnie 7 dni vs poprzednie 7 dni'} (${locLabel})`,
      'Zużycie narzędzi MCP w tej sesji',
    ];
  }, [uiLocation, uiPeriod, (sessionContext as any)?.location]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const isMeta = e.ctrlKey || e.metaKey;
      if (isMeta && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setIsToolsOpen(true);
        setTimeout(() => dockSearchRef.current?.focus(), 0);
        return;
      }
      if (isMeta && e.key.toLowerCase() === 'i') {
        e.preventDefault();
        chatInputRef.current?.focus();
        return;
      }
      if (e.key === 'Escape') {
        if (isHistoryOpen) setIsHistoryOpen(false);
        if (isSessionDrawerOpen) setIsSessionDrawerOpen(false);
        if (selectedToolResult) setSelectedToolResult(null);
        if (selectedToolInfo) setSelectedToolInfo(null);
        if (isToolsOpen) setIsToolsOpen(false);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [isHistoryOpen, isSessionDrawerOpen, selectedToolResult, selectedToolInfo, isToolsOpen]);

  const formatSessionTimestamp = useCallback((value?: string) => {
    if (!value) {
      return 'Nieznana data';
    }
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return 'Nieznana data';
    }
    return new Intl.DateTimeFormat('pl-PL', {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(date);
  }, []);

  const formatSessionPreviewLabel = useCallback((session: SessionSummary) => {
    if (session.lastMessageRole === 'assistant') {
      return 'Ostatnia odpowiedź asystenta';
    }
    if (session.lastMessageRole === 'user') {
      return 'Ostatnia wiadomość użytkownika';
    }
    return 'Ostatnia aktywność';
  }, []);

  const toggleFavoriteTool = useCallback(
    (key: string) => {
      setFavoriteToolKeys((prev) => (prev.includes(key) ? prev.filter((item) => item !== key) : [...prev, key]));
    },
    [setFavoriteToolKeys],
  );

  const handleSelectTool = useCallback(
    (tool: ToolInfo) => {
      setSelectedToolInfo(tool);
      if (typeof window !== 'undefined' && window.innerWidth < 1024) {
        setIsToolsOpen(false);
      }
    },
    [setSelectedToolInfo, setIsToolsOpen],
  );

  const toolsQuery = useQuery({
    queryKey: ['tools', baseUrl, auth.token],
    enabled: authReady,
    queryFn: async () => {
      const res = await authorizedFetch(`${baseUrl}/mcp/tools`);
      if (!res.ok) throw new Error('Nie udało się pobrać listy narzędzi');
      return (await res.json()) as ToolInfo[];
    },
  });

  const toolGroups: ToolGroupInfo[] = useMemo(() => {
    const grouped = new Map<string, ToolInfo[]>();
    for (const tool of toolsQuery.data ?? []) {
      const entry = grouped.get(tool.serverId) ?? [];
      entry.push(tool);
      grouped.set(tool.serverId, entry);
    }
    return Array.from(grouped.entries())
      .map(([serverId, tools]): ToolGroupInfo => ({
        serverId,
        tools: tools.slice().sort((a, b) => a.name.localeCompare(b.name)),
      }))
      .sort((a, b) => a.serverId.localeCompare(b.serverId));
  }, [toolsQuery.data]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handleResize = () => {
      if (window.innerWidth >= 900) {
        setIsToolsOpen(true);
      }
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);


  const syncConversationState = useCallback(
    (messages: ChatMessage[], toolHistory: ToolInvocation[]) => {
      const displayMessages = filterDisplayMessages(messages);
      const normalizedToolHistory = Array.isArray(toolHistory) ? [...toolHistory] : [];
      setHistory(displayMessages);
      setToolResults(normalizedToolHistory);
      setAssistantToolCounts(computeAssistantToolCounts(displayMessages, normalizedToolHistory));
    },
    [filterDisplayMessages],
  );

  const loadSession = useCallback(async (id: string) => {
    if (!authReady) {
      return;
    }
    try {
      const res = await authorizedFetch(`${baseUrl}/sessions/${id}`);
      if (!res.ok) {
        if (res.status === 404) {
          setHistory([]);
          setToolResults([]);
          setAssistantToolCounts([]);
          if (typeof window !== 'undefined') {
            const newId = window.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2);
            const params = new URLSearchParams(window.location.search);
            params.set('session', newId);
            window.history.replaceState(null, '', `${window.location.pathname}?${params.toString()}`);
            setSessionId(newId);
          }
          return;
        }
        throw new Error(`Nie udało się pobrać sesji (${res.status})`);
      }
      const data = await res.json();
      const toolHistory = (data.toolHistory ?? data.toolResults ?? []) as ToolInvocation[];
      syncConversationState(data.messages ?? [], toolHistory);
      setPendingMessages([]);
      void refreshUsage(id);
      void refreshSessionList({ silent: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Nie udało się pobrać sesji');
    }
  }, [authReady, authorizedFetch, baseUrl, refreshSessionList, refreshUsage, setSessionId, syncConversationState]);

  useEffect(() => {
    if (!authReady || hasInitialisedSession.current) {
      return;
    }

    hasInitialisedSession.current = true;

    const params = new URLSearchParams(window.location.search);
    const existingId = params.get('session');
    if (existingId) {
      setSessionId(existingId);
      setIsRestoring(true);
      void loadSession(existingId).finally(() => setIsRestoring(false));
      return;
    }
    const newId = window.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2);
    params.set('session', newId);
    window.history.replaceState(null, '', `${window.location.pathname}?${params.toString()}`);
    setSessionId(newId);
    setHistory([]);
    setToolResults([]);
    setAssistantToolCounts([]);
  }, [authReady, loadSession]);

  useEffect(() => {
    if (!authReady) {
      hasInitialisedSession.current = false;
    }
  }, [authReady]);

  useEffect(() => {
    if (!budgetEvaluation) {
      setBudgetWarning(false);
      return;
    }
    setBudgetWarning(
      (budgetEvaluation.hardLimitBreaches?.length ?? 0) > 0 || (budgetEvaluation.softLimitBreaches?.length ?? 0) > 0,
    );
  }, [budgetEvaluation]);

  useEffect(() => {
    if (!hasAdminAccess()) {
      setBudgetDrawerOpen(false);
    }
  }, [hasAdminAccess]);

  useEffect(() => {
    if (!authReady || !sessionId) {
      return;
    }

    if (sessionId) {
      void refreshUsage(sessionId);
    }
  }, [authReady, refreshUsage, sessionId]);

  const openSessionsDrawer = useCallback(() => {
    setIsSessionDrawerOpen(true);
    void refreshSessionList();
  }, [refreshSessionList]);

  const closeSessionsDrawer = useCallback(() => {
    setIsSessionDrawerOpen(false);
  }, []);

  const openBudgetDrawer = useCallback(() => {
    setBudgetDrawerOpen(true);
    void refreshBudgets();
    void refreshBudgetEvaluation();
  }, [refreshBudgets, refreshBudgetEvaluation]);

  const closeBudgetDrawer = useCallback(() => {
    setBudgetDrawerOpen(false);
  }, []);

  const handleSelectSession = useCallback(
    (id: string) => {
      if (!id) {
        return;
      }
      if (id === sessionId) {
        setIsSessionDrawerOpen(false);
        return;
      }
      if (typeof window !== 'undefined') {
        const params = new URLSearchParams(window.location.search);
        params.set('session', id);
        window.history.replaceState(null, '', `${window.location.pathname}?${params.toString()}`);
      }
      setIsSessionDrawerOpen(false);
      setIsRestoring(true);
      setSessionId(id);
      void loadSession(id).finally(() => {
        setIsRestoring(false);
      });
    },
    [sessionId, loadSession],
  );

  const sendMessage = async (content: string) => {
    if (!authReady) {
      setError('Brak autoryzacji — zaloguj się, aby kontynuować.');
      return;
    }
    setError(null);
    setIsBusy(true);
    const generatedSession = window.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2);
    const resolvedSessionId = sessionId ?? generatedSession;
    if (!sessionId) {
      setSessionId(resolvedSessionId);
      const params = new URLSearchParams(window.location.search);
      params.set('session', resolvedSessionId);
      window.history.replaceState(null, '', `${window.location.pathname}?${params.toString()}`);
    }
    const now = new Date();
    const userMessage: ChatMessage = { role: 'user', content, timestamp: now.toISOString() };
    const localeFormatter = new Intl.DateTimeFormat('pl-PL', {
      dateStyle: 'long',
      timeStyle: 'medium',
    });
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'UTC';
    const contextMessage: ChatMessage = {
      role: 'system',
      content: `Aktualny czas użytkownika: ${localeFormatter.format(now)} (strefa ${timeZone})`,
      timestamp: now.toISOString(),
    };
    setPendingMessages((prev) => [...prev, userMessage]);

    const payload = {
      sessionId: resolvedSessionId,
      messages: [systemMessage, contextMessage, ...history, userMessage],
      model: selectedModel || undefined,
    };

    try {
      const streamingEnabled = ((import.meta as any)?.env?.VITE_CHAT_STREAMING ?? 'true').toString() !== 'false';
      if (streamingEnabled) {
        const assistantIndex = pendingMessages.length; // position to append deltas
        let assistantAccum = '';
        const toolArgsById = new Map<string, unknown>();
        const controller = new AbortController();
        streamAbortRef.current = controller;
        await chatStream(
          `${baseUrl}/chat/stream`,
          payload,
          {
            onAssistantDelta: (text) => {
              assistantAccum += text;
              const assistantMsg: ChatMessage = { role: 'assistant', content: assistantAccum };
              setPendingMessages((prev) => {
                const base = prev.filter((m) => m !== userMessage);
                const withUser = [...base, userMessage];
                // Replace or append assistant
                return [...withUser.slice(0, assistantIndex + 1), assistantMsg];
              });
            },
            onAssistantDone: (content, ms) => {
              const assistantMsg: ChatMessage = { role: 'assistant', content, metadata: ms ? { llmDurationMs: ms } : undefined };
              setPendingMessages((prev) => [...prev.filter((m) => m !== userMessage), userMessage, assistantMsg]);
            },
            onToolStarted: (id, name, args) => {
              toolArgsById.set(id, args);
              const rec: ToolInvocation = { name, args, result: { status: 'running' }, timestamp: new Date().toISOString() };
              setToolResults((prev) => [...prev, rec]);
            },
            onToolCompleted: (id, name, result) => {
              const args = toolArgsById.get(id) ?? {};
              setToolResults((prev) => [...prev, { name, args, result, timestamp: new Date().toISOString() }]);
            },
            onBudgetWarning: (details) => {
              setBudgetWarning(true);
            },
            onBudgetBlocked: (details) => {
              setBudgetWarning(true);
              setError('Przekroczono limit budżetu');
            },
            onFinal: (sid, messages, historyItems) => {
              const newSessionId = sid || resolvedSessionId;
              if (newSessionId !== sessionId) {
                setSessionId(newSessionId);
                const params = new URLSearchParams(window.location.search);
                params.set('session', newSessionId);
                window.history.replaceState(null, '', `${window.location.pathname}?${params.toString()}`);
              }
              const mergedToolHistory = Array.isArray(historyItems) ? (historyItems as ToolInvocation[]) : [];
              const finalToolHistory = mergedToolHistory.length > 0 ? mergedToolHistory : toolResults;
              // Prefer server messages when provided
              const serverMessages: ChatMessage[] = Array.isArray(messages) ? (messages as ChatMessage[]) : [];
              if (serverMessages.length > 0) {
                syncConversationState(serverMessages, finalToolHistory);
              } else {
                // Fallback: commit pending buffer
                if (assistantAccum) {
                  syncConversationState(
                    [...history, userMessage, { role: 'assistant', content: assistantAccum }],
                    finalToolHistory,
                  );
                } else {
                  syncConversationState([...history, userMessage], finalToolHistory);
                }
              }
              setPendingMessages([]);
              void refreshUsage(newSessionId);
              void refreshSessionList({ silent: true });
            },
            onError: (message) => {
              setError(message);
            },
          },
          controller.signal,
        );
      } else {
        // Fallback to legacy non-streaming endpoint
        const response = await authorizedFetch(`${baseUrl}/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (!response.ok) {
          const bodyText = await response.text();
          throw new Error(bodyText || `Błąd ${response.status}`);
        }
        const data = await response.json();
        if (data?.budgets?.after) {
          setBudgetEvaluation(data.budgets.after as BudgetEvaluation);
        } else if (data?.budgets?.before) {
          setBudgetEvaluation(data.budgets.before as BudgetEvaluation);
        }
        const assistantMessage: ChatMessage | undefined = data?.message;
        const newSessionId: string = data?.sessionId ?? resolvedSessionId;
        if (newSessionId !== sessionId) {
          setSessionId(newSessionId);
          const params = new URLSearchParams(window.location.search);
          params.set('session', newSessionId);
          window.history.replaceState(null, '', `${window.location.pathname}?${params.toString()}`);
        }
        const combinedToolHistory: ToolInvocation[] = Array.isArray(data?.toolHistory)
          ? data.toolHistory
          : Array.isArray(data?.toolResults)
            ? [...toolResults, ...data.toolResults]
            : toolResults;
        const serverMessages: ChatMessage[] | undefined = data?.messages;
        if (serverMessages && serverMessages.length > 0) {
          syncConversationState(serverMessages, combinedToolHistory);
        } else if (assistantMessage) {
          syncConversationState([...history, userMessage, assistantMessage], combinedToolHistory);
        } else {
          syncConversationState([...history, userMessage], combinedToolHistory);
        }
        setPendingMessages((prev) => prev.slice(prev.findIndex((msg) => msg === userMessage) + 1));
        const normalizedUsage = extractUsageSummary(data?.usage);
        if (normalizedUsage) {
          setUsageSummary(normalizedUsage);
        } else {
          void refreshUsage(newSessionId);
        }
        void refreshSessionList({ silent: true });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Nieznany błąd';
      setError(message);
    } finally {
      setIsBusy(false);
      streamAbortRef.current = null;
    }
  };

  const adjustFont = (delta: number) => {
    setFontScale((prev) => {
      const next = Math.round((prev + delta) * 100) / 100;
      return clampFont(next);
    });
  };

  const resetFont = () => setFontScale(1.1);

  if (authLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-surface px-4 py-12">
        <div className="glass-panel w-full max-w-md space-y-4 px-6 py-8 text-center">
          <h1 className="text-xl font-semibold text-white">Łączenie z usługą logowania…</h1>
          <p className="text-sm text-slate-300">Trwa inicjalizacja połączenia z Keycloak. Proszę czekać.</p>
          <button
            type="button"
            onClick={handleLogin}
            className="inline-flex items-center justify-center rounded-full border border-accent/40 bg-accent/20 px-5 py-2 text-sm font-semibold uppercase tracking-wide text-accent transition hover:bg-accent/30"
          >
            Przejdź do logowania
          </button>
        </div>
      </div>
    );
  }

  if (requiresLogin) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-surface px-4 py-12">
        <div className="glass-panel w-full max-w-md space-y-4 px-6 py-8 text-center">
          <h1 className="text-xl font-semibold text-white">Wymagane logowanie</h1>
          <p className="text-sm text-slate-300">Zaloguj się, aby korzystać z aplikacji i narzędzi MCP.</p>
          {auth.error ? <p className="rounded-2xl border border-danger/40 bg-danger/20 px-4 py-2 text-sm text-danger">{auth.error}</p> : null}
          <button
            type="button"
            onClick={handleLogin}
            className="inline-flex items-center justify-center rounded-full border border-accent/40 bg-accent/20 px-5 py-2 text-sm font-semibold uppercase tracking-wide text-accent transition hover:bg-accent/30"
          >
            Zaloguj przez Keycloak
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <div className="mx-auto flex min-h-screen w-full max-w-screen-2xl flex-col gap-6 px-4 pb-32 pt-6">
        <AppHeader
          isBusy={isBusy}
          isRestoring={isRestoring}
          toolsLoading={toolsQuery.isLoading}
          canOpenHistory={toolResults.length > 0}
          onOpenHistory={() => setIsHistoryOpen(true)}
          onOpenSessions={openSessionsDrawer}
          onOpenBudgets={openBudgetDrawer}
          isToolsOpen={isToolsOpen}
          onToggleTools={() => setIsToolsOpen((prev) => !prev)}
          fontScaleLabel={`${Math.round(fontScale * 100)}%`}
          onDecreaseFont={() => adjustFont(-0.1)}
          onIncreaseFont={() => adjustFont(0.1)}
          onResetFont={resetFont}
          onCancelStream={() => {
            const ctrl = streamAbortRef.current;
            if (ctrl) {
              ctrl.abort();
              setError('Anulowano.');
              setIsBusy(false);
            }
          }}
          showInlineTools={showInlineTools}
          onToggleInlineTools={() => setShowInlineTools((prev) => !prev)}
          statuses={buildStatuses(healthQuery)}
          usage={usageSummary}
          models={availableModels.length > 0 ? availableModels : [selectedModel || healthQuery.data?.openai.model || 'gpt-4.1']}
          selectedModel={selectedModel || availableModels[0] || healthQuery.data?.openai.model || 'gpt-4.1'}
          onSelectModel={setSelectedModel}
          authEnabled={auth.enabled}
          authLoading={authLoading}
          isAuthenticated={authReady}
          userLabel={userDisplayName}
          userTooltip={authTooltip}
          accountId={accountIdentifier}
          onLogin={handleLogin}
          onLogout={handleLogout}
          canManageBudgets={hasAdminAccess()}
          budgetWarning={budgetWarning}
        />

        <div className="sticky top-6 z-20">
          <SessionContextBar
            context={sessionContext}
            uiLocation={uiLocation || sessionContext.location || null}
            uiPeriod={uiPeriod}
            onCyclePeriod={() => setUiPeriod((p) => (p === 'today' ? 'yesterday' : p === 'yesterday' ? '7d' : 'today'))}
            onClearLocation={() => setUiLocation('')}
          />
        </div>

        {authReady ? (
          <div className="glass-panel flex flex-wrap items-center justify-between gap-3 px-5 py-3 text-sm text-slate-200">
            <div className="flex flex-wrap items-center gap-3">
              <span>
                Zalogowano jako <strong>{userDisplayName || 'Użytkownik'}</strong>
              </span>
              {accountIdentifier ? (
                <span>
                  Konto: <strong>{accountIdentifier}</strong>
                </span>
              ) : null}
              {usageSummary && Number.isFinite(usageSummary.costUsd) ? (
                <span className="chip chip-primary">Koszt sesji: ${usageSummary.costUsd.toFixed(4)}</span>
              ) : null}
            </div>
            <button
              type="button"
              onClick={handleLogout}
              className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-slate-200 transition hover:border-danger/40 hover:bg-danger/20 hover:text-danger"
            >
              Wyloguj
            </button>
          </div>
        ) : null}

        {error ? (
          <div className="rounded-2xl border border-danger/40 bg-danger/15 px-4 py-3 text-sm text-danger">
            {error}
          </div>
        ) : null}

        <div className="flex flex-1 flex-col gap-6 lg:flex-row">
          <section className="flex min-h-0 flex-1 flex-col">
            <MessageList
              messages={[...history, ...pendingMessages]}
              toolResults={toolResults}
              assistantToolCounts={assistantToolCounts}
              onSelectToolResult={setSelectedToolResult}
              inlineSummaryFormatter={formatInlineSummary}
              toolDetailsFormatter={formatInlinePretty}
              isBusy={isBusy}
              fontScale={fontScale}
              showInlineTools={showInlineTools}
              suggestedPrompts={suggestedPrompts}
              onInsertPrompt={(text: string) => {
                chatInputHandleRef.current?.insert(text);
                setTimeout(() => chatInputHandleRef.current?.focus(), 0);
              }}
            />
          </section>
          <div className="hidden lg:block lg:w-80 lg:flex-shrink-0">
            <ToolDock
              open={isToolsOpen}
              groups={toolGroups}
              history={toolResults}
              favorites={favoriteToolKeys}
              onToggleFavorite={toggleFavoriteTool}
              onSelectTool={handleSelectTool}
              searchRef={dockSearchRef}
            />
          </div>
        </div>

        <ChatInput
          disabled={isRestoring || !authReady}
          busy={isBusy}
          onSubmit={sendMessage}
          suggestions={Array.from(new Set((toolsQuery.data ?? []).map((t) => t.name))).sort((a, b) => a.localeCompare(b))}
          inputRef={chatInputRef}
          ref={chatInputHandleRef}
        />
      </div>

      {isToolsOpen ? (
        <div className="fixed inset-0 z-40 flex items-stretch lg:hidden" onClick={() => setIsToolsOpen(false)}>
          <div className="flex-1 bg-black/60 backdrop-blur-sm" />
          <div className="h-full w-80 bg-surface px-4 py-6" onClick={(event) => event.stopPropagation()}>
            <ToolDock
              open
              groups={toolGroups}
              history={toolResults}
              favorites={favoriteToolKeys}
              onToggleFavorite={toggleFavoriteTool}
              onSelectTool={handleSelectTool}
              searchRef={dockSearchRef}
            />
          </div>
        </div>
      ) : null}

      {isSessionDrawerOpen ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 backdrop-blur-sm" onClick={closeSessionsDrawer}>
          <div className="glass-panel w-full max-w-4xl overflow-hidden" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-white/5 px-6 py-4">
              <div>
                <div className="text-lg font-semibold text-white">Zapisane sesje</div>
                <div className="text-sm text-slate-400">Wybierz rozmowę, aby ją przywrócić</div>
              </div>
              <button
                type="button"
                className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-sm text-slate-300 hover:border-white/30 hover:bg-white/10"
                onClick={closeSessionsDrawer}
              >
                Zamknij
              </button>
            </div>
            <div className="max-h-[70vh] overflow-y-auto px-6 py-4 space-y-3 scrollbar-thin">
              {isSessionsLoading ? <div className="chip chip-muted">Ładowanie…</div> : null}
              {sessionsError ? <div className="rounded-2xl border border-danger/40 bg-danger/15 px-4 py-2 text-sm text-danger">{sessionsError}</div> : null}
              {sessionSummaries.length === 0 && !isSessionsLoading ? (
                <div className="rounded-2xl border border-dashed border-white/10 bg-white/5 px-4 py-3 text-sm text-slate-400">Brak zapisanych rozmów</div>
              ) : null}
              {sessionSummaries.map((summary) => {
                const isActive = summary.id === sessionId;
                const previewLabel = formatSessionPreviewLabel(summary);
                const rawPreview = summary.lastMessagePreview?.trim() ?? '';
                const previewText = rawPreview.length > 0 ? rawPreview : 'Brak treści';
                const updatedLabel = formatSessionTimestamp(summary.updatedAt ?? summary.lastMessageAt);
                return (
                  <div
                    key={summary.id}
                    className={`rounded-2xl border px-5 py-4 transition ${isActive ? 'border-primary/50 bg-primary/10' : 'border-white/5 bg-white/5 hover:border-white/15 hover:bg-white/10'}`}
                  >
                    <div className="flex items-center justify-between text-sm text-slate-300">
                      <span className="font-semibold text-white">Sesja {summary.id.slice(0, 8)}</span>
                      <span className="text-xs text-slate-400">{updatedLabel}</span>
                    </div>
                    <div className="mt-2 text-xs text-slate-400">
                      {summary.messageCount} wiadomości • {summary.toolResultCount} wywołań MCP
                    </div>
                    <div className="mt-3 rounded-2xl border border-white/5 bg-white/5 px-4 py-3 text-sm text-slate-200" title={previewText}>
                      <strong>{previewLabel}:</strong> {previewText}
                    </div>
                    <div className="mt-3 flex justify-end">
                      <button
                        type="button"
                        onClick={() => handleSelectSession(summary.id)}
                        disabled={isActive}
                        className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs uppercase tracking-wide text-slate-200 transition hover:border-primary/40 hover:bg-primary/20 hover:text-primary disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {isActive ? 'Otwarta' : 'Otwórz'}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      ) : null}

      {isHistoryOpen ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/75 backdrop-blur-sm" onClick={() => setIsHistoryOpen(false)}>
          <div className="glass-panel w-full max-w-4xl overflow-hidden" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-white/5 px-6 py-4">
              <div>
                <div className="text-lg font-semibold text-white">Historia narzędzi</div>
                <div className="text-sm text-slate-400">Ostatnie {Math.min(toolResults.length, 20)} wpisów</div>
              </div>
              <button
                type="button"
                className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-sm text-slate-300 hover:border-white/30 hover:bg-white/10"
                onClick={() => setIsHistoryOpen(false)}
              >
                Zamknij
              </button>
            </div>
            <div className="max-h-[70vh] overflow-y-auto px-6 py-4 space-y-3 scrollbar-thin">
              {toolResults.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-white/10 bg-white/5 px-4 py-3 text-sm text-slate-400">Brak wywołań narzędzi.</div>
              ) : (
                toolResults
                  .slice(-20)
                  .reverse()
                  .map((entry, idx) => {
                    const summary = formatInlineSummary(entry);
                    const pretty = formatInlinePretty(entry);
                    return (
                      <div key={`${entry.name}-${idx}`} className="rounded-2xl border border-white/5 bg-white/5 px-5 py-4">
                        <div className="flex items-center justify-between text-sm text-slate-300">
                          <span className="font-semibold text-white">{entry.name}</span>
                          {entry.timestamp ? (
                            <span className="text-xs text-slate-400">{new Date(entry.timestamp).toLocaleString()}</span>
                          ) : null}
                        </div>
                        <pre className="mt-3 max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-2xl bg-surface/80 px-4 py-3 text-xs text-slate-200">
                          {pretty}
                        </pre>
                        <div className="mt-3 flex justify-end">
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedToolResult(entry);
                              setIsHistoryOpen(false);
                            }}
                            className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs uppercase tracking-wide text-slate-200 transition hover:border-primary/40 hover:bg-primary/20 hover:text-primary"
                          >
                            Szczegóły
                          </button>
                        </div>
                      </div>
                    );
                  })
              )}
            </div>
          </div>
        </div>
      ) : null}

      {selectedToolResult ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm" onClick={() => setSelectedToolResult(null)}>
          <div className="glass-panel w-full max-w-4xl overflow-hidden" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-white/5 px-6 py-4">
              <div>
                <div className="text-lg font-semibold text-white">{selectedToolResult.name}</div>
                <div className="text-sm text-slate-400">
                  Args: {formatArgs(selectedToolResult.args)}
                  {selectedToolResult.timestamp ? ` • ${new Date(selectedToolResult.timestamp).toLocaleString()}` : ''}
                </div>
              </div>
              <button
                type="button"
                className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-sm text-slate-300 hover:border-white/30 hover:bg-white/10"
                onClick={() => setSelectedToolResult(null)}
              >
                Zamknij
              </button>
            </div>
            <pre className="max-h-[70vh] overflow-auto whitespace-pre-wrap break-words px-6 py-4 text-sm text-slate-200">
              {formatResult(selectedToolResult.result)}
            </pre>
          </div>
        </div>
      ) : null}

      {selectedToolInfo ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm" onClick={() => setSelectedToolInfo(null)}>
          <div className="glass-panel w-full max-w-xl overflow-hidden" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-white/5 px-6 py-4">
              <div>
                <div className="text-lg font-semibold text-white">{selectedToolInfo.name}</div>
                <div className="text-sm text-slate-400">Serwer: {selectedToolInfo.serverId}</div>
              </div>
              <button
                type="button"
                className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-sm text-slate-300 hover:border-white/30 hover:bg-white/10"
                onClick={() => setSelectedToolInfo(null)}
              >
                Zamknij
              </button>
            </div>
            <div className="px-6 py-4 text-sm text-slate-200">
              {selectedToolInfo.description ? selectedToolInfo.description : 'Brak dodatkowego opisu dla tego narzędzia.'}
            </div>
          </div>
        </div>
      ) : null}

      {hasAdminAccess() ? (
        <BudgetDrawer
          open={budgetDrawerOpen}
          onClose={closeBudgetDrawer}
          budgets={budgetItems}
          loading={budgetLoading}
          error={budgetError}
          onRefresh={handleBudgetsRefresh}
          onCreate={handleCreateBudget}
          onDelete={handleDeleteBudget}
          evaluation={budgetEvaluation}
        />
      ) : null}
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <QueryClientProvider client={queryClient}>
        <AppContent />
      </QueryClientProvider>
    </AuthProvider>
  );
}

type StatusDescriptor = {
  label: string;
  status: 'ok' | 'error' | 'loading';
  description?: string;
};

function buildStatuses(healthQuery: UseQueryResult<HealthResponse>): StatusDescriptor[] {
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

function extractUsageSummary(value: any): UsageSummary | null {
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

function computeAssistantToolCounts(messages: ChatMessage[], toolHistory: ToolInvocation[]): number[] {
  const assistantMessages = messages.filter((msg) => msg.role === 'assistant');
  if (assistantMessages.length === 0) {
    return [];
  }

  if (toolHistory.length === 0) {
    return new Array(assistantMessages.length).fill(0);
  }

  const assistantTimeline = assistantMessages
    .map((msg, idx) => ({ idx, timestamp: parseTimestampSafely(msg.timestamp, idx) }))
    .sort((a, b) => a.timestamp - b.timestamp || a.idx - b.idx);

  const counts = new Array(assistantMessages.length).fill(0);

  const toolTimeline = toolHistory
    .map((tool, idx) => ({ idx, timestamp: parseTimestampSafely(tool.timestamp, -1_000_000 + idx) }))
    .sort((a, b) => a.timestamp - b.timestamp || a.idx - b.idx);

  for (const entry of toolTimeline) {
    const target = assistantTimeline.find((assistant) => entry.timestamp <= assistant.timestamp)
      ?? assistantTimeline[assistantTimeline.length - 1];
    counts[target.idx] += 1;
  }

  return counts;
}

function parseTimestampSafely(value: string | undefined, fallback: number): number {
  if (value) {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return fallback;
}

type SessionMetrics = {
  location?: string | null;
  from?: string | null;
  to?: string | null;
  gross?: number | null;
  net?: number | null;
  receipts?: number | null;
  timestamp?: string | null;
};

function SessionContextBar({ context, uiLocation, uiPeriod, onCyclePeriod, onClearLocation }: { context: SessionMetrics & { model: string }; uiLocation: string | null; uiPeriod: 'today' | 'yesterday' | '7d'; onCyclePeriod: () => void; onClearLocation: () => void }) {
  const period = formatSessionPeriodLabel(context.from, context.to) ?? labelForUiPeriod(uiPeriod);
  const updateLabel = context.timestamp
    ? new Intl.DateTimeFormat('pl-PL', { hour: '2-digit', minute: '2-digit' }).format(new Date(context.timestamp))
    : null;

  return (
    <div className="glass-panel mx-auto flex w-full max-w-4xl flex-wrap items-center gap-2 px-5 py-3">
      <span className="chip chip-accent">Model: {context.model}</span>
      <button type="button" className="chip hover:bg-white/10" title={uiLocation ? 'Wyczyść lokalizację' : 'Brak lokalizacji'} onClick={() => uiLocation && onClearLocation()}>
        {uiLocation ?? context.location ?? 'Brak lokalizacji'}
      </button>
      <button type="button" className="chip chip-muted hover:bg-white/10" title="Zmień okres (Dziś/Wczoraj/7 dni)" onClick={onCyclePeriod}>
        Okres: {period}
      </button>
      <span className="chip chip-primary">Brutto: {formatPln(context.gross)}</span>
      <span className="chip chip-primary">Netto: {formatPln(context.net)}</span>
      <span className="chip chip-primary">Paragony: {formatReceipts(context.receipts)}</span>
      {updateLabel ? <span className="chip chip-muted">Aktualizacja: {updateLabel}</span> : null}
    </div>
  );
}

function labelForUiPeriod(p: 'today' | 'yesterday' | '7d'): string {
  return p === 'today' ? 'Dziś' : p === 'yesterday' ? 'Wczoraj' : '7 dni';
}

function formatHumanLocation(value: string): string {
  // Prosty prettifier aliasów jak 'gardenbistro' -> 'Garden Bistro'
  return value
    .replace(/[_-]/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function deriveSessionInsights(toolResults: ToolInvocation[]): SessionMetrics | null {
  for (let index = toolResults.length - 1; index >= 0; index -= 1) {
    const tool = toolResults[index];
    const result = tool.result as any;
    if (!result || typeof result !== 'object') {
      continue;
    }

    const location = extractLocation(tool);
    const from = typeof result.from === 'string' ? result.from : typeof result.window?.from === 'string' ? result.window.from : undefined;
    const to = typeof result.to === 'string' ? result.to : typeof result.window?.to === 'string' ? result.window.to : undefined;

    const summary = typeof result.summary === 'object' && result.summary !== null ? result.summary : undefined;
    const totals = typeof result.totals === 'object' && result.totals !== null ? result.totals : undefined;

    const gross = parseMetricNumber(
      result.gross ??
        summary?.gross_expenditures_total ??
        summary?.gross ??
        totals?.gross ??
        totals?.grossTotal,
    );
    const net = parseMetricNumber(
      result.net ??
        summary?.net_expenditures_total ??
        summary?.net ??
        totals?.net ??
        totals?.netTotal,
    );
    let receipts = parseMetricNumber(result.receipts ?? summary?.receipt_count ?? summary?.receipts ?? totals?.receipts);
    if (receipts === null && Array.isArray(result.entries)) {
      receipts = result.entries.length;
    }

    const metrics: SessionMetrics = {
      location,
      from: from ?? null,
      to: to ?? null,
      gross,
      net,
      receipts,
      timestamp: tool.timestamp ?? null,
    };

    const hasData = Object.values(metrics).some((value) => value !== null && value !== undefined);
    if (hasData) {
      return metrics;
    }
  }
  return null;
}

function extractLocation(tool: ToolInvocation): string | null {
  const result = tool.result as any;
  if (typeof result?.location === 'string' && result.location.trim().length > 0) {
    return result.location.trim();
  }
  if (result?.meta && typeof result.meta === 'object' && typeof result.meta.location === 'string') {
    const candidate = result.meta.location.trim();
    if (candidate.length > 0) {
      return candidate;
    }
  }
  if (tool.args && typeof tool.args === 'object' && tool.args !== null) {
    const candidate = (tool.args as Record<string, unknown>).location;
    if (typeof candidate === 'string' && candidate.trim().length > 0) {
      return candidate.trim();
    }
  }
  return null;
}

function formatSessionPeriodLabel(from?: string | null, to?: string | null): string | null {
  const fromDate = parseIsoDate(from);
  const toDate = parseIsoDate(to);

  if (!fromDate && !toDate) {
    return null;
  }

  const formatter = new Intl.DateTimeFormat('pl-PL', { dateStyle: 'medium' });

  if (fromDate && toDate) {
    if (fromDate.getTime() === toDate.getTime()) {
      return describeRelativeDay(fromDate) ?? formatter.format(fromDate);
    }
    return `${formatter.format(fromDate)} → ${formatter.format(toDate)}`;
  }

  const single = fromDate ?? toDate;
  if (!single) {
    return null;
  }
  return describeRelativeDay(single) ?? formatter.format(single);
}

function describeRelativeDay(date: Date): string | null {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(date);
  target.setHours(0, 0, 0, 0);

  const diffMs = target.getTime() - today.getTime();
  const oneDay = 24 * 60 * 60 * 1000;

  if (Math.abs(diffMs) < oneDay / 2) {
    return 'Dziś';
  }
  if (Math.abs(diffMs + oneDay) < oneDay / 2) {
    return 'Wczoraj';
  }
  if (Math.abs(diffMs - oneDay) < oneDay / 2) {
    return 'Jutro';
  }
  return null;
}

function formatPln(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return '—';
  }
  return new Intl.NumberFormat('pl-PL', {
    style: 'currency',
    currency: 'PLN',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function formatReceipts(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return '—';
  }
  return new Intl.NumberFormat('pl-PL').format(value);
}

function parseMetricNumber(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function parseIsoDate(value?: string | null): Date | null {
  if (!value) {
    return null;
  }
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  return new Date(parsed);
}
