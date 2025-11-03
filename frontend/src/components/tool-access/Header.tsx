interface HeaderProps {
  pendingCount: number;
  onRefresh: () => void;
  refreshing: boolean;
  onClose: () => void;
}

export function ToolAccessHeader({ pendingCount, onRefresh, refreshing, onClose }: HeaderProps) {
  return (
    <header className="flex items-center justify-between border-b border-white/10 px-6 py-4">
      <div>
        <div className="text-lg font-semibold text-white">Konfiguracja dostępu do narzędzi</div>
        <div className="text-sm text-slate-400">
          Zarządzaj uprawnieniami do grup narzędzi i indywidualnych funkcji MCP dla ról.
        </div>
      </div>
      <div className="flex items-center gap-2">
        {pendingCount > 0 ? <span className="chip chip-warning">Niezapisane: {pendingCount}</span> : null}
        <button
          type="button"
          className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-slate-300 transition hover:border-white/20 hover:bg-white/10 disabled:opacity-50"
          onClick={onRefresh}
          disabled={refreshing}
        >
          Odśwież
        </button>
        <button
          type="button"
          className="rounded-full border border-danger/40 bg-danger/15 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-danger transition hover:bg-danger/25"
          onClick={onClose}
        >
          Zamknij
        </button>
      </div>
    </header>
  );
}

