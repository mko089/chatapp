import type { SessionSummary } from '../types';

type Props = {
  sessions: SessionSummary[];
  activeSessionId: string | null;
  isLoading: boolean;
  error: string | null;
  isSuperAdmin: boolean;
  currentUserId: string | null | undefined;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
};

export function SessionSidebar({ sessions, activeSessionId, isLoading, error, isSuperAdmin, currentUserId, onSelect, onDelete }: Props) {
  const formatSessionTimestamp = (value?: string) => {
    if (!value) return 'Nieznana data';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'Nieznana data';
    return new Intl.DateTimeFormat('pl-PL', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
  };

  const deriveSessionTitle = (session: SessionSummary) => {
    const primary = session.title?.trim();
    if (primary && primary.length > 0) return primary;
    const fallback = session.lastMessagePreview?.trim();
    if (fallback && fallback.length > 0) return fallback;
    return `Sesja ${session.id.slice(0, 8)}`;
  };

  return (
    <>
      {isLoading ? <div className="chip chip-muted">Ładowanie…</div> : null}
      {error ? <div className="rounded-2xl border border-danger/40 bg-danger/15 px-4 py-2 text-sm text-danger">{error}</div> : null}
      {sessions.length === 0 && !isLoading ? (
        <div className="rounded-2xl border border-dashed border-white/10 bg-white/5 px-4 py-3 text-sm text-slate-400">Brak zapisanych rozmów</div>
      ) : null}
      {sessions.map((summary) => {
        const isActive = summary.id === activeSessionId;
        const title = deriveSessionTitle(summary);
        const updatedLabel = formatSessionTimestamp(summary.updatedAt ?? summary.lastMessageAt);
        const subtitle = `${summary.messageCount} wiadomości • ${summary.toolResultCount} wywołań MCP`;
        const ownerId = summary.userId ?? null;
        const ownerShort = ownerId ? `${ownerId.slice(0, 8)}${ownerId.length > 8 ? '…' : ''}` : null;
        return (
          <div key={summary.id} className={`rounded-2xl border px-4 py-3 transition ${isActive ? 'border-primary/60 bg-primary/15 text-white shadow-lg shadow-primary/10' : 'border-white/5 bg-white/5 hover:border-white/15 hover:bg-white/10'}`}>
            <button type="button" onClick={() => onSelect(summary.id)} className="w-full text-left" title={title}>
              <div className="flex items-center justify-between gap-3">
                <span className="truncate text-sm font-semibold text-white">{title}</span>
                <span className="whitespace-nowrap text-xs text-slate-400">{updatedLabel}</span>
              </div>
              <div className="mt-2 text-xs text-slate-400">{subtitle}</div>
              {summary.lastMessagePreview ? (
                <div className="mt-2 overflow-hidden text-sm text-slate-200" style={{ display: '-webkit-box', WebkitBoxOrient: 'vertical', WebkitLineClamp: 2 }}>
                  {summary.lastMessagePreview}
                </div>
              ) : null}
            </button>
            <div className="mt-3 flex items-center justify-between gap-2">
              {isSuperAdmin ? (
                <span className={`chip ${ownerId === currentUserId ? 'chip-primary' : 'chip-muted'}`}>
                  {ownerId ? (ownerId === currentUserId ? 'Moja sesja' : `Właściciel: ${ownerShort}`) : 'Bez właściciela'}
                </span>
              ) : null}
              <div className="flex items-center gap-2">
                <button type="button" onClick={() => onSelect(summary.id)} disabled={isActive} className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs uppercase tracking-wide text-slate-200 transition hover:border-primary/40 hover:bg-primary/20 hover:text-primary disabled:cursor-not-allowed disabled:opacity-60">
                  {isActive ? 'Aktywna' : 'Otwórz'}
                </button>
                <button type="button" onClick={() => onDelete(summary.id)} className="rounded-full border border-danger/40 bg-danger/15 px-4 py-2 text-xs uppercase tracking-wide text-danger transition hover:border-danger/60 hover:bg-danger/25">
                  Usuń
                </button>
              </div>
            </div>
          </div>
        );
      })}
    </>
  );
}

