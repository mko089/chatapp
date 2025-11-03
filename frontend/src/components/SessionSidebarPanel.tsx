import { SessionSidebar } from './SessionSidebar';
import type { SessionSummary } from '../types';

type Props = {
  isCollapsed: boolean;
  onCollapse: () => void;
  onCreateSession: () => void;
  isSuperAdmin: boolean;
  sessionFilter: string;
  onSessionFilterChange: (value: string) => void;
  availableSessionOwners: string[];
  currentUserId: string;
  sessions: SessionSummary[];
  activeSessionId: string | null;
  isLoading: boolean;
  error: string | null;
  onSelectSession: (id: string) => void | Promise<void>;
  onDeleteSession: (id: string) => void | Promise<void>;
};

export function SessionSidebarPanel(props: Props) {
  const {
    isCollapsed,
    onCollapse,
    onCreateSession,
    isSuperAdmin,
    sessionFilter,
    onSessionFilterChange,
    availableSessionOwners,
    currentUserId,
    sessions,
    activeSessionId,
    isLoading,
    error,
    onSelectSession,
    onDeleteSession,
  } = props;

  if (isCollapsed) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 px-2 py-6">
        <button
          type="button"
          onClick={onCollapse}
          className="w-full rounded-full border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-200 transition hover:border-white/20 hover:bg-white/10"
        >
          Pokaż sesje
        </button>
        <button
          type="button"
          onClick={onCreateSession}
          className="w-full rounded-full border border-primary/50 bg-primary/20 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-primary transition hover:bg-primary/30"
        >
          Nowa sesja
        </button>
      </div>
    );
  }

  return (
    <>
      <div className="flex items-center justify-between border-b border-white/5 px-4 py-4">
        <div>
          <div className="text-sm font-semibold text-white">Sesje</div>
          <div className="text-xs text-slate-400">Twoje rozmowy</div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onCreateSession}
            className="rounded-full border border-primary/50 bg-primary/20 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-primary transition hover:bg-primary/30"
          >
            Nowa
          </button>
          <button
            type="button"
            onClick={onCollapse}
            className="rounded-full border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-200 transition hover:border-white/20 hover:bg-white/10"
          >
            Ukryj
          </button>
        </div>
      </div>
      {isSuperAdmin ? (
        <div className="border-b border-white/5 px-4 py-3">
          <label htmlFor="session-owner-filter" className="mb-1 block text-xs uppercase tracking-wide text-slate-400">
            Zakres sesji
          </label>
          <select
            id="session-owner-filter"
            value={sessionFilter}
            onChange={(event) => onSessionFilterChange(event.target.value)}
            className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-200 transition focus:border-primary/60 focus:outline-none focus:ring-0"
          >
            <option value="all">Wszyscy użytkownicy</option>
            <option value="self">Tylko moje</option>
            {availableSessionOwners
              .filter((owner) => owner !== currentUserId)
              .map((owner) => (
                <option key={owner} value={owner}>
                  {owner}
                </option>
              ))}
          </select>
        </div>
      ) : null}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3 scrollbar-thin">
        <SessionSidebar
          sessions={sessions}
          activeSessionId={activeSessionId}
          isLoading={isLoading}
          error={error}
          isSuperAdmin={isSuperAdmin}
          currentUserId={currentUserId}
          onSelect={onSelectSession}
          onDelete={onDeleteSession}
        />
      </div>
    </>
  );
}

