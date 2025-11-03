import React from 'react';
import type { UsageSummary } from '../utils/health';

type AuthStatusBarProps = {
  userLabel: string;
  accountId?: string | null;
  usageSummary?: UsageSummary | null;
  onLogout: () => void;
};

export function AuthStatusBar({ userLabel, accountId, usageSummary, onLogout }: AuthStatusBarProps) {
  return (
    <div className="glass-panel flex flex-wrap items-center justify-between gap-3 px-5 py-3 text-sm text-slate-200">
      <div className="flex flex-wrap items-center gap-3">
        <span>
          Zalogowano jako <strong>{userLabel || 'Użytkownik'}</strong>
        </span>
        {accountId ? (
          <span>
            Konto: <strong>{accountId}</strong>
          </span>
        ) : null}
        {usageSummary && Number.isFinite(usageSummary.costUsd) ? (
          <span className="chip chip-primary">Koszt sesji: ${usageSummary.costUsd.toFixed(4)}</span>
        ) : null}
      </div>
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

