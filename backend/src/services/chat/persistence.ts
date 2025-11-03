import { saveSession, type SessionRecord, type StoredChatMessage, type StoredToolInvocation } from '../../storage/sessionStore.js';
import type { IncomingChatMessage, ToolCallResult, ChatMessageMetadata } from '../../types/chat.js';

export async function persistSession(options: {
  existingSession: SessionRecord | null;
  sessionId: string;
  messages: StoredChatMessage[];
  toolHistory: StoredToolInvocation[];
  userId?: string | null;
  accountId?: string | null;
}): Promise<void> {
  const { existingSession, sessionId, messages, toolHistory, userId, accountId } = options;
  const nowIso = new Date().toISOString();
  await saveSession({
    id: sessionId,
    userId: existingSession?.userId ?? userId ?? null,
    accountId: existingSession?.accountId ?? accountId ?? null,
    messages,
    toolResults: toolHistory,
    createdAt: existingSession?.createdAt ?? nowIso,
    updatedAt: nowIso,
  });
}

export function prepareStoredMessages(
  messages: IncomingChatMessage[],
  assistantContent: string | null,
  assistantMetadata?: ChatMessageMetadata,
): { storedMessages: StoredChatMessage[]; assistantRecord?: StoredChatMessage } {
  const existingAssistantMetadata = sanitizeMetadata(assistantMetadata);
  const storedMessages: StoredChatMessage[] = messages
    .filter((msg) => msg.role !== 'tool' && msg.role !== 'system')
    .map((msg) => ({
      role: msg.role,
      content: msg.content ?? '',
      timestamp: normalizeTimestamp(msg.timestamp),
      metadata: sanitizeMetadata(msg.metadata),
    }));

  if (!assistantContent) {
    return { storedMessages };
  }

  const assistantRecord: StoredChatMessage = {
    role: 'assistant',
    content: assistantContent,
    timestamp: new Date().toISOString(),
    metadata: existingAssistantMetadata,
  };

  storedMessages.push(assistantRecord);
  return { storedMessages, assistantRecord };
}

export function normalizeTimestamp(input?: string): string {
  if (input) {
    const parsed = new Date(input);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString();
    }
  }
  return new Date().toISOString();
}

export function sanitizeMetadata(metadata?: ChatMessageMetadata): ChatMessageMetadata | undefined {
  if (!metadata) return undefined;
  const sanitized: ChatMessageMetadata = {};
  if (metadata.llmDurationMs !== undefined) {
    const numeric = Number(metadata.llmDurationMs);
    if (Number.isFinite(numeric) && numeric >= 0) {
      sanitized.llmDurationMs = numeric;
    }
  }
  return Object.keys(sanitized).length > 0 ? sanitized : undefined;
}

export function createToolRecord(name: string, args: unknown, result: unknown, rawArgs?: unknown): ToolCallResult {
  return {
    name,
    args,
    rawArgs,
    result,
    timestamp: new Date().toISOString(),
  };
}

export function combineToolResults(existing: StoredToolInvocation[], latest: ToolCallResult[]): StoredToolInvocation[] {
  const normalizedExisting = existing.map((entry) => ({
    name: entry.name,
    args: entry.args,
    rawArgs: (entry as any).rawArgs,
    result: entry.result,
    timestamp: normalizeTimestamp(entry.timestamp),
  }));
  const mappedLatest = latest.map((entry) => ({
    name: entry.name,
    args: entry.args,
    rawArgs: (entry as any).rawArgs,
    result: entry.result,
    timestamp: normalizeTimestamp(entry.timestamp),
  }));
  return [...normalizedExisting, ...mappedLatest];
}

