type Props = {
  open: boolean;
  onClose: () => void;
  sessionId: string | null;
  loading: boolean;
  error: string | null;
  items: Array<{ id: string; route: string; phase: string; model: string | null; iteration: number | null; status: string | null; meta: any; payload: any; occurredAt: string }>;
  onRefresh: () => void;
  traceLink: string;
  formatJson: (v: unknown) => string;
};

export function LlmTracesModal({ open, onClose, sessionId, loading, error, items, onRefresh, traceLink, formatJson }: Props) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm" onClick={onClose}>
      <div className="glass-panel w-full max-w-5xl overflow-hidden" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-white/5 px-6 py-4">
          <div>
            <div className="text-lg font-semibold text-white">Logi modelu (LLM traces)</div>
            <div className="text-sm text-slate-400">Żądania/odpowiedzi OpenAI dla sesji {sessionId?.slice(0,8)}</div>
            <div className="mt-1 text-xs text-amber-300">
              Jeśli lista jest pusta, upewnij się, że <code>LLM_TRACE_ENABLED</code> = <code>true</code> na backendzie i wykonaj nowe zapytanie w tej sesji.
            </div>
          </div>
          <div className="flex items-center gap-2">
            <a
              href={traceLink}
              target="_blank"
              rel="noreferrer"
              className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-sm text-slate-300 hover:border-white/30 hover:bg-white/10"
            >
              Otwórz w API
            </a>
            <button
              type="button"
              className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-sm text-slate-300 hover:border-white/30 hover:bg-white/10"
              onClick={onRefresh}
            >
              Odśwież
            </button>
            <button
              type="button"
              className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-sm text-slate-300 hover:border-white/30 hover:bg-white/10"
              onClick={onClose}
            >
              Zamknij
            </button>
          </div>
        </div>
        <div className="max-h-[70vh] overflow-y-auto px-6 py-4 space-y-3 scrollbar-thin">
          {loading ? <div className="chip chip-muted">Ładowanie…</div> : null}
          {error ? (
            <div className="rounded-2xl border border-danger/40 bg-danger/15 px-4 py-2 text-sm text-danger">{error}</div>
          ) : null}
          {!loading && items.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-white/10 bg-white/5 px-4 py-3 text-sm text-slate-400">
              Brak logów dla tej sesji. Włącz <code>LLM_TRACE_ENABLED=true</code> na backendzie i spróbuj ponownie po nowym zapytaniu.
            </div>
          ) : null}
          {items.map((t) => (
            <div key={t.id} className="rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-slate-200">
              <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-slate-400">
                <span className="chip chip-muted">{t.phase}</span>
                {t.model ? <span className="chip chip-muted">{t.model}</span> : null}
                {t.route ? <span className="chip chip-muted">{t.route}</span> : null}
                {t.status ? <span className={`chip ${t.status === 'ok' ? 'chip-primary' : 'chip-muted'}`}>{t.status}</span> : null}
              </div>
              {t.payload ? (
                <div>
                  <div className="mb-1 text-xs uppercase tracking-wide text-slate-400">Payload</div>
                  <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-2xl bg-surface/80 px-4 py-3 text-xs text-slate-200">{formatJson(t.payload)}</pre>
                </div>
              ) : null}
              {t.meta ? (
                <div>
                  <div className="mb-1 text-xs uppercase tracking-wide text-slate-400">Meta</div>
                  <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-2xl bg-surface/80 px-4 py-3 text-xs text-slate-200">{formatJson(t.meta)}</pre>
                </div>
              ) : null}
              <div className="mt-2 text-right text-xs text-slate-400">{new Date(t.occurredAt).toLocaleString('pl-PL')}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

