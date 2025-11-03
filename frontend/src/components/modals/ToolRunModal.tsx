import type { ToolInvocation } from '../../types';
import { formatStructuredValue } from '../../utils/format';

type RunEditorState = { name: string; raw: string; busy: boolean; error: string | null };

type Props = {
  open: boolean;
  onClose: () => void;
  selected: ToolInvocation | null;
  editor: RunEditorState;
  setEditor: (next: RunEditorState) => void;
  onRun: () => void;
  formatArgs?: (args: unknown) => string;
  formatResult?: (result: unknown) => string;
};

export function ToolRunModal({ open, onClose, selected, editor, setEditor, onRun, formatArgs = (v) => formatStructuredValue(v, 0, '{}'), formatResult = (v) => formatStructuredValue(v, 2, 'null') }: Props) {
  if (!open || !selected) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm" onClick={onClose}>
      <div className="glass-panel w-full max-w-3xl overflow-hidden" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-white/5 px-6 py-4">
          <div>
            <div className="text-lg font-semibold text-white">Szczegóły narzędzia</div>
            <div className="text-sm text-slate-400">{selected.name}</div>
          </div>
          <button
            type="button"
            className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-sm text-slate-300 hover:border-white/30 hover:bg-white/10"
            onClick={onClose}
          >
            Zamknij
          </button>
        </div>
        <div className="max-h-[70vh] overflow-y-auto px-6 py-4 space-y-4 scrollbar-thin">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <div className="mb-1 text-xs uppercase tracking-wide text-slate-400">Args</div>
              <pre className="whitespace-pre-wrap break-words rounded-2xl bg-surface/80 px-4 py-3 text-sm text-slate-200">{formatArgs(selected.args)}</pre>
            </div>
            <div>
              <div className="mb-1 text-xs uppercase tracking-wide text-slate-400">Result</div>
              <pre className="whitespace-pre-wrap break-words rounded-2xl bg-surface/80 px-4 py-3 text-sm text-slate-200">{formatResult(selected.result)}</pre>
            </div>
          </div>
          <div className="mt-2 rounded-2xl border border-white/10 bg-white/5 p-4">
            <div className="mb-2 text-xs uppercase tracking-wide text-slate-400">Uruchom ponownie (RAW)</div>
            <div className="mb-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
              <label className="col-span-1 text-xs text-slate-400">
                Narzędzie
                <input
                  type="text"
                  className="mt-1 w-full rounded-xl border border-white/10 bg-surface/80 px-3 py-2 text-sm text-slate-200 focus:outline-none focus:ring-1 focus:ring-primary/40"
                  value={editor.name}
                  onChange={(e) => setEditor({ ...editor, name: e.target.value })}
                />
              </label>
            </div>
            <label className="block text-xs text-slate-400">
              RAW arguments (JSON)
              <textarea
                className="mt-1 h-40 w-full resize-y rounded-xl border border-white/10 bg-surface/80 px-3 py-2 font-mono text-xs text-slate-200 focus:outline-none focus:ring-1 focus:ring-primary/40"
                value={editor.raw}
                onChange={(e) => setEditor({ ...editor, raw: e.target.value })}
              />
            </label>
            {editor.error ? (
              <div className="mt-2 rounded-xl border border-danger/30 bg-danger/15 px-3 py-2 text-xs text-danger">{editor.error}</div>
            ) : null}
            <div className="mt-3 flex justify-end gap-2">
              <button
                type="button"
                disabled={editor.busy}
                onClick={onRun}
                className="rounded-full border border-primary/40 bg-primary/20 px-4 py-2 text-xs uppercase tracking-wide text-primary transition hover:bg-primary/30 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {editor.busy ? 'Uruchamianie…' : 'Uruchom narzędzie'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

