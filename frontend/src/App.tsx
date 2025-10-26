import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
import { renderInlineValue } from './utils/inlineFormat';
import { useQuery, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MessageList } from './components/MessageList';
import { ChatInput } from './components/ChatInput';
import { StatusBadge } from './components/StatusBadge';
import type { ChatMessage, ToolInvocation } from './types';

type ToolInfo = {
  name: string;
  description?: string;
  serverId: string;
};

const queryClient = new QueryClient();
const systemMessage: ChatMessage = {
  role: 'system',
  content: 'You are a helpful assistant working with Garden MCP tools (meters, employee).',
};

type HealthResponse = {
  backend: 'ok';
  mcp: { status: 'ok' | 'error' | 'unknown'; error?: string };
  openai: { status: 'ok' | 'error' | 'unknown'; error?: string; model: string };
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
  const [fontScale, setFontScale] = useState<number>(() => {
    if (typeof window !== 'undefined') {
      const stored = window.localStorage.getItem('chat-font-scale');
      if (stored) {
        const parsed = Number.parseFloat(stored);
        if (!Number.isNaN(parsed)) {
          return Math.min(1.6, Math.max(0.85, parsed));
        }
      }
    }
    return 1.1;
  });
  const [showInlineTools, setShowInlineTools] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      const stored = window.localStorage.getItem('chat-show-inline-tools');
      if (stored === 'true' || stored === 'false') {
        return stored === 'true';
      }
    }
    return true;
  });

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

  const toolGroups = useMemo(() => {
    const grouped = new Map<string, ToolInfo[]>();
    for (const tool of toolsQuery.data ?? []) {
      const entry = grouped.get(tool.serverId) ?? [];
      entry.push(tool);
      grouped.set(tool.serverId, entry);
    }
    return Array.from(grouped.entries())
      .map(([serverId, tools]) => ({
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

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem('chat-font-scale', fontScale.toString());
  }, [fontScale]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem('chat-show-inline-tools', showInlineTools ? 'true' : 'false');
  }, [showInlineTools]);

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

  const formatServerName = useCallback((value: string) => {
    return value
      .replace(/[_-]/g, ' ')
      .replace(/\b\w/g, (char) => char.toUpperCase());
  }, []);

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
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Nie udało się pobrać sesji');
    }
  }, [baseUrl, syncConversationState]);

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
    const userMessage: ChatMessage = { role: 'user', content };
    setPendingMessages((prev) => [...prev, userMessage]);

    const payload = {
      sessionId: resolvedSessionId,
      messages: [systemMessage, ...history, userMessage],
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
      return Math.min(1.6, Math.max(0.85, next));
    });
  };

  const resetFont = () => setFontScale(1.1);

  return (
    <div className="app-shell" style={{ '--chat-font-scale': fontScale } as CSSProperties}>
      <header className="app-header">
        <div className="app-header-left">
          <h1>Chat MCP</h1>
          <div className="header-buttons">
            <button
              type="button"
              className="history-button"
              onClick={() => setIsHistoryOpen(true)}
              disabled={toolResults.length === 0}
            >
              Historia narzędzi
            </button>
            <button
              type="button"
              className="history-button"
              onClick={() => setIsToolsOpen((prev) => !prev)}
            >
              {isToolsOpen ? 'Ukryj narzędzia' : 'Pokaż narzędzia'}
            </button>
          </div>
          <div className="font-controls" aria-label="Regulacja wielkości tekstu">
            <button type="button" onClick={() => adjustFont(-0.1)} title="Zmniejsz tekst" aria-label="Zmniejsz tekst">
              A-
            </button>
            <button type="button" onClick={resetFont} title="Domyślny rozmiar" aria-label="Domyślny rozmiar tekstu">
              {`${Math.round(fontScale * 100)}%`}
            </button>
            <button type="button" onClick={() => adjustFont(0.1)} title="Powiększ tekst" aria-label="Powiększ tekst">
              A+
            </button>
            <button
              type="button"
              className="inline-toggle"
              onClick={() => setShowInlineTools((prev) => !prev)}
              title={showInlineTools ? 'Ukryj wywołania narzędzi w rozmowie' : 'Pokaż wywołania narzędzi w rozmowie'}
            >
              {showInlineTools ? 'Ukryj log MCP' : 'Pokaż log MCP'}
            </button>
          </div>
        </div>
        <div className="status-row">
          <div className="status">
            {isBusy || isRestoring
              ? 'Przetwarzanie…'
              : toolsQuery.isLoading
                ? 'Ładowanie narzędzi…'
                : 'Gotowy'}
          </div>
          <StatusBadge
            label="MCP"
            status={healthQuery.isLoading ? 'loading' : healthQuery.data?.mcp.status === 'ok' ? 'ok' : 'error'}
            description={healthQuery.data?.mcp.error}
          />
          <StatusBadge
            label={`OpenAI (${healthQuery.data?.openai.model ?? '…'})`}
            status={healthQuery.isLoading ? 'loading' : healthQuery.data?.openai.status === 'ok' ? 'ok' : 'error'}
            description={healthQuery.data?.openai.error}
          />
        </div>
      </header>

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
        <section>
          <h3>Dostępne narzędzia</h3>
          {toolsQuery.isError ? (
            <div className="tool-results-empty">Nie można pobrać listy narzędzi.</div>
          ) : toolGroups.length === 0 ? (
            <div className="tool-results-empty">Brak narzędzi MCP.</div>
          ) : (
            <div className="tool-groups">
              {toolGroups.map((group) => {
                const isExpanded = expandedServers[group.serverId] ?? false;
                return (
                  <div key={group.serverId} className="tool-group">
                    <button
                      type="button"
                      className="tool-group-toggle"
                      onClick={() => toggleServer(group.serverId)}
                    >
                      <span>{formatServerName(group.serverId)}</span>
                      <span className="tool-group-meta">
                        {group.tools.length} narzędzi {isExpanded ? '▾' : '▸'}
                      </span>
                    </button>
                    {isExpanded ? (
                      <div className="tool-group-tools">
                        <div className="tools-grid">
                          {group.tools.map((tool) => (
                            <div key={tool.name} className="tool-pill" title={tool.description ?? ''}>
                              {tool.name}
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}
        </section>
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
