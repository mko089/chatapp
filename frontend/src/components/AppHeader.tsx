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
    onLogin,
    onLogout,
    onCancelStream,
    canManageBudgets,
    budgetWarning,
  } = props;

  const statusText = isBusy || isRestoring ? 'Przetwarzanie…' : toolsLoading ? 'Ładowanie narzędzi…' : 'Gotowy';
  const sessionCost = usage && Number.isFinite(usage.costUsd) ? usage.costUsd : null;

  const authControls = (() => {
    if (!authEnabled) {
      return null;
    }

    if (authLoading) {
      return <span className="auth-chip">Logowanie…</span>;
    }

    if (isAuthenticated) {
      return (
        <div className="flex flex-wrap items-center gap-3" title={userTooltip && userTooltip.length > 0 ? userTooltip : undefined}>
          <div className="flex flex-col">
            <span className="text-sm font-semibold text-white">{userLabel && userLabel.length > 0 ? userLabel : 'Zalogowany użytkownik'}</span>
            {accountId ? <span className="text-xs text-slate-400">Konto: {accountId}</span> : null}
          </div>
          {sessionCost !== null ? (
            <span className="chip chip-primary">Koszt sesji: ${sessionCost.toFixed(4)}</span>
          ) : null}
          <button
            type="button"
            onClick={onLogout}
            className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-slate-200 transition hover:border-danger/40 hover:bg-danger/20 hover:text-danger"
          >
            Wyloguj
          </button>
        </div>
      );
    }

    return (
      <button
        type="button"
        onClick={onLogin}
        className="rounded-full border border-accent/40 bg-accent/20 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-accent transition hover:bg-accent/30"
      >
        Zaloguj
      </button>
    );
  })();

  return (
    <header className="glass-panel flex flex-col gap-5 p-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary/20 text-lg font-semibold text-primary">
            GC
          </div>
          <div>
            <h1 className="text-xl font-semibold text-white">GardenChat</h1>
            <p className="text-sm text-slate-400">{statusText}</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {onCancelStream ? (
            <button
              type="button"
              onClick={onCancelStream}
              className="inline-flex items-center gap-2 rounded-full border border-warning/40 bg-warning/20 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-warning transition hover:bg-warning/30"
              title="Anuluj generowanie"
            >
              Anuluj
            </button>
          ) : null}
          <button
            type="button"
            onClick={onOpenHistory}
            disabled={!canOpenHistory}
            className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-slate-200 transition hover:border-white/20 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Historia
          </button>
          <button
            type="button"
            onClick={onOpenSessions}
            className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-slate-200 transition hover:border-white/20 hover:bg-white/10"
          >
            Sesje
          </button>
          {canManageBudgets ? (
            <button
              type="button"
              onClick={onOpenBudgets}
              className={`inline-flex items-center gap-2 rounded-full border px-4 py-2 text-xs font-semibold uppercase tracking-wide transition ${budgetWarning ? 'border-danger/60 bg-danger/10 text-danger hover:bg-danger/20' : 'border-white/10 bg-white/5 text-slate-200 hover:border-white/20 hover:bg-white/10'}`}
            >
              Budżety
            </button>
          ) : null}
          <button
            type="button"
            onClick={onToggleTools}
            className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-slate-200 transition hover:border-white/20 hover:bg-white/10"
          >
            {isToolsOpen ? 'Zwiń narzędzia' : 'Dock narzędzi'}
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-2">
          {statuses.map((status) => (
            <StatusBadge key={status.label} label={status.label} status={status.status} description={status.description} />
          ))}
          {usage ? (
            <div className="chip chip-accent" title={`Zużyte tokeny: ${usage.totalTokens.toLocaleString('pl-PL')}`}>
              <span>Koszt ${usage.costUsd.toFixed(4)}</span>
            </div>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs uppercase tracking-wide text-slate-300">
            <span>Model</span>
            <select
              value={selectedModel}
              onChange={(event) => onSelectModel(event.target.value)}
              className="bg-transparent text-sm font-semibold text-white outline-none"
            >
              {models.map((model) => (
                <option key={model} value={model} className="bg-surface text-slate-900">
                  {model}
                </option>
              ))}
            </select>
          </label>
          <div className="flex items-center gap-1 rounded-full border border-white/10 bg-white/5 px-2 py-1 text-xs text-slate-300" aria-label="Regulacja wielkości tekstu">
            <button type="button" onClick={onDecreaseFont} className="rounded-full px-2 py-1 transition hover:bg-white/10" title="Zmniejsz tekst">
              A-
            </button>
            <button type="button" onClick={onResetFont} className="rounded-full px-2 py-1 transition hover:bg-white/10" title="Domyślny rozmiar">
              {fontScaleLabel}
            </button>
            <button type="button" onClick={onIncreaseFont} className="rounded-full px-2 py-1 transition hover:bg-white/10" title="Powiększ tekst">
              A+
            </button>
          </div>
          <button
            type="button"
            onClick={onToggleInlineTools}
            className={`inline-flex items-center gap-2 rounded-full border px-4 py-2 text-xs font-semibold uppercase tracking-wide transition ${showInlineTools ? 'border-white/20 bg-white/10 text-slate-100 hover:bg-white/20' : 'border-primary/30 bg-primary/15 text-primary hover:bg-primary/20'}`}
            title={showInlineTools ? 'Ukryj wywołania narzędzi w rozmowie' : 'Pokaż wywołania narzędzi w rozmowie'}
          >
            {showInlineTools ? 'Ukryj log MCP' : 'Pokaż log MCP'}
          </button>
        </div>
      </div>

      {authEnabled ? <div className="flex items-center justify-end">{authControls}</div> : null}
    </header>
  );
}
