import React from 'react';
import type { ToolInvocation } from '../../types';
import { buildInlineSummary, buildDetailedSummary } from '../../utils/toolSummaries';

type Props = {
  open: boolean;
  items: ToolInvocation[];
  onClose: () => void;
  onInspect: (entry: ToolInvocation) => void;
  inlineSummaryFormatter?: (tool: ToolInvocation) => string;
  detailsFormatter?: (tool: ToolInvocation) => string;
};

export function HistoryModal({ open, items, onClose, onInspect, inlineSummaryFormatter = buildInlineSummary, detailsFormatter = buildDetailedSummary }: Props) {
  if (!open) return null;
  const visible = items.slice(-20).reverse();
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/75 backdrop-blur-sm" onClick={onClose}>
      <div className="glass-panel w-full max-w-4xl overflow-hidden" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-white/5 px-6 py-4">
          <div>
            <div className="text-lg font-semibold text-white">Historia narzędzi</div>
            <div className="text-sm text-slate-400">Ostatnie {Math.min(items.length, 20)} wpisów</div>
          </div>
          <button
            type="button"
            className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-sm text-slate-300 hover:border-white/30 hover:bg-white/10"
            onClick={onClose}
          >
            Zamknij
          </button>
        </div>
        <div className="max-h-[70vh] overflow-y-auto px-6 py-4 space-y-3 scrollbar-thin">
          {items.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-white/10 bg-white/5 px-4 py-3 text-sm text-slate-400">Brak wywołań narzędzi.</div>
          ) : (
            visible.map((entry, idx) => {
              const pretty = detailsFormatter(entry);
              const summary = inlineSummaryFormatter(entry);
              void summary; // reserved for future inline usage
              return (
                <div key={`${entry.name}-${idx}`} className="rounded-2xl border border-white/5 bg-white/5 px-5 py-4">
                  <div className="flex items-center justify-between text-sm text-slate-300">
                    <span className="font-semibold text-white">{entry.name}</span>
                    {entry.timestamp ? (
                      <span className="text-xs text-slate-400">{new Date(entry.timestamp).toLocaleString()}</span>
                    ) : null}
                  </div>
                  <pre className="mt-3 max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-2xl bg-surface/80 px-4 py-3 text-xs text-slate-200">
                    {pretty}
                  </pre>
                  <div className="mt-3 flex justify-end">
                    <button
                      type="button"
                      onClick={() => onInspect(entry)}
                      className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs uppercase tracking-wide text-slate-200 transition hover:border-primary/40 hover:bg-primary/20 hover:text-primary"
                    >
                      Szczegóły
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}

