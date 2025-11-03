interface FooterProps {
  version: number | undefined;
  pendingCount: number;
  isSaving: boolean;
  onReset: () => void;
  onSave: () => void;
}

export function ToolAccessFooter({ version, pendingCount, isSaving, onReset, onSave }: FooterProps) {
  return (
    <footer className="flex items-center justify-between border-t border-white/10 px-6 py-4">
      <div className="text-xs text-slate-400">Wersja konfiguracji: {version ?? '—'}</div>
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onReset}
          className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-slate-200 transition hover:border-white/20 hover:bg-white/10 disabled:opacity-50"
          disabled={pendingCount === 0 || isSaving}
        >
          Resetuj zmiany
        </button>
        <button
          type="button"
          onClick={onSave}
          className="rounded-full border border-primary/40 bg-primary/20 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-primary transition hover:bg-primary/30 disabled:opacity-50"
          disabled={pendingCount === 0 || isSaving}
        >
          {isSaving ? 'Zapisywanie…' : 'Zapisz zmiany'}
        </button>
      </div>
    </footer>
  );
}

