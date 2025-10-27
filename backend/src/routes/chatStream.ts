import type { FastifyInstance } from 'fastify';
import type OpenAI from 'openai';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { MCPManager, type NamespacedToolDefinition } from '../mcp/manager.js';
import { config } from '../config.js';
import { evaluateBudgetsForContext } from '../services/budgetEvaluator.js';
import { filterToolsByPermissions, isModelAllowed, resolveEffectivePermissions } from '../rbac/index.js';
import type { ChatRequestPayload } from '../types/chat.js';
import { saveSession } from '../storage/sessionStore.js';

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

type StreamEvent =
  | { type: 'assistant.delta'; text: string }
  | { type: 'assistant.done'; content: string; llmDurationMs?: number }
  | { type: 'tool.started'; id: string; name: string; args: unknown }
  | { type: 'tool.completed'; id: string; name: string; result: unknown }
  | { type: 'usage'; promptTokens?: number; completionTokens?: number; totalTokens?: number; costUsd?: number }
  | { type: 'budget.warning'; details?: unknown }
  | { type: 'budget.blocked'; details?: unknown }
  | { type: 'final'; sessionId: string; messages: any[]; toolHistory: any[] }
  | { type: 'error'; message: string };

function writeNdjson(reply: any, event: StreamEvent) {
  try {
    reply.raw.write(JSON.stringify(event) + '\n');
    // @ts-ignore
    reply.raw.flush?.();
  } catch (err) {
    // ignore write errors (client likely disconnected)
  }
}

function contentToString(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!content) return '';
  try {
    return JSON.stringify(content);
  } catch {
    return '';
  }
}

function buildInitialConversation(messages: any[]): any[] {
  const conversation: any[] = [];
  for (const message of messages) {
    if (message.role === 'tool') continue;
    if (message.role === 'assistant') {
      conversation.push({ role: 'assistant', content: message.content ?? '' });
    } else {
      conversation.push({ role: message.role, content: message.content ?? '' });
    }
  }
  return conversation;
}

function toToolDefinition(tool: NamespacedToolDefinition) {
  return {
    type: 'function' as const,
    function: {
      name: tool.name,
      description: tool.description ?? undefined,
      parameters: (tool.parameters && typeof tool.parameters === 'object')
        ? (tool.parameters as any)
        : { type: 'object', properties: {} },
    },
  };
}

export async function registerChatStreamRoutes(app: FastifyInstance<any>, options: { mcpManager: MCPManager; openAi: OpenAI }) {
  const { mcpManager, openAi } = options;

  app.post('/chat/stream', async (request, reply) => {
    const parsed = ChatRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      reply.status(400);
      return { error: 'Invalid request', details: parsed.error.issues };
    }

    const payload = parsed.data as ChatRequestPayload & { maxIterations?: number; model?: string };
    const sessionId = payload.sessionId ?? randomUUID();
    const maxIterations = payload.maxIterations ?? config.chatMaxIterations;
    const model = payload.model ?? config.llmModel;

    const permissions = resolveEffectivePermissions((request as any).auth);
    if (!config.llmAllowedModels.includes(model)) {
      reply.status(400);
      return { error: `Model ${model} is not allowed` };
    }
    if (!isModelAllowed(model, permissions)) {
      reply.status(403);
      return { error: `Model ${model} is not permitted for your role` };
    }

    const budgetBefore = await evaluateBudgetsForContext({
      accountId: (request as any).auth?.accountId ?? null,
      userId: (request as any).auth?.sub ?? null,
      roles: (request as any).auth?.roles ?? [],
    });

    if (budgetBefore.hardLimitBreaches.length > 0) {
      reply.header('x-budget-warning', 'hard-limit-exceeded');
      reply.code(200);
      reply.header('Content-Type', 'application/x-ndjson');
      writeNdjson(reply, { type: 'budget.blocked', details: budgetBefore });
      writeNdjson(reply, { type: 'error', message: 'Budget limit exceeded' });
      return reply.send();
    }
    if (budgetBefore.softLimitBreaches.length > 0) {
      reply.header('x-budget-warning', 'soft-limit-exceeded');
    }

    const rawTools = await mcpManager.listTools();
    const allowedTools = filterToolsByPermissions(rawTools, permissions);
    const toolDefs = allowedTools.map(toToolDefinition);
    const allowedToolMap = new Map<string, NamespacedToolDefinition>(
      allowedTools.map((t) => [t.name.toLowerCase(), t]),
    );

    reply.code(200);
    reply.header('Content-Type', 'application/x-ndjson');
    // CORS headers (manual, because we stream and bypass onSend hooks)
    const reqOrigin = (request.headers as any)?.origin as string | undefined;
    reply.header('Access-Control-Allow-Origin', reqOrigin || '*');
    reply.header('Vary', 'Origin');
    reply.header('Access-Control-Expose-Headers', 'x-budget-warning');
    reply.header('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    reply.header('Access-Control-Allow-Methods', 'POST, OPTIONS');
    // Flush headers so the client starts reading
    // @ts-ignore
    reply.raw.flushHeaders?.();

    // keep-alive ping
    const pingInterval = setInterval(() => {
      if (reply.raw.writableEnded) {
        clearInterval(pingInterval);
        return;
      }
      writeNdjson(reply, { type: 'assistant.delta', text: '' });
    }, 20000);

    const conversation = buildInitialConversation(payload.messages);
    const toolHistory: any[] = [];
    let aborted = false;
    request.raw.on('close', () => { aborted = true; });

    try {
      for (let iter = 0; iter < maxIterations; iter += 1) {
        if (aborted) break;

        const start = process.hrtime.bigint();
        const stream = await openAi.chat.completions.create({
          model,
          messages: conversation as any,
          tools: toolDefs as any,
          tool_choice: 'auto',
          stream: true,
        } as any);

        let assistantBuffer = '';
        let toolCallsBuffer: Array<{ id: string; name: string; arguments: string }> = [];
        let finishReason: string | null = null;

        for await (const part of stream as any) {
          if (aborted) break;
          const choice = part?.choices?.[0];
          const delta = choice?.delta ?? {};
          const textDelta = delta?.content ?? '';
          if (textDelta) {
            assistantBuffer += textDelta;
            writeNdjson(reply, { type: 'assistant.delta', text: textDelta });
          }
          const toolDelta = delta?.tool_calls;
          if (Array.isArray(toolDelta) && toolDelta.length > 0) {
            for (const td of toolDelta) {
              const id = td?.id ?? '';
              const name = td?.function?.name ?? '';
              const args = td?.function?.arguments ?? '';
              if (!id && !name && !args) continue;
              const existing = toolCallsBuffer.find((t) => t.id === id) ?? { id, name, arguments: '' };
              if (!toolCallsBuffer.includes(existing)) toolCallsBuffer.push(existing);
              if (name) existing.name = name;
              if (args) existing.arguments += args;
            }
          }
          if (choice?.finish_reason) {
            finishReason = choice.finish_reason;
          }
        }

        const durationMs = Number((process.hrtime.bigint() - start) / BigInt(1_000_000));
        if (assistantBuffer) {
          writeNdjson(reply, { type: 'assistant.done', content: assistantBuffer, llmDurationMs: durationMs });
          conversation.push({ role: 'assistant', content: assistantBuffer });
          // checkpoint: persist messages so far (tool history appended later)
          try {
            await saveSession({
              id: sessionId,
              messages: payload.messages
                .filter((m) => m.role !== 'system' && m.role !== 'tool')
                .map((m) => ({ role: m.role, content: m.content ?? '', timestamp: m.timestamp ?? new Date().toISOString() })),
              toolResults: toolHistory,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            });
          } catch {}
        }

        if (aborted) break;

        if (finishReason === 'tool_calls' && toolCallsBuffer.length > 0) {
          // Execute tools sequentially
          for (const call of toolCallsBuffer) {
            if (aborted) break;
            const toolName = call.name;
            let parsedArgs: unknown = {};
            try {
              parsedArgs = call.arguments ? JSON.parse(call.arguments) : {};
            } catch {
              parsedArgs = {};
            }
            const def = toolName ? allowedToolMap.get(toolName.toLowerCase()) : undefined;
            if (!def) {
              writeNdjson(reply, { type: 'tool.started', id: call.id, name: toolName || 'unknown', args: parsedArgs });
              const result = { error: `Tool ${toolName || 'unknown'} is not permitted for your role` };
              writeNdjson(reply, { type: 'tool.completed', id: call.id, name: toolName || 'unknown', result });
              conversation.push({ role: 'tool', content: JSON.stringify(result), tool_call_id: call.id });
              toolHistory.push({ name: toolName || 'unknown', args: parsedArgs, result, timestamp: new Date().toISOString() });
              continue;
            }

            writeNdjson(reply, { type: 'tool.started', id: call.id, name: toolName, args: parsedArgs });
            try {
              const result = await mcpManager.callTool(toolName, parsedArgs);
              writeNdjson(reply, { type: 'tool.completed', id: call.id, name: toolName, result });
              conversation.push({ role: 'tool', content: JSON.stringify(result ?? null), tool_call_id: call.id });
              toolHistory.push({ name: toolName, args: parsedArgs, result, timestamp: new Date().toISOString() });
              // checkpoint: persist after each tool
              try {
                await saveSession({
                  id: sessionId,
                  messages: payload.messages
                    .filter((m) => m.role !== 'system' && m.role !== 'tool')
                    .map((m) => ({ role: m.role, content: m.content ?? '', timestamp: m.timestamp ?? new Date().toISOString() })),
                  toolResults: toolHistory,
                  createdAt: new Date().toISOString(),
                  updatedAt: new Date().toISOString(),
                });
              } catch {}
            } catch (error) {
              const errPayload = { error: (error as Error).message };
              writeNdjson(reply, { type: 'tool.completed', id: call.id, name: toolName, result: errPayload });
              conversation.push({ role: 'tool', content: JSON.stringify(errPayload), tool_call_id: call.id });
              toolHistory.push({ name: toolName, args: parsedArgs, result: errPayload, timestamp: new Date().toISOString() });
              try {
                await saveSession({
                  id: sessionId,
                  messages: payload.messages
                    .filter((m) => m.role !== 'system' && m.role !== 'tool')
                    .map((m) => ({ role: m.role, content: m.content ?? '', timestamp: m.timestamp ?? new Date().toISOString() })),
                  toolResults: toolHistory,
                  createdAt: new Date().toISOString(),
                  updatedAt: new Date().toISOString(),
                });
              } catch {}
            }
          }
          // Continue loop for next iteration
          continue;
        }

        // No tool calls; finish
        break;
      }

      if (!aborted) {
        await saveSession({
          id: sessionId,
          messages: (payload.messages as any[]).filter((m) => m.role !== 'system' && m.role !== 'tool').map((m) => ({
            role: m.role,
            content: m.content ?? '',
            timestamp: m.timestamp ?? new Date().toISOString(),
          })),
          toolResults: toolHistory,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
        writeNdjson(reply, { type: 'final', sessionId, messages: payload.messages, toolHistory });
      }
    } catch (error) {
      writeNdjson(reply, { type: 'error', message: (error as Error).message });
    } finally {
      try { clearInterval(pingInterval); } catch {}
      try {
        reply.raw.end();
      } catch {}
    }
  });
}
