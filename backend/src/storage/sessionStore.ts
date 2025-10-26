import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

export type StoredChatMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  timestamp: string;
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

function normalizeRecord(record: SessionRecord): SessionRecord {
  return {
    ...record,
    messages: (record.messages ?? []).map((message) => ({
      ...message,
      timestamp: sanitizeTimestamp(message.timestamp),
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
