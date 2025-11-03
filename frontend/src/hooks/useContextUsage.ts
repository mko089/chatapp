import { useMemo } from 'react';
import type { ChatMessage } from '../types';
import { systemMessage } from '../constants/chat';
import { estimateTokensForMessages, resolveMaxContextTokens } from '../utils/tokens';

export function useContextUsage(params: {
  selectedModel: string;
  availableModels: string[];
  healthModel?: string;
  history: ChatMessage[];
  buildPreview: () => string;
}) {
  const { selectedModel, availableModels, healthModel, history, buildPreview } = params;

  return useMemo(() => {
    const model = selectedModel || availableModels[0] || healthModel || '';
    const maxTokens = resolveMaxContextTokens(model);
    const preview = buildPreview();
    const baseMessages = [
      { content: systemMessage.content },
      { content: preview },
      ...history.map((m) => ({ content: m.content })),
    ];
    const usedTokens = estimateTokensForMessages(baseMessages);
    const remainingTokens = Math.max(0, maxTokens - usedTokens);
    return { usedTokens, maxTokens, remainingTokens };
  }, [selectedModel, availableModels, healthModel, history, buildPreview]);
}

