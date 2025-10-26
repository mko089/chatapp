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
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    costUsd: number;
  } | null;
  models: string[];
  selectedModel: string;
  onSelectModel: (model: string) => void;
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
    usage,
    models,
    selectedModel,
    onSelectModel,
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
