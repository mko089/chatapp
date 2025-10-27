import { FormEvent, useState } from 'react';

interface ChatInputProps {
  disabled?: boolean;
  busy?: boolean;
  onSubmit: (content: string) => Promise<void> | void;
  onCancel?: () => void;
}

export function ChatInput({ disabled, busy, onSubmit, onCancel }: ChatInputProps) {
  const [value, setValue] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

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

  const showCancel = Boolean(busy && onCancel);

  return (
    <form className="chat-input" onSubmit={handleSubmit}>
      <textarea
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder="Zadaj pytanie o zużycie mediów..."
        disabled={disabled || isSubmitting || busy}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            void submit();
          }
        }}
      />
      {showCancel ? (
        <button type="button" className="btn-cancel" onClick={onCancel}>
          Anuluj
        </button>
      ) : (
        <button type="submit" disabled={disabled || isSubmitting || value.trim().length === 0}>
          {isSubmitting || busy ? 'Wysyłam…' : 'Wyślij'}
        </button>
      )}
    </form>
  );
}
