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
  isToolsOpen: boolean;
  onToggleTools: () => void;
  fontScaleLabel: string;
  onDecreaseFont: () => void;
  onIncreaseFont: () => void;
  onResetFont: () => void;
  showInlineTools: boolean;
  onToggleInlineTools: () => void;
  statuses: StatusInfo[];
}

export function AppHeader(props: AppHeaderProps) {
  const {
    isBusy,
    isRestoring,
    toolsLoading,
    canOpenHistory,
    onOpenHistory,
    isToolsOpen,
    onToggleTools,
    fontScaleLabel,
    onDecreaseFont,
    onIncreaseFont,
    onResetFont,
    showInlineTools,
    onToggleInlineTools,
    statuses,
  } = props;

  const statusText = isBusy || isRestoring ? 'Przetwarzanie…' : toolsLoading ? 'Ładowanie narzędzi…' : 'Gotowy';

  return (
    <header className="app-header">
      <div className="app-header-left">
        <h1>Chat MCP</h1>
        <div className="header-buttons">
          <button type="button" className="history-button" onClick={onOpenHistory} disabled={!canOpenHistory}>
            Historia narzędzi
          </button>
          <button type="button" className="history-button" onClick={onToggleTools}>
            {isToolsOpen ? 'Ukryj narzędzia' : 'Pokaż narzędzia'}
          </button>
        </div>
        <div className="font-controls" aria-label="Regulacja wielkości tekstu">
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
        {statuses.map((status) => (
          <StatusBadge key={status.label} label={status.label} status={status.status} description={status.description} />
        ))}
      </div>
    </header>
  );
}
