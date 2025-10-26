export type IncomingChatMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content?: string;
  tool_call_id?: string;
  name?: string;
  timestamp?: string;
};

export type ChatRequestPayload = {
  messages: IncomingChatMessage[];
  maxIterations?: number;
  sessionId?: string;
};

export type AssistantMessage = {
  role: 'assistant';
  content: string;
  timestamp?: string;
};

export type ToolCallResult = {
  name: string;
  args: unknown;
  result: unknown;
  timestamp: string;
};
