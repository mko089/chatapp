import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useQuery, QueryClient, QueryClientProvider, type UseQueryResult } from '@tanstack/react-query';
import { MessageList } from './components/MessageList';
import { ChatInput } from './components/ChatInput';
import { AppHeader } from './components/AppHeader';
import { ToolGroupsPanel } from './components/ToolGroupsPanel';
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
  content: 'You are a helpful assistant working with Garden MCP tools (meters, employee).',
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

  const baseUrl = useMemo(() => {
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
  }, []);
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
  const [selectedToolGroupId, setSelectedToolGroupId] = useState<string | null>(null);
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
    if (userRoles.length > 0) {
      segments.push(`Role: ${userRoles.join(', ')}`);
    }
    return segments.join('\n');
  }, [accountIdentifier, auth.user, userRoles]);

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
    (messages: ChatMessage[]): ChatMessage[] => (messages ?? []).filter((msg) => msg.role !== 'system'),
    [],
  );

  const formatInlineSummary = useCallback((tool: ToolInvocation): string => {
    const argsInline = renderInlineValue(tool.args, 220, '{}');
    const resultInline = renderInlineValue(tool.result ?? null, 320, 'null');
    return `• Called ${tool.name}(${argsInline})\n  └ ${resultInline}`;
  }, []);

  const formatInlinePretty = useCallback((tool: ToolInvocation): string => {
    const header = `Called ${tool.name}`;

    const prettyArgs = formatStructuredValue(tool.args, 2, '{}');
    const prettyResult = formatStructuredValue(tool.result ?? null, 2, 'null');

    const argsSection = prettyArgs.includes('\n') ? `Args:\n${prettyArgs}` : `Args: ${prettyArgs}`;
    const resultSection = prettyResult.includes('\n') ? `Result:\n${prettyResult}` : `Result: ${prettyResult}`;

    return `${header}\n${argsSection}\n${resultSection}`;
  }, []);

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

  const formatServerLabel = useCallback((serverId: string) => {
    return serverId
      .replace(/[_-]/g, ' ')
      .replace(/\b\w/g, (char) => char.toUpperCase());
  }, []);

  const formatGroupDescription = useCallback((group: ToolGroupInfo) => {
    const readable = formatServerLabel(group.serverId);
    return `${readable} • ${group.tools.length} narzędzi MCP`;
  }, [formatServerLabel]);

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

  const selectedToolGroup = useMemo(() => {
    if (!selectedToolGroupId) {
      return null;
    }
    return toolGroups.find((group) => group.serverId === selectedToolGroupId) ?? null;
  }, [selectedToolGroupId, toolGroups]);

  useEffect(() => {
    if (!selectedToolGroup) {
      setSelectedToolInfo(null);
    }
  }, [selectedToolGroup]);

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

  useEffect(() => {
    if (!isToolsOpen) {
      setSelectedToolGroupId(null);
    }
  }, [isToolsOpen]);

  const syncConversationState = useCallback(
    (messages: ChatMessage[], toolHistory: ToolInvocation[]) => {
      const displayMessages = filterDisplayMessages(messages);
      setHistory(displayMessages);
      setToolResults(toolHistory);
      setAssistantToolCounts((prev) => {
        const assistantCount = displayMessages.filter((msg) => msg.role === 'assistant').length;
        if (assistantCount === 0) {
          return [];
        }
        const trimmedPrev = prev.slice(0, assistantCount);
        const existingSum = trimmedPrev.reduce((sum, value) => sum + value, 0);
        const total = toolHistory.length;
        const delta = Math.max(0, total - existingSum);
        const next = new Array(assistantCount).fill(0);
        for (let i = 0; i < assistantCount - 1; i += 1) {
          next[i] = trimmedPrev[i] ?? 0;
        }
        const lastIndex = assistantCount - 1;
        const existingLast = trimmedPrev[lastIndex] ?? 0;
        next[lastIndex] = existingLast + delta;
        return next;
      });
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
              const combined = [...toolResults, ...historyItems];
              // Prefer server messages when provided
              const serverMessages: ChatMessage[] = Array.isArray(messages) ? (messages as ChatMessage[]) : [];
              if (serverMessages.length > 0) {
                syncConversationState(serverMessages, combined);
              } else {
                // Fallback: commit pending buffer
                if (assistantAccum) {
                  syncConversationState([...history, userMessage, { role: 'assistant', content: assistantAccum }], combined);
                } else {
                  syncConversationState([...history, userMessage], combined);
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
      <div className="auth-overlay">
        <div className="auth-card">
          <h1>Łączenie z usługą logowania…</h1>
          <p>Trwa inicjalizacja połączenia z Keycloak. Proszę czekać.</p>
          <div className="auth-actions">
            <button type="button" onClick={handleLogin}>
              Przejdź do logowania
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (requiresLogin) {
    return (
      <div className="auth-overlay">
        <div className="auth-card">
          <h1>Wymagane logowanie</h1>
          <p>Zaloguj się, aby korzystać z aplikacji i narzędzi MCP.</p>
          {auth.error ? <p className="auth-error">{auth.error}</p> : null}
          <div className="auth-actions">
            <button type="button" onClick={handleLogin}>
              Zaloguj przez Keycloak
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="app-shell" style={{ '--chat-font-scale': fontScale } as CSSProperties}>
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
        roles={userRoles}
        onLogin={handleLogin}
        onLogout={handleLogout}
        canManageBudgets={hasAdminAccess()}
        budgetWarning={budgetWarning}
      />

      {authReady ? (
        <div className="account-banner">
          <span>
            Zalogowano jako <strong>{userDisplayName || 'Użytkownik'}</strong>
          </span>
          {accountIdentifier ? (
            <span>
              Konto: <strong>{accountIdentifier}</strong>
            </span>
          ) : null}
          {normalizedRoles.length > 0 ? (
            <span>Role: {normalizedRoles.join(', ')}</span>
          ) : null}
          <button type="button" className="account-banner-action" onClick={handleLogout}>
            Wyloguj
          </button>
        </div>
      ) : null}

      {error ? <div className="error-banner">{error}</div> : null}

      <MessageList
        messages={[...history, ...pendingMessages]}
        toolResults={toolResults}
        assistantToolCounts={assistantToolCounts}
        onSelectToolResult={setSelectedToolResult}
        inlineSummaryFormatter={formatInlineSummary}
        isBusy={isBusy}
        fontScale={fontScale}
        showInlineTools={showInlineTools}
      />

      <ChatInput
        disabled={isRestoring || !authReady}
        busy={isBusy}
        onSubmit={sendMessage}
        onCancel={() => {
          const ctrl = streamAbortRef.current;
          if (ctrl) {
            ctrl.abort();
            setError('Anulowano.');
            setIsBusy(false);
          }
        }}
      />

      {isToolsOpen ? (
        <ToolGroupsPanel
          groups={toolGroups}
          isError={Boolean(toolsQuery.isError)}
          isLoading={toolsQuery.isLoading}
          onSelectGroup={(group) => setSelectedToolGroupId(group.serverId)}
        />
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

      {isSessionDrawerOpen ? (
        <div className="drawer-backdrop" onClick={closeSessionsDrawer}>
          <div className="drawer session-drawer" onClick={(event) => event.stopPropagation()}>
            <div className="drawer-header">
              <div>
                <div className="drawer-title">Zapisane sesje</div>
                <div className="drawer-subtitle">Wybierz rozmowę, aby ją przywrócić</div>
              </div>
              <button type="button" className="drawer-close" onClick={closeSessionsDrawer}>
                ×
              </button>
            </div>
            {isSessionsLoading ? <div className="session-list-status">Ładowanie…</div> : null}
            {sessionsError ? <div className="session-list-error">{sessionsError}</div> : null}
            <div className="session-list">
              {sessionSummaries.length === 0 && !isSessionsLoading ? (
                <div className="session-list-empty">Brak zapisanych rozmów</div>
              ) : null}
              {sessionSummaries.map((summary) => {
                const isActive = summary.id === sessionId;
                const previewLabel = formatSessionPreviewLabel(summary);
                const rawPreview = summary.lastMessagePreview?.trim() ?? '';
                const previewText = rawPreview.length > 0 ? rawPreview : 'Brak treści';
                const previewClass = rawPreview.length > 0
                  ? 'session-entry-preview'
                  : 'session-entry-preview session-entry-preview-empty';
                const updatedLabel = formatSessionTimestamp(summary.updatedAt ?? summary.lastMessageAt);
                return (
                  <div key={summary.id} className={`session-entry${isActive ? ' active' : ''}`}>
                    <div className="session-entry-header">
                      <div className="session-entry-title">Sesja {summary.id.slice(0, 8)}</div>
                      <div className="session-entry-time">{updatedLabel}</div>
                    </div>
                    <div className="session-entry-meta">
                      {summary.messageCount} wiadomości • {summary.toolResultCount} wywołań MCP
                    </div>
                    <div className={previewClass} title={previewText}>
                      <strong>{previewLabel}:</strong> {previewText}
                    </div>
                    <div className="session-entry-actions">
                      <button type="button" onClick={() => handleSelectSession(summary.id)} disabled={isActive}>
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

      {selectedToolGroup ? (
        <div className="drawer-backdrop" onClick={() => setSelectedToolGroupId(null)}>
          <div className="drawer tool-group-drawer" onClick={(event) => event.stopPropagation()}>
            <div className="drawer-header">
              <div>
                <div className="drawer-title">{formatServerLabel(selectedToolGroup.serverId)}</div>
                <div className="drawer-subtitle">{formatGroupDescription(selectedToolGroup)}</div>
              </div>
              <button type="button" className="drawer-close" onClick={() => setSelectedToolGroupId(null)}>
                ×
              </button>
            </div>
            <div className="tools-grid">
              {selectedToolGroup.tools.map((tool) => {
                const shortDesc = tool.description?.trim() ?? '';
                return (
                  <button
                    key={tool.name}
                    type="button"
                    className="tool-card"
                    onClick={() => setSelectedToolInfo(tool)}
                  >
                    <div className="tool-card-name">{tool.name}</div>
                    {shortDesc ? <div className="tool-card-desc">{shortDesc}</div> : null}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      ) : null}

      {isHistoryOpen ? (
        <div className="drawer-backdrop" onClick={() => setIsHistoryOpen(false)}>
          <div className="drawer" onClick={(event) => event.stopPropagation()}>
            <div className="drawer-header">
              <div>
                <div className="drawer-title">Historia wywołań narzędzi</div>
                <div className="drawer-subtitle">Ostatnie {Math.min(toolResults.length, 20)} wpisów</div>
              </div>
              <button type="button" className="drawer-close" onClick={() => setIsHistoryOpen(false)}>
                ×
              </button>
            </div>
            <div className="tool-history-list">
              {toolResults.length === 0 ? (
                <div className="tool-results-empty">Brak wywołań narzędzi.</div>
              ) : (
                toolResults
                  .slice(-20)
                  .reverse()
                  .map((entry, idx) => {
                    const summary = formatInlineSummary(entry);
                    const pretty = formatInlinePretty(entry);
                    return (
                      <div key={`${entry.name}-${idx}`} className="tool-history-entry">
                        <div className="tool-history-meta">
                          <span className="tool-history-name">{entry.name}</span>
                          {entry.timestamp ? (
                            <span className="tool-history-time">{new Date(entry.timestamp).toLocaleString()}</span>
                          ) : null}
                        </div>
                        <pre className="tool-history-preview">{pretty}</pre>
                        <div className="tool-history-actions">
                          <button type="button" onClick={() => {
                            setSelectedToolResult(entry);
                            setIsHistoryOpen(false);
                          }}>
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
        <div className="drawer-backdrop" onClick={() => setSelectedToolResult(null)}>
          <div className="drawer" onClick={(event) => event.stopPropagation()}>
            <div className="drawer-header">
              <div>
                <div className="drawer-title">Called {selectedToolResult.name}</div>
                <div className="drawer-subtitle">
                  Args: {formatArgs(selectedToolResult.args)}
                  {selectedToolResult.timestamp
                    ? ` • ${new Date(selectedToolResult.timestamp).toLocaleString()}`
                    : ''}
                </div>
              </div>
              <button type="button" className="drawer-close" onClick={() => setSelectedToolResult(null)}>
                ×
              </button>
            </div>
            <pre className="drawer-content">{formatResult(selectedToolResult.result)}</pre>
          </div>
        </div>
      ) : null}

      {selectedToolInfo ? (
        <div className="drawer-backdrop" onClick={() => setSelectedToolInfo(null)}>
          <div className="drawer" onClick={(event) => event.stopPropagation()}>
            <div className="drawer-header">
              <div>
                <div className="drawer-title">{selectedToolInfo.name}</div>
                <div className="drawer-subtitle">Serwer: {selectedToolInfo.serverId}</div>
              </div>
              <button type="button" className="drawer-close" onClick={() => setSelectedToolInfo(null)}>
                ×
              </button>
            </div>
            <div className="tool-info-content">
              {selectedToolInfo.description ? (
                <p>{selectedToolInfo.description}</p>
              ) : (
                <p>Brak dodatkowego opisu dla tego narzędzia.</p>
              )}
            </div>
          </div>
        </div>
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
