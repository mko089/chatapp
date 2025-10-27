import { useCallback } from 'react';
import { useAuthorizedFetch } from './useAuthorizedFetch';
import type { ChatMessage, ToolInvocation } from '../types';

export type StreamEvent =
  | { type: 'assistant.delta'; text: string }
  | { type: 'assistant.done'; content: string; llmDurationMs?: number }
  | { type: 'tool.started'; id: string; name: string; args: unknown }
  | { type: 'tool.completed'; id: string; name: string; result: unknown }
  | { type: 'usage'; promptTokens?: number; completionTokens?: number; totalTokens?: number; costUsd?: number }
  | { type: 'budget.warning'; details?: unknown }
  | { type: 'budget.blocked'; details?: unknown }
  | { type: 'final'; sessionId: string; messages: any[]; toolHistory: ToolInvocation[] }
  | { type: 'error'; message: string };

export function useChatStream() {
  const authorizedFetch = useAuthorizedFetch();

  return useCallback(
    async (url: string, payload: unknown, handlers: {
      onAssistantDelta?: (text: string) => void;
      onAssistantDone?: (content: string, ms?: number) => void;
      onToolStarted?: (id: string, name: string, args: unknown) => void;
      onToolCompleted?: (id: string, name: string, result: unknown) => void;
      onBudgetWarning?: (details?: unknown) => void;
      onBudgetBlocked?: (details?: unknown) => void;
      onFinal?: (sessionId: string, messages: ChatMessage[], toolHistory: ToolInvocation[]) => void;
      onError?: (message: string) => void;
    }, signal?: AbortSignal,
    ): Promise<void> => {
      const response = await authorizedFetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal,
      });
      if (!response.ok) {
        const text = await response.text();
        throw new Error(text || `HTTP ${response.status}`);
      }
      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('Brak strumienia odpowiedzi');
      }
      const decoder = new TextDecoder();
      let buffer = '';
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let idx: number;
        while ((idx = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, idx).trim();
          buffer = buffer.slice(idx + 1);
          if (!line) continue;
          try {
            const event = JSON.parse(line) as StreamEvent;
            switch (event.type) {
              case 'assistant.delta':
                handlers.onAssistantDelta?.(event.text);
                break;
              case 'assistant.done':
                handlers.onAssistantDone?.(event.content, event.llmDurationMs);
                break;
              case 'tool.started':
                handlers.onToolStarted?.(event.id, event.name, event.args);
                break;
              case 'tool.completed':
                handlers.onToolCompleted?.(event.id, event.name, event.result);
                break;
              case 'budget.warning':
                handlers.onBudgetWarning?.(event.details);
                break;
              case 'budget.blocked':
                handlers.onBudgetBlocked?.(event.details);
                break;
              case 'final':
                handlers.onFinal?.(event.sessionId, (event.messages as any) || [], event.toolHistory || []);
                break;
              case 'error':
                handlers.onError?.(event.message);
                break;
              default:
                break;
            }
          } catch (err) {
            // ignore malformed line
          }
        }
      }
    },
    [authorizedFetch],
  );
}

