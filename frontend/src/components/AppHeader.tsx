import { StatusBadge } from './StatusBadge';

interface StatusInfo {
  status: 'ok' | 'error' | 'loading';
  description?: string;
  label: string;
}

interface AppHeaderProps {
  isBusy: boolean;
  isRestoring: boolean;
  toolsLoading: boolean;
  canOpenHistory: boolean;
  onOpenHistory: () => void;
  onOpenSessions: () => void;
  onOpenBudgets: () => void;
  isToolsOpen: boolean;
  onToggleTools: () => void;
  fontScaleLabel: string;
  onDecreaseFont: () => void;
  onIncreaseFont: () => void;
  onResetFont: () => void;
  showInlineTools: boolean;
  onToggleInlineTools: () => void;
  statuses: StatusInfo[];
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    costUsd: number;
  } | null;
  models: string[];
  selectedModel: string;
  onSelectModel: (model: string) => void;
  authEnabled: boolean;
  authLoading: boolean;
  isAuthenticated: boolean;
  userLabel?: string;
  userTooltip?: string;
  accountId?: string;
  roles?: string[];
  onLogin: () => void;
  onLogout: () => void;
  onCancelStream?: () => void;
  canManageBudgets: boolean;
  budgetWarning: boolean;
}

export function AppHeader(props: AppHeaderProps) {
  const {
    isBusy,
    isRestoring,
    toolsLoading,
    canOpenHistory,
    onOpenHistory,
    onOpenSessions,
    onOpenBudgets,
    isToolsOpen,
    onToggleTools,
    fontScaleLabel,
    onDecreaseFont,
    onIncreaseFont,
    onResetFont,
    showInlineTools,
    onToggleInlineTools,
    statuses,
    usage,
    models,
    selectedModel,
    onSelectModel,
    authEnabled,
    authLoading,
    isAuthenticated,
    userLabel,
    userTooltip,
    accountId,
    roles,
    onLogin,
    onLogout,
    onCancelStream,
    canManageBudgets,
    budgetWarning,
  } = props;

  const statusText = isBusy || isRestoring ? 'Przetwarzanie…' : toolsLoading ? 'Ładowanie narzędzi…' : 'Gotowy';
  const visibleRoles = (roles ?? []).filter((role) => role.trim().length > 0);

  const authControls = (() => {
    if (!authEnabled) {
      return null;
    }

    if (authLoading) {
      return <span className="auth-chip">Logowanie…</span>;
    }

    if (isAuthenticated) {
      return (
        <div className="auth-user-wrapper">
          <span className="auth-user" title={userTooltip && userTooltip.length > 0 ? userTooltip : undefined}>
            {userLabel && userLabel.length > 0 ? userLabel : 'Zalogowany użytkownik'}
            {accountId ? <span className="auth-account"> • {accountId}</span> : null}
          </span>
          {visibleRoles.length > 0 ? (
            <div className="auth-roles" title={`Role: ${visibleRoles.join(', ')}`}>
              {visibleRoles.slice(0, 3).map((role) => (
                <span key={role} className="auth-role-chip">
                  {role}
                </span>
              ))}
              {visibleRoles.length > 3 ? (
                <span className="auth-role-chip">+{visibleRoles.length - 3}</span>
              ) : null}
            </div>
          ) : null}
          <button type="button" className="auth-action" onClick={onLogout}>
            Wyloguj
          </button>
        </div>
      );
    }

    return (
      <button type="button" className="auth-action" onClick={onLogin}>
        Zaloguj
      </button>
    );
  })();

  return (
    <header className="app-header">
      <div className="app-header-left">
        <h1>Chat MCP</h1>
        <div className="header-buttons">
          {onCancelStream ? (
            <button type="button" className="history-button" onClick={onCancelStream} title="Anuluj generowanie">
              Anuluj
            </button>
          ) : null}
          <button type="button" className="history-button" onClick={onOpenHistory} disabled={!canOpenHistory}>
            Historia narzędzi
          </button>
          <button type="button" className="history-button" onClick={onOpenSessions}>
            Sesje
          </button>
          {canManageBudgets ? (
            <button type="button" className={`history-button${budgetWarning ? ' history-button-warning' : ''}`} onClick={onOpenBudgets}>
              Budżety
            </button>
          ) : null}
          <button type="button" className="history-button" onClick={onToggleTools}>
            {isToolsOpen ? 'Ukryj narzędzia' : 'Pokaż narzędzia'}
          </button>
        </div>
        <div className="font-controls" aria-label="Regulacja wielkości tekstu">
          <label className="model-select-wrapper" title="Wybierz model LLM">
            <span>Model</span>
            <select value={selectedModel} onChange={(event) => onSelectModel(event.target.value)}>
              {models.map((model) => (
                <option key={model} value={model}>
                  {model}
                </option>
              ))}
            </select>
          </label>
          <button type="button" onClick={onDecreaseFont} title="Zmniejsz tekst" aria-label="Zmniejsz tekst">
            A-
          </button>
          <button type="button" onClick={onResetFont} title="Domyślny rozmiar" aria-label="Domyślny rozmiar tekstu">
            {fontScaleLabel}
          </button>
          <button type="button" onClick={onIncreaseFont} title="Powiększ tekst" aria-label="Powiększ tekst">
            A+
          </button>
          <button
            type="button"
            className="inline-toggle"
            onClick={onToggleInlineTools}
            title={showInlineTools ? 'Ukryj wywołania narzędzi w rozmowie' : 'Pokaż wywołania narzędzi w rozmowie'}
          >
            {showInlineTools ? 'Ukryj log MCP' : 'Pokaż log MCP'}
          </button>
        </div>
      </div>
      <div className="status-row">
        <div className="status">{statusText}</div>
        {authEnabled ? <div className="auth-controls">{authControls}</div> : null}
        {statuses.map((status) => (
          <StatusBadge key={status.label} label={status.label} status={status.status} description={status.description} />
        ))}
        {usage ? (
          <div className="usage-chip" title={`Zużyte tokeny: ${usage.totalTokens.toLocaleString('pl-PL')}`}>
            <span>Koszt: ${usage.costUsd.toFixed(4)}</span>
            <span>{usage.totalTokens.toLocaleString('pl-PL')} tok.</span>
          </div>
        ) : null}
      </div>
    </header>
  );
}
