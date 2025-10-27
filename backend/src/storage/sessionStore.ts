import { mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
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
  result: unknown;
  timestamp: string;
};

export type SessionRecord = {
  id: string;
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

export async function listSessions(options: { limit?: number } = {}): Promise<SessionSummary[]> {
  const { limit } = options;
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
      const messageCount = normalized.messages.length;
      const toolResultCount = normalized.toolResults.length;
      const lastMessage = normalized.messages[messageCount - 1];
      const preview = lastMessage?.content?.trim?.() ?? '';
      const summarized: SessionSummary = {
        id: normalized.id ?? sessionId,
        createdAt: normalized.createdAt,
        updatedAt: normalized.updatedAt,
        messageCount,
        toolResultCount,
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

function normalizeRecord(record: SessionRecord): SessionRecord {
  return {
    ...record,
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

function sanitizeTimestamp(value?: string): string {
  if (value) {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString();
    }
  }
  return new Date().toISOString();
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
