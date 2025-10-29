import { FormEvent, useImperativeHandle, useMemo, useState, forwardRef } from 'react';

export interface ChatInputHandle {
  insert: (text: string) => void;
  focus: () => void;
}

interface ChatInputProps {
  disabled?: boolean;
  busy?: boolean;
  onSubmit: (content: string) => Promise<void> | void;
  suggestions?: string[];
  inputRef?: React.RefObject<HTMLTextAreaElement>;
}

export const ChatInput = forwardRef<ChatInputHandle, ChatInputProps>(function ChatInput(
  { disabled, busy, onSubmit, suggestions = [], inputRef }: ChatInputProps,
  ref,
) {
  const [value, setValue] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [openSuggest, setOpenSuggest] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);

  const actionLabel = useMemo(() => buildActionLabel(value), [value]);

  const filtered = useMemo(() => {
    const q = extractSuggestQuery(value);
    if (!q) return [] as string[];
    const term = q.toLowerCase();
    const uniq = Array.from(new Set(suggestions));
    return uniq.filter((s) => s.toLowerCase().includes(term)).slice(0, 8);
  }, [value, suggestions]);

  useImperativeHandle(ref, () => ({
    focus: () => (inputRef as any)?.current?.focus?.(),
    insert: (text: string) => setValue(text),
  }));

  const submit = async () => {
    const trimmed = value.trim();
    if (!trimmed || disabled || isSubmitting) return;
    try {
      setIsSubmitting(true);
      await onSubmit(trimmed);
      setValue('');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    await submit();
  };

  const isDisabled = disabled || isSubmitting || value.trim().length === 0;

  return (
    <form
      className="pointer-events-auto sticky bottom-0 left-0 right-0 w-full bg-gradient-to-t from-surface via-surface/95 to-transparent"
      onSubmit={handleSubmit}
    >
      <div className="mx-auto w-full max-w-4xl px-4 pb-8">
        <div className="glass-panel flex flex-col gap-4 px-5 py-4">
          <textarea
            value={value}
            onChange={(event) => setValue(event.target.value)}
            placeholder="Zadaj pytanie… np. obroty Garden Bistro z wczoraj"
            disabled={disabled || isSubmitting || busy}
            ref={inputRef as any}
            className="min-h-[120px] w-full resize-none rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-base text-slate-100 placeholder:text-slate-500 focus:border-accent/50 focus:outline-none focus:ring-2 focus:ring-accent/30"
            onKeyDown={(event) => {
              if (openSuggest && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
                event.preventDefault();
                setActiveIdx((prev) => {
                  const max = Math.max(0, filtered.length - 1);
                  if (event.key === 'ArrowDown') return Math.min(max, prev + 1);
                  return Math.max(0, prev - 1);
                });
                return;
              }
              if (openSuggest && (event.key === 'Tab' || event.key === 'Enter')) {
                if (filtered.length > 0) {
                  event.preventDefault();
                  const picked = filtered[Math.max(0, Math.min(activeIdx, filtered.length - 1))];
                  if (picked) {
                    setValue(applySuggestion(value, picked));
                    setOpenSuggest(false);
                    setActiveIdx(0);
                  }
                }
                return;
              }
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                void submit();
              }
              const shouldOpen = extractSuggestQuery(value) !== null;
              setOpenSuggest(shouldOpen);
            }}
          />
          {openSuggest && filtered.length > 0 ? (
            <div className="-mt-1 max-h-60 overflow-auto rounded-2xl border border-white/10 bg-surface px-1 py-1 text-sm text-slate-100 shadow-card">
              {filtered.map((s, i) => (
                <button
                  key={s}
                  type="button"
                  className={`flex w-full items-center justify-between rounded-xl px-3 py-2 text-left ${i === activeIdx ? 'bg-white/10' : 'hover:bg-white/5'}`}
                  onMouseEnter={() => setActiveIdx(i)}
                  onClick={() => {
                    setValue(applySuggestion(value, s));
                    setOpenSuggest(false);
                    setActiveIdx(0);
                  }}
                >
                  <span>{s}</span>
                  <span className="text-xs text-slate-400">Tab/Enter</span>
                </button>
              ))}
            </div>
          ) : null}
          <div className="flex flex-wrap items-center justify-between gap-3 text-xs uppercase tracking-wide text-slate-400">
            <span>Shift+Enter ⇒ nowa linia · Enter ⇒ {busy ? 'trwa wykonanie…' : 'wyślij polecenie'} · / ⇒ podpowiedzi</span>
            <button
              type="submit"
              disabled={isDisabled || busy}
              className="inline-flex items-center gap-2 rounded-full border border-primary/50 bg-primary/20 px-6 py-2 text-sm font-semibold uppercase tracking-wide text-primary transition enabled:hover:bg-primary/30 enabled:hover:text-primary disabled:cursor-not-allowed disabled:opacity-40"
            >
              {busy || isSubmitting ? 'Wysyłam…' : actionLabel}
            </button>
          </div>
        </div>
      </div>
    </form>
  );
});

function buildActionLabel(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) {
    return 'Wyślij';
  }

  const commandMatch = trimmed.match(/^(?:\/|run\s+|tool\s+)([\w.-]+)/i);
  if (commandMatch) {
    return `Uruchom ${commandMatch[1]}`;
  }

  const toolishMatch = trimmed.match(/^([a-z0-9_.-]+)\s*[{(]/i);
  if (toolishMatch) {
    return `Uruchom ${toolishMatch[1]}`;
  }

  return 'Wyślij';
}

function extractSuggestQuery(raw: string): string | null {
  const caretStarts = raw.trimStart();
  if (caretStarts.startsWith('/')) {
    const token = caretStarts.slice(1).split(/\s|\{/)[0] ?? '';
    return token.length > 0 ? token : '';
  }
  const m = raw.match(/^(?:run|tool)\s+([\w.-]*)$/i);
  if (m) {
    return m[1] ?? '';
  }
  return null;
}

function applySuggestion(raw: string, suggestion: string): string {
  const caret = raw.trimStart();
  const suffix = raw.endsWith(' ') || raw.length === 0 ? '' : ' ';
  if (caret.startsWith('/')) {
    return `/${suggestion} `;
  }
  if (/^(?:run|tool)\s+[\w.-]*$/i.test(raw)) {
    return raw.replace(/^(?:run|tool)\s+[\w.-]*$/i, (m) => m.replace(/[\w.-]*$/, suggestion)) + ' ';
  }
  return raw + suffix + suggestion + ' ';
}
