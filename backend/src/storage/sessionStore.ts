import { mkdir, readFile, writeFile, readdir, unlink } from 'node:fs/promises';
import path from 'node:path';
import type { ChatMessageMetadata } from '../types/chat.js';

export type StoredChatMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  timestamp: string;
  metadata?: ChatMessageMetadata;
};

export type StoredToolInvocation = {
  name: string;
  args: unknown;
  rawArgs?: unknown;
  result: unknown;
  timestamp: string;
};

export type SessionRecord = {
  id: string;
  userId?: string | null;
  accountId?: string | null;
  projectId?: string | null;
  currentDocPath?: string | null;
  messages: StoredChatMessage[];
  toolResults: StoredToolInvocation[];
  createdAt: string;
  updatedAt: string;
};

export type SessionSummary = {
  id: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  toolResultCount: number;
  lastMessagePreview?: string;
  lastMessageRole?: 'user' | 'assistant';
  lastMessageAt?: string;
  userId?: string | null;
  accountId?: string | null;
  projectId?: string | null;
  currentDocPath?: string | null;
  title?: string;
};

const DATA_DIR = path.resolve(process.cwd(), 'backend/data/sessions');

async function ensureDir() {
  await mkdir(DATA_DIR, { recursive: true });
}

function resolvePath(id: string) {
  const safeId = id.replace(/[^a-zA-Z0-9_-]/g, '_');
  return path.join(DATA_DIR, `${safeId}.json`);
}

export async function loadSession(id: string): Promise<SessionRecord | null> {
  try {
    const file = await readFile(resolvePath(id), 'utf-8');
    const raw = JSON.parse(file) as SessionRecord;
    return normalizeRecord(raw);
  } catch (error: any) {
    if (error && error.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

export async function saveSession(record: SessionRecord): Promise<void> {
  await ensureDir();
  const normalized = normalizeRecord(record);
  await writeFile(resolvePath(record.id), JSON.stringify(normalized, null, 2), 'utf-8');
}

export async function listSessions(options: { limit?: number; userId?: string | null; accountId?: string | null; includeUnassigned?: boolean } = {}): Promise<SessionSummary[]> {
  const { limit, userId, accountId, includeUnassigned = !userId } = options;
  await ensureDir();
  let files: string[] = [];
  try {
    files = await readdir(DATA_DIR);
  } catch (error: any) {
    if (error && error.code === 'ENOENT') {
      return [];
    }
    throw error;
  }

  const summaries: SessionSummary[] = [];

  for (const file of files) {
    if (!file.endsWith('.json')) {
      continue;
    }
    const sessionId = file.slice(0, -5);
    try {
      const raw = JSON.parse(await readFile(path.join(DATA_DIR, file), 'utf-8')) as SessionRecord;
      const normalized = normalizeRecord(raw);
      if (!shouldIncludeSession(normalized, { userId, accountId, includeUnassigned })) {
        continue;
      }
      const messageCount = normalized.messages.length;
      const toolResultCount = normalized.toolResults.length;
      const lastMessage = normalized.messages[messageCount - 1];
      const preview = lastMessage?.content?.trim?.() ?? '';
      const firstUserMessage = normalized.messages.find((msg) => msg.role === 'user' && typeof msg.content === 'string' && msg.content.trim().length > 0);
      const firstUserPreview = firstUserMessage?.content?.trim?.() ?? '';
      const summarized: SessionSummary = {
        id: normalized.id ?? sessionId,
        createdAt: normalized.createdAt,
        updatedAt: normalized.updatedAt,
        messageCount,
        toolResultCount,
        userId: normalized.userId ?? null,
        accountId: normalized.accountId ?? null,
        projectId: normalized.projectId ?? null,
        currentDocPath: normalized.currentDocPath ?? null,
        title: firstUserPreview ? truncate(firstUserPreview, 120) : undefined,
      };
      if (preview) {
        summarized.lastMessagePreview = truncate(preview, 280);
      }
      if (lastMessage?.role === 'user' || lastMessage?.role === 'assistant') {
        summarized.lastMessageRole = lastMessage.role;
        summarized.lastMessageAt = lastMessage.timestamp;
      }
      summaries.push(summarized);
    } catch (error) {
      // ignore malformed files but continue processing others
    }
  }

  summaries.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  if (limit && Number.isFinite(limit) && limit > 0) {
    return summaries.slice(0, limit);
  }
  return summaries;
}

export async function deleteSession(id: string): Promise<boolean> {
  try {
    await unlink(resolvePath(id));
    return true;
  } catch (error: any) {
    if (error && error.code === 'ENOENT') {
      return false;
    }
    throw error;
  }
}

function normalizeRecord(record: SessionRecord): SessionRecord {
  return {
    ...record,
    userId: sanitizeId(record.userId),
    accountId: sanitizeId(record.accountId),
    messages: (record.messages ?? []).map((message) => ({
      ...message,
      timestamp: sanitizeTimestamp(message.timestamp),
      metadata: sanitizeMetadata(message.metadata),
    })),
    toolResults: (record.toolResults ?? []).map((tool) => ({
      ...tool,
      timestamp: sanitizeTimestamp(tool.timestamp),
    })),
  };
}

function shouldIncludeSession(
  session: SessionRecord,
  options: { userId?: string | null; accountId?: string | null; includeUnassigned: boolean },
): boolean {
  const ownerId = session.userId ?? null;
  const sessionAccount = session.accountId ?? null;
  const requestedUser = options.userId ?? null;
  const requestedAccount = options.accountId ?? null;

  if (requestedUser) {
    if (ownerId && ownerId !== requestedUser) {
      return false;
    }
    if (!ownerId && !options.includeUnassigned) {
      return false;
    }
  } else if (!options.includeUnassigned && ownerId) {
    return false;
  }

  if (requestedAccount) {
    if (sessionAccount && sessionAccount !== requestedAccount) {
      return false;
    }
    if (!sessionAccount && !options.includeUnassigned) {
      return false;
    }
  }

  return true;
}

function sanitizeTimestamp(value?: string): string {
  if (value) {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString();
    }
  }
  return new Date().toISOString();
}

function sanitizeId(value?: string | null): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed.length > 0) {
      return trimmed;
    }
  }
  return null;
}

function sanitizeMetadata(metadata?: ChatMessageMetadata): ChatMessageMetadata | undefined {
  if (!metadata) {
    return undefined;
  }
  const sanitized: ChatMessageMetadata = {};
  if (metadata.llmDurationMs !== undefined) {
    const numeric = Number(metadata.llmDurationMs);
    if (Number.isFinite(numeric) && numeric >= 0) {
      sanitized.llmDurationMs = numeric;
    }
  }
  return Object.keys(sanitized).length > 0 ? sanitized : undefined;
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, Math.max(0, maxLength - 1))}…`;
}
