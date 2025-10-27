import type { FastifyInstance } from 'fastify';
import OpenAI from 'openai';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { MCPManager } from '../mcp/manager.js';
import { config } from '../config.js';
import { loadSession } from '../storage/sessionStore.js';
import { processChatInteraction } from '../services/chatProcessor.js';
import type { ChatRequestPayload } from '../types/chat.js';
import { resolveEffectivePermissions, isModelAllowed } from '../rbac/index.js';
import { evaluateBudgetsForContext } from '../services/budgetEvaluator.js';

const ChatMessageSchema = z.object({
  role: z.enum(['system', 'user', 'assistant', 'tool']),
  content: z.string().optional().default(''),
  tool_call_id: z.string().optional(),
  name: z.string().optional(),
  timestamp: z.string().optional(),
  metadata: z
    .object({
      llmDurationMs: z.number().nonnegative().optional(),
    })
    .partial()
    .optional(),
});

const ChatRequestSchema = z.object({
  messages: z.array(ChatMessageSchema).min(1),
  maxIterations: z.number().int().positive().max(12).optional(),
  sessionId: z.string().min(1).optional(),
  model: z.string().optional(),
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

    const permissions = resolveEffectivePermissions(request.auth);

    const rawPayload = body.data as ChatRequestPayload & { maxIterations?: number; model?: string };
    const normalizedPayload: ChatRequestPayload & { maxIterations: number } = {
      ...rawPayload,
      maxIterations: rawPayload.maxIterations ?? config.chatMaxIterations,
    };
    const sessionId = normalizedPayload.sessionId ?? randomUUID();

    const selectedModel = rawPayload.model ?? config.llmModel;
    if (!config.llmAllowedModels.includes(selectedModel)) {
      request.log.warn({ selectedModel, allowedModels: config.llmAllowedModels }, 'Rejected chat request due to disallowed model');
      reply.status(400);
      return { error: `Model ${selectedModel} is not allowed` };
    }

    if (!isModelAllowed(selectedModel, permissions)) {
      request.log.warn({ selectedModel, roles: permissions.appliedRoles }, 'Rejected chat request due to RBAC model restriction');
      reply.status(403);
      return { error: `Model ${selectedModel} is not permitted for your role` };
    }

    const budgetContext = {
      accountId: request.auth?.accountId ?? null,
      userId: request.auth?.sub ?? null,
      roles: request.auth?.roles ?? [],
    };

    const initialBudgetEvaluation = await evaluateBudgetsForContext(budgetContext);

    if (initialBudgetEvaluation.hardLimitBreaches.length > 0) {
      request.log.warn({ budgets: initialBudgetEvaluation.hardLimitBreaches }, 'Rejected chat request due to budget hard limit');
      reply.status(403);
      return {
        error: 'Budget limit exceeded. Please review your plan or wait for the next reset.',
        budgets: initialBudgetEvaluation,
      };
    }

    if (initialBudgetEvaluation.softLimitBreaches.length > 0) {
      reply.header('x-budget-warning', 'soft-limit-exceeded');
    }

    const existingSession = await loadSession(sessionId);
    const result = await processChatInteraction({
      payload: normalizedPayload,
      sessionId,
      existingSession,
      mcpManager,
      openAi,
      model: selectedModel,
      permissions,
      authContext: request.auth,
      initialBudgetEvaluation,
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
        model: selectedModel,
        llmDurationMs: result.llmDurationMs,
        budgets: result.budgets,
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
      model: selectedModel,
      llmDurationMs: result.llmDurationMs,
      budgets: result.budgets,
    };
  });
}
