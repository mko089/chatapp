import { FormEvent, useState } from 'react';

interface ChatInputProps {
  disabled?: boolean;
  onSubmit: (content: string) => Promise<void> | void;
}

export function ChatInput({ disabled, onSubmit }: ChatInputProps) {
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

  return (
    <form className="chat-input" onSubmit={handleSubmit}>
      <textarea
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder="Zadaj pytanie o zużycie mediów..."
        disabled={disabled || isSubmitting}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            void submit();
          }
        }}
      />
      <button type="submit" disabled={disabled || isSubmitting || value.trim().length === 0}>
        {isSubmitting ? 'Wysyłam…' : 'Wyślij'}
      </button>
    </form>
  );
}
