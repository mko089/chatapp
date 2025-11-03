import { useCallback, useMemo, type Dispatch, type SetStateAction } from 'react';
import type { UseQueryResult } from '@tanstack/react-query';
import type { AppHeaderProps } from '../components/AppHeader';
import type { AuthContextValue } from '../auth/AuthProvider';
import { LAST_BASE_STORAGE_KEY } from '../utils/apiBase';
import { buildStatuses, type HealthResponse, type UsageSummary } from '../utils/health';

type ContextUsage = {
  usedTokens: number;
  maxTokens: number;
  remainingTokens: number;
};

type UseHeaderModelParams = {
  baseUrl: string;
  sessionId: string | null;
  isBusy: boolean;
  isRestoring: boolean;
  toolsLoading: boolean;
  hasHistory: boolean;
  openHistory: () => void;
  toggleSessionSidebar: () => void;
  isSessionSidebarCollapsed: boolean;
  openBudgetDrawer: () => void;
  openToolAccess: () => void;
  openLlmTraces: () => void;
  openPrompt: () => void;
  isToolsOpen: boolean;
  setIsToolsOpen: Dispatch<SetStateAction<boolean>>;
  fontScaleLabel: string;
  adjustFont: (delta: number) => void;
  resetFont: () => void;
  showInlineTools: boolean;
  setShowInlineTools: Dispatch<SetStateAction<boolean>>;
  usageSummary: UsageSummary | null;
  contextUsage: ContextUsage | null;
  availableModels: string[];
  selectedModel: string;
  setSelectedModel: Dispatch<SetStateAction<string>>;
  healthQuery: UseQueryResult<HealthResponse, Error>;
  auth: AuthContextValue;
  authLoading: boolean;
  userLabel: string;
  userTooltip: string;
  accountIdentifier: string;
  handleLogin: () => void;
  handleLogout: () => void;
  adminAccess: boolean;
  budgetWarning: boolean;
  cancelStream: () => void;
};

function buildLlmTraceLink(baseUrl: string, sessionId: string | null) {
  const base = `${baseUrl}/admin/llm-traces`;
  if (!sessionId) {
    return base;
  }
  return `${base}?sessionId=${encodeURIComponent(sessionId)}&limit=200`;
}

export function useHeaderModel(params: UseHeaderModelParams) {
  const {
    baseUrl,
    sessionId,
    isBusy,
    isRestoring,
    toolsLoading,
    hasHistory,
    openHistory,
    toggleSessionSidebar,
    isSessionSidebarCollapsed,
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
    userLabel,
    userTooltip,
    accountIdentifier,
    handleLogin,
    handleLogout,
    adminAccess,
    budgetWarning,
    cancelStream,
  } = params;

  const handleOpenHistory = useCallback(() => { openHistory(); }, [openHistory]);
  const handleOpenToolAccess = useCallback(() => { openToolAccess(); }, [openToolAccess]);
  const handleOpenPrompt = useCallback(() => { openPrompt(); }, [openPrompt]);
  const handleToggleTools = useCallback(() => { setIsToolsOpen((prev) => !prev); }, [setIsToolsOpen]);
  const handleToggleInlineTools = useCallback(() => { setShowInlineTools((prev) => !prev); }, [setShowInlineTools]);
  const handleDecreaseFont = useCallback(() => { adjustFont(-0.1); }, [adjustFont]);
  const handleIncreaseFont = useCallback(() => { adjustFont(0.1); }, [adjustFont]);
  const handleCancelStream = useCallback(() => { cancelStream(); }, [cancelStream]);
  const handleSelectModel = useCallback((model: string) => { setSelectedModel(model); }, [setSelectedModel]);

  const handleResetApiBase = useCallback(() => {
    try {
      if (typeof window !== 'undefined') {
        window.localStorage.removeItem(LAST_BASE_STORAGE_KEY);
      }
    } catch {
      // ignore persistence errors
    }
    if (typeof window !== 'undefined') {
      window.location.reload();
    }
  }, []);

  const llmTraceLink = useMemo(() => buildLlmTraceLink(baseUrl, sessionId), [baseUrl, sessionId]);
  const fallbackModel = healthQuery.data?.openai.model || 'gpt-4.1';
  const models = availableModels.length > 0 ? availableModels : [selectedModel || fallbackModel];
  const effectiveSelectedModel = selectedModel || models[0] || fallbackModel;

  const headerProps: AppHeaderProps = useMemo(() => ({
    isBusy,
    isRestoring,
    toolsLoading,
    canOpenHistory: hasHistory,
    onOpenHistory: handleOpenHistory,
    onOpenSessions: toggleSessionSidebar,
    isSessionSidebarCollapsed,
    onOpenBudgets: openBudgetDrawer,
    onOpenToolAccess: handleOpenToolAccess,
    onOpenPrompt: handleOpenPrompt,
    onOpenLlmTraces: openLlmTraces,
    llmTraceLink,
    isToolsOpen,
    onToggleTools: handleToggleTools,
    fontScaleLabel,
    onDecreaseFont: handleDecreaseFont,
    onIncreaseFont: handleIncreaseFont,
    onResetFont: resetFont,
    showInlineTools,
    onToggleInlineTools: handleToggleInlineTools,
    statuses: buildStatuses(healthQuery),
    usage: usageSummary,
    contextUsage,
    models,
    selectedModel: effectiveSelectedModel,
    onSelectModel: handleSelectModel,
    authEnabled: auth.enabled,
    authLoading,
    isAuthenticated: auth.isAuthenticated,
    userLabel,
    userTooltip,
    accountId: accountIdentifier,
    onLogin: handleLogin,
    onLogout: handleLogout,
    onCancelStream: handleCancelStream,
    canManageBudgets: adminAccess,
    budgetWarning,
    canManageToolAccess: adminAccess,
    apiBaseUrl: baseUrl,
    onResetApiBase: handleResetApiBase,
  }), [
    accountIdentifier,
    adminAccess,
    auth.enabled,
    auth.isAuthenticated,
    authLoading,
    baseUrl,
    budgetWarning,
    contextUsage,
    effectiveSelectedModel,
    fontScaleLabel,
    handleCancelStream,
    handleDecreaseFont,
    handleIncreaseFont,
    handleOpenHistory,
    handleOpenPrompt,
    handleOpenToolAccess,
    handleResetApiBase,
    handleSelectModel,
    handleToggleInlineTools,
    handleToggleTools,
    handleLogin,
    handleLogout,
    hasHistory,
    isBusy,
    isRestoring,
    isSessionSidebarCollapsed,
    isToolsOpen,
    models,
    openBudgetDrawer,
    openLlmTraces,
    resetFont,
    showInlineTools,
    healthQuery.data,
    healthQuery.isError,
    healthQuery.isFetching,
    healthQuery.isLoading,
    healthQuery.status,
    toggleSessionSidebar,
    toolsLoading,
    usageSummary,
    userLabel,
    userTooltip,
    llmTraceLink,
  ]);

  return { headerProps };
}
