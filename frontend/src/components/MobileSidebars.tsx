import React from 'react';
import type { SessionSummary } from '../types';
import { SessionSidebar } from './SessionSidebar';

type MobileToolDrawerProps = {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
};

export function MobileToolDrawer({ open, onClose, children }: MobileToolDrawerProps) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-40 flex items-stretch lg:hidden" onClick={onClose}>
      <div className="flex-1 bg-black/60 backdrop-blur-sm" />
      <div className="h-full w-80 bg-surface px-4 py-6" onClick={(event) => event.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}

type MobileSessionDrawerProps = {
  open: boolean;
  onClose: () => void;
  isSuperAdmin: boolean;
  sessionFilter: string;
  onSessionFilterChange: (value: string) => void;
  availableSessionOwners: string[];
  currentUserId: string;
  onCreateNewSession: () => void | Promise<void>;
  sessions: SessionSummary[];
  activeSessionId: string | null;
  isLoading: boolean;
  error: string | null;
  onSelectSession: (id: string) => void | Promise<void>;
  onDeleteSession: (id: string) => void | Promise<void>;
};

export function MobileSessionDrawer({
  open,
  onClose,
  isSuperAdmin,
  sessionFilter,
  onSessionFilterChange,
  availableSessionOwners,
  currentUserId,
  onCreateNewSession,
  sessions,
  activeSessionId,
  isLoading,
  error,
  onSelectSession,
  onDeleteSession,
}: MobileSessionDrawerProps) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-stretch lg:hidden" onClick={onClose}>
      <div className="flex-1 bg-black/60 backdrop-blur-sm" />
      <div className="h-full w-80 bg-surface" onClick={(event) => event.stopPropagation()}>
        <div className="flex h-full flex-col">
          <div className="flex items-center justify-between border-b border-white/5 px-4 py-4">
            <div>
              <div className="text-lg font-semibold text-white">Sesje</div>
              <div className="text-sm text-slate-400">Twoje rozmowy</div>
            </div>
            <button
              type="button"
              className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-sm text-slate-300 hover:border-white/30 hover:bg-white/10"
              onClick={onClose}
            >
              Zamknij
            </button>
          </div>
          <div className="border-b border-white/5 px-4 py-3">
            <button
              type="button"
              onClick={async () => {
                await onCreateNewSession();
                onClose();
              }}
              className="w-full rounded-full border border-primary/50 bg-primary/20 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-primary transition hover:bg-primary/30"
            >
              Nowa sesja
            </button>
          </div>
          {isSuperAdmin ? (
            <div className="border-b border-white/5 px-4 py-3">
              <label htmlFor="mobile-session-owner-filter" className="mb-1 block text-xs uppercase tracking-wide text-slate-400">
                Zakres sesji
              </label>
              <select
                id="mobile-session-owner-filter"
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
              onSelect={async (id) => {
                await onSelectSession(id);
                onClose();
              }}
              onDelete={onDeleteSession}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
