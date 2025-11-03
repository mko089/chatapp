type Props = {
  open: boolean;
  onClose: () => void;
  systemText: string;
  contextPreview: string;
  onCopy?: () => void;
};

export function PromptModal({ open, onClose, systemText, contextPreview, onCopy }: Props) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm" onClick={onClose}>
      <div className="glass-panel w-full max-w-3xl overflow-hidden" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-white/5 px-6 py-4">
          <div>
            <div className="text-lg font-semibold text-white">System prompt</div>
            <div className="text-sm text-slate-400">Podgląd wstępu i bieżącego kontekstu dla tej rozmowy</div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-sm text-slate-300 hover:border-white/30 hover:bg-white/10"
              onClick={onCopy}
            >
              Kopiuj
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
        <div className="max-h-[70vh] overflow-auto px-6 py-4 space-y-6">
          <div>
            <div className="mb-2 text-sm font-semibold text-white">System</div>
            <pre className="whitespace-pre-wrap break-words rounded-2xl bg-white/5 px-4 py-3 text-sm text-slate-200">{systemText}</pre>
          </div>
          <div>
            <div className="mb-2 text-sm font-semibold text-white">Kontekst (podgląd)</div>
            <pre className="whitespace-pre-wrap break-words rounded-2xl bg-white/5 px-4 py-3 text-sm text-slate-200">{contextPreview}</pre>
          </div>
        </div>
      </div>
    </div>
  );
}

