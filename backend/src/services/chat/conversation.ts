import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import type { IncomingChatMessage } from '../../types/chat.js';

export function buildInitialConversation(messages: IncomingChatMessage[]): ChatCompletionMessageParam[] {
  const conversation: ChatCompletionMessageParam[] = [];
  for (const message of messages) {
    if (message.role === 'tool') continue;
    if (message.role === 'assistant') {
      conversation.push({ role: 'assistant', content: message.content ?? '' });
    } else {
      conversation.push({ role: message.role, content: message.content ?? '' } as ChatCompletionMessageParam);
    }
  }
  return conversation;
}

export function contentToString(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!content) return '';
  if (Array.isArray(content)) {
    const text = content
      .map((part) => {
        if (typeof part === 'string') return part;
        if (part && typeof part === 'object') {
          const candidate = part as { type?: string; text?: string; content?: unknown };
          if (candidate.text) return candidate.text;
        }
        return '';
      })
      .filter(Boolean)
      .join('\n');
    if (text) return text;
    try {
      return JSON.stringify(content);
    } catch {
      return '';
    }
  }
  try {
    return JSON.stringify(content);
  } catch {
    return '';
  }
}

export function extractLastAssistant(conversation: ChatCompletionMessageParam[]): string | null {
  for (let i = conversation.length - 1; i >= 0; i -= 1) {
    const message = conversation[i];
    if (message.role === 'assistant') {
      return contentToString(message.content);
    }
  }
  return null;
}

