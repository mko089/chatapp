import { FormEvent, useMemo, useState } from 'react';

interface ChatInputProps {
  disabled?: boolean;
  busy?: boolean;
  onSubmit: (content: string) => Promise<void> | void;
}

export function ChatInput({ disabled, busy, onSubmit }: ChatInputProps) {
  const [value, setValue] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const actionLabel = useMemo(() => buildActionLabel(value), [value]);

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
            className="min-h-[120px] w-full resize-none rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-base text-slate-100 placeholder:text-slate-500 focus:border-accent/50 focus:outline-none focus:ring-2 focus:ring-accent/30"
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                void submit();
              }
            }}
          />
          <div className="flex flex-wrap items-center justify-between gap-3 text-xs uppercase tracking-wide text-slate-400">
            <span>
              Shift + Enter ⇒ nowa linia · Enter ⇒ {busy ? 'trwa wykonanie…' : 'wyślij polecenie'}
            </span>
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
}

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
