import { ToolDockPanel } from './components/ToolDockPanel';
import { useToolDrawerConfig } from './hooks/overlays/useToolDrawerConfig';
import { useSessionDrawerConfig } from './hooks/overlays/useSessionDrawerConfig';
import { useChatOverlays } from './hooks/useChatOverlays';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MessageList } from './components/MessageList';
import { ChatInput, type ChatInputHandle } from './components/ChatInput';
import { AppHeader } from './components/AppHeader';
import { ChatLayoutFrame } from './components/ChatLayoutFrame';
import { AuthStatusBar } from './components/AuthStatusBar';
import { DesktopSidebar } from './components/DesktopSidebar';
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
import { getInitialApiBaseUrl } from './config/client';
import { useAuthorizedFetch } from './hooks/useAuthorizedFetch';
import { useChatStream } from './hooks/useChatStream';
import { useChatInteractor } from './hooks/useChatInteractor';
import { systemMessage } from './constants/chat';
// tokens utilities used via useContextUsage
import { formatArgs, formatResult } from './utils/formatters';
import { formatSessionTimestamp, deriveSessionTitle } from './utils/sessions';
import { extractUsageSummary, type UsageSummary } from './utils/health';
import { createApiClient } from './api/client';
import { LAST_BASE_STORAGE_KEY } from './utils/apiBase';
import { useModelsAndHealth } from './hooks/useModelsAndHealth';
import { LoginGate } from './components/LoginGate';
import { useTools } from './hooks/useTools';
import { useBudgets } from './hooks/useBudgets';
// removed useSessionParam in favor of router param
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { useAuthGate } from './hooks/useAuthGate';
import { useConversationState } from './hooks/useConversationState';
import { useSessionContextSync } from './hooks/useSessionContextSync';
import { useAuthHandlers } from './hooks/useAuthHandlers';
import { useContextUsage } from './hooks/useContextUsage';
import { useSuggestedPrompts } from './hooks/useSuggestedPrompts';
import { useNavigate, useParams } from 'react-router-dom';
import { useSessions } from './hooks/useSessions';
import { buildInlineSummary, buildDetailedSummary } from './utils/toolSummaries';
import { SessionSidebar } from './components/SessionSidebar';
import { SessionContextBar } from './components/SessionContextBar';
import { useLlmTraces } from './hooks/useLlmTraces';
import { useToolRunner } from './hooks/useToolRunner';
import { useFontPreferences } from './hooks/useFontPreferences';
import { useHeaderModel } from './hooks/useHeaderModel';
import { useOverlayState } from './hooks/useOverlayState';
import { useSidebars } from './hooks/useSidebars';
import { useSessionCommands } from './hooks/useSessionCommands';
import { deriveSessionInsights, type SessionMetrics } from './utils/sessionInsights';

const queryClient = new QueryClient();

// helpers moved to constants/utils modules

function AppContent() {
  const auth = useAuth();
  const authorizedFetch = useAuthorizedFetch();
  const chatStream = useChatStream();
  const { authed, authLoading, requiresLogin } = useAuthGate(auth);
  const { handleLogin, handleLogout } = useAuthHandlers(auth);

  const [baseUrl, setBaseUrl] = useState<string>(() => getInitialApiBaseUrl());
  const triedFallbackRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  // moved into useChatInteractor
  const lastSessionContextRef = useRef<string>('');
  const [isRestoring, setIsRestoring] = useState(false);
  // tool runner state moved to useToolRunner
  // conversation state managed via hook further below
  const [isToolsOpen, setIsToolsOpen] = useState(() => {
    if (typeof window === 'undefined') {
      return true;
    }
    return window.innerWidth >= 900;
  });
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [currentDocPath, setCurrentDocPath] = useState<string | null>(null);
  // Session param (URL) and conversation state
  const navigate = useNavigate();
  const { sessionId: sessionIdParam } = useParams();
  const sessionId = (sessionIdParam ?? '').toString() || null;
  // sessions handled by useSessions
  const [isSidebarCollapsed, setIsSidebarCollapsed] = usePersistentState<boolean>('chat-sidebar-collapsed', false, {
    deserialize: (value) => {
      if (value === 'true') return true;
      if (value === 'false') return false;
      return null;
    },
    serialize: (value) => (value ? 'true' : 'false'),
  });
  const [budgetEvaluation, setBudgetEvaluation] = useState<BudgetEvaluation | null>(null);
  const [budgetWarning, setBudgetWarning] = useState(false);
  const { fontScale, fontScaleLabel, adjustFont, resetFont } = useFontPreferences();

  const [showInlineTools, setShowInlineTools] = usePersistentState<boolean>('chat-show-inline-tools', true, {
    deserialize: (value) => {
      if (value === 'true') return true;
      if (value === 'false') return false;
      return null;
    },
    serialize: (value) => (value ? 'true' : 'false'),
  });
  const [usageSummary, setUsageSummary] = useState<UsageSummary | null>(null);
  const [selectedModel, setSelectedModel] = usePersistentState<string>('chat-selected-model', '');
  const [favoriteToolKeys, setFavoriteToolKeys] = usePersistentState<string[]>('chat-favorite-tools', []);
  // removed uiPeriod/uiLocation state
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
  const fallbackSuperAdmin = useMemo(() => {
    const username = auth.user?.username?.toLowerCase();
    const name = auth.user?.name?.toLowerCase();
    return username === 'marcin' || name === 'marcin';
  }, [auth.user?.name, auth.user?.username]);
  const isSuperAdmin = auth.serverProfile ? auth.isSuperAdmin : fallbackSuperAdmin;
  const currentUserId = auth.user?.sub ?? '';
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

  // handleLogin provided by useAuthHandlers

  const refreshUsage = useCallback(
    async (id: string) => {
      if (!authed) {
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
    [authed, authorizedFetch, baseUrl],
  );

  // handleLogout provided by useAuthHandlers

  const buildContextPreview = useCallback(() => {
    const now = new Date();
    const localeFormatter = new Intl.DateTimeFormat('pl-PL', {
      dateStyle: 'long',
      timeStyle: 'medium',
    });
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'UTC';
    return `Aktualny czas użytkownika: ${localeFormatter.format(now)} (strefa ${timeZone})`;
  }, []);

  // API client instance
  const client = useMemo(() => createApiClient(baseUrl, authorizedFetch), [baseUrl, authorizedFetch]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    if (!baseUrl) {
      return;
    }
    try {
      window.localStorage.setItem(LAST_BASE_STORAGE_KEY, baseUrl);
    } catch {
      // ignore persistence failures
    }
  }, [baseUrl]);

  // LLM Traces hook
  const { open: isLlmTracesOpen, openModal: openLlmTraces, closeModal: closeLlmTraces, items: llmTraces, loading: llmTracesLoading, error: llmTracesError, refresh: refreshLlmTraces } = useLlmTraces({ authReady: authed, client, sessionId });

  // sessions list handled by useSessions
  const {
    sessions,
    isLoading: isSessionsLoading,
    error: sessionsError,
    refresh: refreshSessions,
    sessionFilter,
    handleSessionFilterChange,
    availableSessionOwners,
    createSession,
    navigateToSession,
    deleteSession,
  } = useSessions({ authReady: authed, client, isSuperAdmin, currentUserId });

  const userId = auth.user?.sub ?? '';

  const {
    budgetDrawerOpen,
    openBudgetDrawer,
    closeBudgetDrawer,
    budgetItems,
    budgetLoading,
    budgetError,
    refreshBudgets,
    refreshBudgetEvaluation,
    handleCreateBudget,
    handleDeleteBudget,
  } = useBudgets({ authReady: authed, canManageBudgets, client, accountIdentifier, userId, primaryRole: normalizedRoles[0] });

  const handleBudgetsRefresh = useCallback(() => { void refreshBudgets(); void refreshBudgetEvaluation(); }, [refreshBudgets, refreshBudgetEvaluation]);

  const { healthQuery, availableModels, hasAdminAccess } = useModelsAndHealth({
    baseUrl,
    authReady: authed,
    token: auth.token,
    authorizedFetch,
    selectedModel,
    setSelectedModel,
    canManageBudgets,
  });

  const adminAccess = useMemo(() => hasAdminAccess(), [hasAdminAccess]);

  const {
    historyOpen,
    openHistory,
    closeHistory,
    promptOpen,
    openPrompt,
    closePrompt,
    toolAccessOpen,
    openToolAccess,
    closeToolAccess,
    selectedToolInfo,
    setSelectedToolInfo,
    clearSelectedToolInfo,
  } = useOverlayState({ adminAccess });

  const {
    mobileSidebarOpen,
    closeMobileSidebar,
    toggleSessionSidebar,
  } = useSidebars({ setIsSidebarCollapsed, refreshSessions });

  // If explicit base URL is unreachable (e.g. stale LAN IP), try sensible fallbacks once
  useEffect(() => {
    if (!authed || !healthQuery.isError || triedFallbackRef.current) {
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
  }, [authed, baseUrl, healthQuery.error, healthQuery.isError]);

  // Effective admin access from useModelsAndHealth

  // initial refresh handled in useSessions

  useSessionContextSync({
    enabled: authed,
    sessionId,
    baseUrl,
    authorizedFetch,
    projectId: selectedProjectId,
    currentDocPath,
    debounceMs: 300,
  });

  // managed in useSessions and useModelsAndHealth

  // formatters moved to utils/formatters

  const filterDisplayMessages = useCallback(
    (messages: ChatMessage[]): ChatMessage[] =>
      (messages ?? []).filter((msg) => msg.role !== 'system' && msg.role !== 'tool'),
    [],
  );

  const {
    history,
    toolResults,
    assistantToolCounts,
    pendingMessages,
    syncConversationState,
    loadSession,
    beginStreaming,
    assistantDelta,
    assistantDone,
    toolStarted,
    toolCompleted,
    clearPending,
    resetConversation,
    replaceToolResults,
    appendToolResult,
  } = useConversationState({
    authed,
    baseUrl,
    authorizedFetch,
    filterDisplayMessages,
    refreshSessions,
    refreshUsage,
    setSelectedProjectId,
    setCurrentDocPath,
    setError,
  });

  // Tool summaries moved to utils/toolSummaries

  const { selectedTool, openTool, closeTool, editor, setEditor, runTool } = useToolRunner({
    authorizedFetch,
    baseUrl,
    sessionId,
    onInvocation: (inv) => {
      appendToolResult(inv);
    },
  });

  const {
    handleCreateNewSession,
    handleSelectSession,
    handleDeleteSession,
    handleExpandSidebar,
  } = useSessionCommands({
    createSession,
    navigate,
    resetConversation,
    closeTool,
    clearSelectedToolInfo,
    setUsageSummary,
    setError,
    setIsBusy,
    closeMobileSidebar,
    setSelectedProjectId,
    setCurrentDocPath,
    sessionId,
    navigateToSession,
    loadSession,
    setIsRestoring,
    deleteSession,
    authed,
    refreshSessions,
    setIsSidebarCollapsed,
  });

  const sessionContext = useMemo(() => {
    const metrics = deriveSessionInsights(toolResults);
    const model = selectedModel || availableModels[0] || healthQuery.data?.openai.model || 'gpt-4.1';
    if (!metrics) {
      return { model };
    }
    return { ...metrics, model };
  }, [toolResults, selectedModel, availableModels, healthQuery.data?.openai.model]);

  const contextUsage = useContextUsage({
    selectedModel,
    availableModels,
    healthModel: healthQuery.data?.openai.model,
    history,
    buildPreview: buildContextPreview,
  });

  const suggestedPrompts = useSuggestedPrompts({ location: (sessionContext as any)?.location ?? null });

  // derived owners moved to useSessions

  useKeyboardShortcuts({
    onOpenTools: () => { setIsToolsOpen(true); setTimeout(() => dockSearchRef.current?.focus(), 0); },
    onFocusInput: () => { chatInputRef.current?.focus(); },
    onEscape: () => {
      if (historyOpen) closeHistory();
      if (mobileSidebarOpen) closeMobileSidebar();
      if (selectedTool) closeTool();
      if (selectedToolInfo) clearSelectedToolInfo();
      if (isToolsOpen) setIsToolsOpen(false);
    },
  });

  // deriveSessionTitle, formatSessionTimestamp moved to utils/sessions

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

  const { toolsQuery, toolGroups } = useTools({ baseUrl, authed, token: auth.token, client });

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handleResize = () => {
      if (window.innerWidth >= 900) {
        setIsToolsOpen(true);
      }
      if (window.innerWidth >= 1024) {
        closeMobileSidebar();
      }
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [closeMobileSidebar]);

  useEffect(() => {
    if (!authed) return;
    if (!sessionId) return;
    setIsRestoring(true);
    void loadSession(sessionId).finally(() => setIsRestoring(false));
  }, [authed, sessionId, loadSession]);

  // no-op with router param
  useEffect(() => {}, [authed]);

  // initial sessions refresh handled in useSessions

  // Ensure history modal can hydrate persisted tool history even if local state is empty
  useEffect(() => {
    if (!historyOpen || !authed || !sessionId) {
      return;
    }
    if (toolResults.length > 0) {
      return;
    }
    (async () => {
      try {
        const res = await authorizedFetch(`${baseUrl}/sessions/${sessionId}`);
        if (!res.ok) return;
        const data = await res.json();
        const toolHistory = (data.toolHistory ?? data.toolResults ?? []) as ToolInvocation[];
        if (Array.isArray(toolHistory) && toolHistory.length > 0) {
          replaceToolResults(toolHistory);
        }
      } catch {
        // silent
      }
    })();
  }, [historyOpen, authed, sessionId, authorizedFetch, baseUrl, toolResults.length, history, replaceToolResults]);

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
    if (!adminAccess) {
      closeBudgetDrawer();
    }
  }, [adminAccess, closeBudgetDrawer]);

  useEffect(() => {
    if (!authed || !sessionId) {
      return;
    }

    if (sessionId) {
      void refreshUsage(sessionId);
    }
  }, [authed, refreshUsage, sessionId]);

  // filter change handled in useSessions

  const { sendMessage, cancelStream } = useChatInteractor({
    authed,
    baseUrl,
    authorizedFetch,
    chatStream,
    sessionId,
    navigate: (to: string, opts?: { replace?: boolean }) => navigate(to, opts),
    selectedModel,
    history,
    toolResults,
    pendingMessages,
    selectedProjectId,
    currentDocPath,
    beginStreaming,
    assistantDelta,
    assistantDone,
    toolStarted,
    toolCompleted,
    syncConversationState,
    clearPending,
    setBudgetWarning,
    setBudgetEvaluation,
    refreshUsage,
    refreshSessions,
    setUsageSummary,
    setIsBusy,
    setError,
  });

  const sidebarClassName = isSidebarCollapsed ? 'lg:w-28' : 'lg:w-96';
  const sidebarPanel = (
    <DesktopSidebar
      collapsed={isSidebarCollapsed}
      onExpand={handleExpandSidebar}
      onCollapse={() => setIsSidebarCollapsed(true)}
      onCreateNewSession={handleCreateNewSession}
      isSuperAdmin={isSuperAdmin}
      sessionFilter={sessionFilter}
      onSessionFilterChange={handleSessionFilterChange}
      availableSessionOwners={availableSessionOwners}
      currentUserId={currentUserId}
      sessions={sessions}
      activeSessionId={sessionId}
      isLoading={isSessionsLoading}
      error={sessionsError}
      onSelectSession={handleSelectSession}
      onDeleteSession={handleDeleteSession}
    />
  );

  const desktopToolDock = (
    <ToolDockPanel
      variant="desktop"
      open={isToolsOpen}
      groups={toolGroups}
      history={toolResults}
      favorites={favoriteToolKeys}
      onToggleFavorite={toggleFavoriteTool}
      onSelectTool={handleSelectTool}
      searchRef={dockSearchRef}
    />
  );

  const messageArea = (
    <section className="flex min-h-0 flex-1 flex-col">
      <MessageList
        messages={[...history, ...pendingMessages]}
        toolResults={toolResults}
        assistantToolCounts={assistantToolCounts}
        onSelectToolResult={openTool}
        inlineSummaryFormatter={buildInlineSummary}
        toolDetailsFormatter={buildDetailedSummary}
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
  );

  const { headerProps } = useHeaderModel({
    baseUrl,
    sessionId,
    isBusy,
    isRestoring,
    toolsLoading: toolsQuery.isLoading,
    hasHistory: toolResults.length > 0,
    openHistory,
    toggleSessionSidebar,
    isSessionSidebarCollapsed: isSidebarCollapsed,
    openBudgetDrawer,
    openToolAccess,
    openLlmTraces,
    openPrompt,
    isToolsOpen,
    setIsToolsOpen,
    fontScaleLabel,
    adjustFont,
    resetFont,
    showInlineTools,
    setShowInlineTools,
    usageSummary,
    contextUsage,
    availableModels,
    selectedModel,
    setSelectedModel,
    healthQuery,
    auth,
    authLoading,
    userLabel: userDisplayName,
    userTooltip: authTooltip,
    accountIdentifier,
    handleLogin,
    handleLogout,
    adminAccess,
    budgetWarning,
    cancelStream,
  });

  const headerElement = <AppHeader {...headerProps} />;

  const contextBarElement = <SessionContextBar context={sessionContext} />;
  const authStatusElement = auth.enabled && auth.isAuthenticated ? (
    <AuthStatusBar
      userLabel={userDisplayName}
      accountId={accountIdentifier}
      usageSummary={usageSummary}
      onLogout={handleLogout}
    />
  ) : null;

  const errorBanner = error ? (
    <div className="rounded-2xl border border-danger/40 bg-danger/15 px-4 py-3 text-sm text-danger">
      {error}
    </div>
  ) : null;

  const chatInputElement = (
    <ChatInput
      disabled={isRestoring || !authed}
      busy={isBusy}
      onSubmit={sendMessage}
      suggestions={Array.from(new Set((toolsQuery.data ?? []).map((t) => t.name))).sort((a, b) => a.localeCompare(b))}
      inputRef={chatInputRef}
      ref={chatInputHandleRef}
    />
  );

  const toolDrawer = useToolDrawerConfig({
    isOpen: isToolsOpen,
    setIsOpen: (open) => setIsToolsOpen(open),
    groups: toolGroups,
    history: toolResults,
    favorites: favoriteToolKeys,
    onToggleFavorite: toggleFavoriteTool,
    onSelectTool: handleSelectTool,
    searchRef: dockSearchRef,
  });

  const sessionDrawer = useSessionDrawerConfig({
    isOpen: mobileSidebarOpen,
    onClose: closeMobileSidebar,
    isSuperAdmin,
    sessionFilter,
    onSessionFilterChange: handleSessionFilterChange,
    availableSessionOwners,
    currentUserId,
    onCreateNewSession: handleCreateNewSession,
    sessions,
    activeSessionId: sessionId,
    isLoading: isSessionsLoading,
    error: sessionsError,
    onSelectSession: handleSelectSession,
    onDeleteSession: handleDeleteSession,
  });

  const promptConfig = useMemo(
    () => ({
      open: promptOpen,
      onClose: closePrompt,
      systemText: systemMessage.content,
      buildPreview: buildContextPreview,
    }),
    [promptOpen, closePrompt, buildContextPreview],
  );

  const traces = useMemo(
    () => ({
      open: isLlmTracesOpen,
      onClose: closeLlmTraces,
      loading: llmTracesLoading,
      error: llmTracesError,
      items: llmTraces as any,
      refresh: () => void refreshLlmTraces(),
    }),
    [isLlmTracesOpen, closeLlmTraces, llmTracesLoading, llmTracesError, llmTraces],
  );

  const historyConfig = useMemo(
    () => ({
      open: historyOpen,
      items: toolResults,
      onClose: closeHistory,
      onInspect: (entry: ToolInvocation) => {
        openTool(entry);
        closeHistory();
      },
    }),
    [historyOpen, toolResults, closeHistory, openTool],
  );

  const toolRunConfig = useMemo(
    () => ({
      open: Boolean(selectedTool),
      onClose: closeTool,
      selected: selectedTool,
      editor,
      setEditor,
      onRun: runTool,
      formatArgs,
      formatResult,
    }),
    [selectedTool, closeTool, editor, setEditor, runTool, formatArgs, formatResult],
  );

  const selectedToolInfoConfig = useMemo(
    () => ({
      tool: selectedToolInfo,
      onClose: clearSelectedToolInfo,
    }),
    [selectedToolInfo, clearSelectedToolInfo],
  );

  const toolAccessConfig = useMemo(
    () => ({
      enabled: adminAccess,
      open: toolAccessOpen && adminAccess,
      onClose: closeToolAccess,
    }),
    [adminAccess, toolAccessOpen, closeToolAccess],
  );

  const budgetConfig = useMemo(
    () => ({
      enabled: adminAccess,
      open: budgetDrawerOpen,
      onClose: closeBudgetDrawer,
      budgets: budgetItems,
      loading: budgetLoading,
      error: budgetError,
      onRefresh: handleBudgetsRefresh,
      onCreate: handleCreateBudget,
      onDelete: handleDeleteBudget,
      evaluation: budgetEvaluation,
    }),
    [
      adminAccess,
      budgetDrawerOpen,
      closeBudgetDrawer,
      budgetItems,
      budgetLoading,
      budgetError,
      handleBudgetsRefresh,
      handleCreateBudget,
      handleDeleteBudget,
      budgetEvaluation,
    ],
  );

  const overlays = useChatOverlays({
    baseUrl,
    sessionId,
    toolDrawer,
    sessionDrawer,
    prompt: promptConfig,
    traces,
    history: historyConfig,
    toolRun: toolRunConfig,
    selectedToolInfo: selectedToolInfoConfig,
    toolAccess: toolAccessConfig,
    budget: budgetConfig,
  });

  // font handlers provided by useFontPreferences

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
    return <LoginGate baseUrl={baseUrl} error={auth.error} onLogin={handleLogin} />;
  }

  return (
    <ChatLayoutFrame
      sidebar={sidebarPanel}
      sidebarClassName={sidebarClassName}
      header={headerElement}
      contextBar={contextBarElement}
      statusBar={authStatusElement}
      errorBanner={errorBanner}
      messageArea={messageArea}
      desktopToolDock={desktopToolDock}
      chatInput={chatInputElement}
      overlays={overlays}
    />
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

// helpers moved to utils/health and utils/sessionMetrics

// SessionMetrics moved to utils/sessionInsights
