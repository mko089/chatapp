import type { FastifyInstance } from 'fastify';
import OpenAI from 'openai';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { MCPManager } from '../mcp/manager.js';
import { config } from '../config.js';
import { loadSession } from '../storage/sessionStore.js';
import { processChatInteraction } from '../services/chatProcessor.js';
import type { ChatRequestPayload } from '../types/chat.js';

const ChatMessageSchema = z.object({
  role: z.enum(['system', 'user', 'assistant', 'tool']),
  content: z.string().optional().default(''),
  tool_call_id: z.string().optional(),
  name: z.string().optional(),
  timestamp: z.string().optional(),
});

const ChatRequestSchema = z.object({
  messages: z.array(ChatMessageSchema).min(1),
  maxIterations: z.number().int().positive().max(12).optional(),
  sessionId: z.string().min(1).optional(),
});

interface RegisterChatRoutesOptions {
  mcpManager: MCPManager;
  openAi: OpenAI;
}

export async function registerChatRoutes(app: FastifyInstance<any>, options: RegisterChatRoutesOptions) {
  const { mcpManager, openAi } = options;

  app.post('/chat', async (request, reply) => {
    const body = ChatRequestSchema.safeParse(request.body);
    if (!body.success) {
      reply.status(400);
      return { error: 'Invalid request', details: body.error.issues };
    }

    const rawPayload = body.data as ChatRequestPayload & { maxIterations?: number };
    const normalizedPayload: ChatRequestPayload & { maxIterations: number } = {
      ...rawPayload,
      maxIterations: rawPayload.maxIterations ?? config.chatMaxIterations,
    };
    const sessionId = normalizedPayload.sessionId ?? randomUUID();
    const existingSession = await loadSession(sessionId);
    const result = await processChatInteraction({
      payload: normalizedPayload,
      sessionId,
      existingSession,
      mcpManager,
      openAi,
      model: config.llmModel,
      logger: request.log,
    });

    if (result.kind === 'success') {
      return {
        sessionId: result.sessionId,
        message: result.assistantMessage,
        toolResults: result.newToolResults,
        messages: result.storedMessages,
        toolHistory: result.combinedToolHistory,
        usage: result.usageSummary,
      };
    }

    reply.status(422);
    return {
      sessionId: result.sessionId,
      error: result.error,
      toolResults: result.newToolResults,
      messages: result.storedMessages,
      toolHistory: result.combinedToolHistory,
      usage: result.usageSummary,
    };
  });
}
