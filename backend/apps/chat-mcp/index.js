// Chat sessions MCP server (stdio)
// Enables retrieving stored chat history for a given sessionId
import { readFile } from 'node:fs/promises';
import { existsSync, appendFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const server = new McpServer({ name: 'chat-mcp', version: '0.1.0' });

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOG_PATH = process.env.CHATAPP_MCP_LOG ?? path.resolve(__dirname, '../../logs/chat-mcp.log');

function log(message, extra) {
  try {
    mkdirSync(path.dirname(LOG_PATH), { recursive: true });
    const payload =
      typeof extra === 'undefined'
        ? message
        : `${message} ${JSON.stringify(extra, null, 2)}`;
    appendFileSync(LOG_PATH, `[${new Date().toISOString()}] ${payload}\n`, { encoding: 'utf-8' });
  } catch {
    // ignore logging failures
  }
}

const SESSION_DIR_CANDIDATES = [
  process.env.CHATAPP_SESSIONS_DIR,
  path.resolve(__dirname, '../backend/data/sessions'),
  path.resolve(__dirname, '../../backend/data/sessions'),
  path.resolve(__dirname, '../../data/sessions'),
  path.resolve(__dirname, '../../../backend/backend/data/sessions'),
  path.resolve(process.cwd(), 'backend/backend/data/sessions'),
  path.resolve(process.cwd(), 'backend/data/sessions'),
  '/workspace/chatapp/backend/backend/data/sessions',
  '/home/ubuntu/Projects/chatapp/backend/backend/data/sessions',
];

function detectDataDir() {
  for (const candidate of SESSION_DIR_CANDIDATES) {
    if (!candidate) {
      continue;
    }
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  // fallback to first defined candidate or default path relative to script
  return SESSION_DIR_CANDIDATES.find((candidate) => typeof candidate === 'string' && candidate.length > 0)
    ?? path.resolve(__dirname, '../backend/data/sessions');
}

const DATA_DIR = detectDataDir();
log('Detected data directory', { dataDir: DATA_DIR });

const StoredMessageSchema = z.object({
  role: z.enum(['system', 'user', 'assistant', 'tool']),
  content: z.string().default(''),
  timestamp: z.string(),
  metadata: z.record(z.any()).optional(),
});

const StoredToolInvocationSchema = z.object({
  name: z.string(),
  args: z.any().optional(),
  result: z.any().optional(),
  timestamp: z.string(),
});

const SessionRecordSchema = z.object({
  id: z.string(),
  messages: z.array(StoredMessageSchema).default([]),
  toolResults: z.array(StoredToolInvocationSchema).default([]),
  createdAt: z.string(),
  updatedAt: z.string(),
});

function sanitizeFileName(id) {
  return id.replace(/[^a-zA-Z0-9_-]/g, '_');
}

function resolveSessionPath(sessionId) {
  return path.join(DATA_DIR, `${sanitizeFileName(sessionId)}.json`);
}

async function loadSession(sessionId) {
  log('Loading session', { sessionId });
  const file = await readFile(resolveSessionPath(sessionId), 'utf-8');
  const parsed = SessionRecordSchema.parse(JSON.parse(file));
  return {
    ...parsed,
    messages: parsed.messages.map((message) => ({
      ...message,
      content: message.content ?? '',
    })),
  };
}

server.registerTool(
  'chat_fetch_session',
  {
    title: 'Fetch chat session',
    description: 'Returns stored chat messages (and optionally tool invocations) for a sessionId',
    inputSchema: {
      sessionId: z.string().min(1, 'sessionId is required'),
      includeToolResults: z.boolean().optional(),
    },
    outputSchema: {
      sessionId: z.string(),
      createdAt: z.string(),
      updatedAt: z.string(),
      messageCount: z.number(),
      toolResultCount: z.number(),
      messages: z.array(StoredMessageSchema),
      toolResults: z.array(StoredToolInvocationSchema).optional(),
    },
  },
  async ({ sessionId, includeToolResults = false }) => {
    if (!sessionId || sessionId.trim().length === 0) {
      throw new Error('sessionId is required');
    }
    const normalizedId = sessionId.trim();
    if (normalizedId.includes('/') || normalizedId.includes('\\')) {
      throw new Error('sessionId contains unsupported characters');
    }

    let record;
    try {
      record = await loadSession(normalizedId);
    } catch (error) {
      log('Failed to load session', { sessionId: normalizedId, error: error instanceof Error ? error.message : String(error) });
      if (error && error.code === 'ENOENT') {
        throw new Error(`Session ${normalizedId} not found`);
      }
      throw error;
    }

    const payload = {
      sessionId: record.id,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      messageCount: record.messages.length,
      toolResultCount: record.toolResults.length,
      messages: record.messages,
      ...(includeToolResults ? { toolResults: record.toolResults } : {}),
    };

    const content = JSON.stringify(payload, null, 2);
    log('Returning session payload', { sessionId: normalizedId, includeToolResults, messageCount: payload.messageCount, toolResultCount: payload.toolResultCount });
    return {
      content: [{ type: 'text', text: content }],
      structuredContent: payload,
    };
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
