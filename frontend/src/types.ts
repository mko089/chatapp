export type ChatRole = 'system' | 'user' | 'assistant' | 'tool';

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

export interface ToolInvocation {
  name: string;
  args: unknown;
  result: unknown;
  timestamp?: string;
}
