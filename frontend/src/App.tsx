import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
import { useQuery, QueryClient, QueryClientProvider, type UseQueryResult } from '@tanstack/react-query';
import { MessageList } from './components/MessageList';
import { ChatInput } from './components/ChatInput';
import { AppHeader } from './components/AppHeader';
import { ToolGroupsPanel } from './components/ToolGroupsPanel';
import { renderInlineValue } from './utils/inlineFormat';
import { usePersistentState } from './hooks/usePersistentState';
import type { ChatMessage, ToolInvocation, ToolGroupInfo, ToolInfo } from './types';

const queryClient = new QueryClient();
const systemMessage: ChatMessage = {
  role: 'system',
  content: 'You are a helpful assistant working with Garden MCP tools (meters, employee).',
};

type HealthResponse = {
  backend: 'ok';
  mcp: { status: 'ok' | 'error' | 'unknown'; error?: string };
  openai: { status: 'ok' | 'error' | 'unknown'; error?: string; model: string; allowedModels: string[] };
};

type UsageSummary = {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  costUsd: number;
};

function AppContent() {
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
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [isRestoring, setIsRestoring] = useState(false);
  const [selectedToolResult, setSelectedToolResult] = useState<ToolInvocation | null>(null);
  const [assistantToolCounts, setAssistantToolCounts] = useState<number[]>([]);
  const [pendingMessages, setPendingMessages] = useState<ChatMessage[]>([]);
  const [expandedServers, setExpandedServers] = useState<Record<string, boolean>>({});
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [isToolsOpen, setIsToolsOpen] = useState(() => {
    if (typeof window === 'undefined') {
      return true;
    }
    return window.innerWidth >= 900;
  });
  const clampFont = useCallback((value: number) => Math.min(1.6, Math.max(0.85, value)), []);

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

  const refreshUsage = useCallback(
    async (id: string) => {
      try {
        const res = await fetch(`${baseUrl}/metrics/cost`);
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
    [baseUrl],
  );

  useEffect(() => {
    const models = healthQuery.data?.openai.allowedModels ?? [];
    if (models.length > 0) {
      setAvailableModels(models);
      if (!models.includes(selectedModel)) {
        setSelectedModel(models[0]);
      }
    }
  }, [healthQuery.data?.openai.allowedModels, selectedModel, setSelectedModel]);

  const formatArgs = (args: unknown) => {
    if (args === undefined || args === null) {
      return '{}';
    }
    if (typeof args === 'string') {
      return args;
    }
    try {
      return JSON.stringify(args, null, 0);
    } catch (error) {
      return String(args);
    }
  };

  const formatResult = (result: unknown) => JSON.stringify(result ?? null, null, 2);

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

    const prettyArgs = (() => {
      if (tool.args === undefined || tool.args === null) return '{}';
      if (typeof tool.args === 'string') {
        try {
          return JSON.stringify(JSON.parse(tool.args), null, 2);
        } catch (error) {
          return tool.args;
        }
      }
      try {
        return JSON.stringify(tool.args, null, 2);
      } catch (error) {
        return String(tool.args);
      }
    })();

    const prettyResult = (() => {
      if (tool.result === undefined || tool.result === null) return 'null';
      if (typeof tool.result === 'string') {
        try {
          return JSON.stringify(JSON.parse(tool.result), null, 2);
        } catch (error) {
          return tool.result;
        }
      }
      try {
        return JSON.stringify(tool.result, null, 2);
      } catch (error) {
        return String(tool.result);
      }
    })();

    const argsSection = prettyArgs.includes('\n') ? `Args:\n${prettyArgs}` : `Args: ${prettyArgs}`;
    const resultSection = prettyResult.includes('\n') ? `Result:\n${prettyResult}` : `Result: ${prettyResult}`;

    return `${header}\n${argsSection}\n${resultSection}`;
  }, []);

  const toolsQuery = useQuery({
    queryKey: ['tools', baseUrl],
    queryFn: async () => {
      const res = await fetch(`${baseUrl}/mcp/tools`);
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
    if (!toolGroups.length) return;
    setExpandedServers((prev) => {
      const next = { ...prev };
      for (const group of toolGroups) {
        if (next[group.serverId] === undefined) {
          next[group.serverId] = group.tools.length <= 8;
        }
      }
      return next;
    });
  }, [toolGroups]);

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

  const toggleServer = useCallback((serverId: string) => {
    setExpandedServers((prev) => ({
      ...prev,
      [serverId]: !prev[serverId],
    }));
  }, []);

  const healthQuery = useQuery({
    queryKey: ['health', baseUrl],
    queryFn: async () => {
      const res = await fetch(`${baseUrl}/health`);
      if (!res.ok) throw new Error('Nie udało się pobrać statusu backendu');
      return (await res.json()) as HealthResponse;
    },
    refetchInterval: 30_000,
  });

  const loadSession = useCallback(async (id: string) => {
    try {
      const res = await fetch(`${baseUrl}/sessions/${id}`);
      if (!res.ok) {
        if (res.status === 404) {
          setHistory([]);
          setToolResults([]);
          setAssistantToolCounts([]);
          return;
        }
        throw new Error(`Nie udało się pobrać sesji (${res.status})`);
      }
      const data = await res.json();
      const toolHistory = (data.toolHistory ?? data.toolResults ?? []) as ToolInvocation[];
      syncConversationState(data.messages ?? [], toolHistory);
      setPendingMessages([]);
      void refreshUsage(id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Nie udało się pobrać sesji');
    }
  }, [baseUrl, refreshUsage, syncConversationState]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const existingId = params.get('session');
    if (existingId) {
      setSessionId(existingId);
      setIsRestoring(true);
      void loadSession(existingId).finally(() => setIsRestoring(false));
      return;
    }
    const newId = (window.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2));
    params.set('session', newId);
    window.history.replaceState(null, '', `${window.location.pathname}?${params.toString()}`);
    setSessionId(newId);
    setHistory([]);
    setToolResults([]);
    setAssistantToolCounts([]);
  }, [loadSession]);

  useEffect(() => {
    if (sessionId) {
      void refreshUsage(sessionId);
    }
  }, [sessionId, refreshUsage]);

  const sendMessage = async (content: string) => {
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
      const response = await fetch(`${baseUrl}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(errorBody || `Błąd ${response.status}`);
      }

      const data = await response.json();
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
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Nieznany błąd';
      setError(message);
    } finally {
      setIsBusy(false);
    }
  };

  const adjustFont = (delta: number) => {
    setFontScale((prev) => {
      const next = Math.round((prev + delta) * 100) / 100;
      return clampFont(next);
    });
  };

  const resetFont = () => setFontScale(1.1);

  return (
    <div className="app-shell" style={{ '--chat-font-scale': fontScale } as CSSProperties}>
      <AppHeader
        isBusy={isBusy}
        isRestoring={isRestoring}
        toolsLoading={toolsQuery.isLoading}
        canOpenHistory={toolResults.length > 0}
        onOpenHistory={() => setIsHistoryOpen(true)}
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
      />

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

      <ChatInput disabled={isBusy || isRestoring || !sessionId} onSubmit={sendMessage} />

      {isToolsOpen ? (
        <ToolGroupsPanel
          groups={toolGroups}
          expandedServers={expandedServers}
          onToggleServer={toggleServer}
          isError={Boolean(toolsQuery.isError)}
          isLoading={toolsQuery.isLoading}
        />
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
    </div>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AppContent />
    </QueryClientProvider>
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
      completionTokens,
      totalTokens,
      costUsd,
    };
  }
  return null;
}
