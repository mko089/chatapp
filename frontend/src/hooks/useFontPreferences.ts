import { useCallback } from 'react';
import { usePersistentState } from './usePersistentState';

export function useFontPreferences() {
  const clamp = useCallback((value: number) => Math.min(1.6, Math.max(0.6, value)), []);

  const [fontScale, setFontScale] = usePersistentState<number>('chat-font-scale', 1.1, {
    deserialize: (value) => {
      const parsed = Number.parseFloat(value);
      if (Number.isNaN(parsed)) return null;
      return clamp(parsed);
    },
    serialize: (value) => value.toString(),
  });

  const adjustFont = useCallback((delta: number) => {
    setFontScale((prev) => {
      const next = Math.round((prev + delta) * 100) / 100;
      return clamp(next);
    });
  }, [clamp, setFontScale]);

  const resetFont = useCallback(() => setFontScale(1.1), [setFontScale]);

  const label = `${Math.round(fontScale * 100)}%`;

  return { fontScale, fontScaleLabel: label, adjustFont, resetFont } as const;
}

