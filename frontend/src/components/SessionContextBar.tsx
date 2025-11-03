import React from 'react';
import type { SessionMetrics } from '../utils/sessionInsights';
import { formatSessionPeriodLabel } from '../utils/dateFmt';
import { formatPln, formatReceipts } from '../utils/numberFmt';

export function SessionContextBar({ context }: { context: SessionMetrics & { model: string } }) {
  const period = formatSessionPeriodLabel(context.from, context.to);
  const updateLabel = context.timestamp
    ? new Intl.DateTimeFormat('pl-PL', { hour: '2-digit', minute: '2-digit' }).format(new Date(context.timestamp))
    : null;

  return (
    <div className="glass-panel mx-auto flex w-full max-w-4xl flex-wrap items-center gap-2 px-5 py-3">
      <span className="chip chip-muted">Model: {context.model || '—'}</span>
      {period ? <span className="chip chip-muted">Okres: {period}</span> : null}
      {context.location ? <span className="chip chip-muted">Lokalizacja: {context.location}</span> : null}
      <span className="chip chip-primary">Brutto: {formatPln(context.gross)}</span>
      <span className="chip chip-primary">Netto: {formatPln(context.net)}</span>
      <span className="chip chip-primary">Paragony: {formatReceipts(context.receipts)}</span>
      {updateLabel ? <span className="chip chip-muted">Aktualizacja: {updateLabel}</span> : null}
    </div>
  );
}

