import { useEffect } from 'react';

export function useKeyboardShortcuts(params: {
  onOpenTools: () => void;
  onFocusInput: () => void;
  onEscape: () => void;
}) {
  const { onOpenTools, onFocusInput, onEscape } = params;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const isMeta = e.ctrlKey || e.metaKey;
      if (isMeta && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        onOpenTools();
        return;
      }
      if (isMeta && e.key.toLowerCase() === 'i') {
        e.preventDefault();
        onFocusInput();
        return;
      }
      if (e.key === 'Escape') {
        onEscape();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onOpenTools, onFocusInput, onEscape]);
}

