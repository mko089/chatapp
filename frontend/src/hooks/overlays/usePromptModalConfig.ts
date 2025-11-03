import { useMemo } from 'react';
import type { PromptModalConfig } from '../../components/ChatOverlays';
import { systemMessage } from '../../constants/chat';
import type { PromptOptions } from './types';

export function usePromptModalConfig(options: PromptOptions): PromptModalConfig {
  const resolvedSystemText = options.systemText ?? systemMessage.content;
  const contextPreview = useMemo(() => options.buildPreview(), [options.buildPreview]);

  return useMemo(
    () => ({
      open: options.open,
      onClose: options.onClose,
      systemText: resolvedSystemText,
      contextPreview,
      onCopy: () => {
        const text = ['=== System ===', resolvedSystemText, '', '=== Kontekst (podgląd) ===', contextPreview].join('\n');
        try {
          navigator.clipboard.writeText(text).catch(() => {});
        } catch {
          // ignore clipboard errors
        }
      },
    }),
    [contextPreview, options.onClose, options.open, resolvedSystemText],
  );
}
