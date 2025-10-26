import type { FastifyInstance } from 'fastify';
import OpenAI from 'openai';
import { randomUUID } from 'node:crypto';
import type {
  ChatCompletionAssistantMessageParam,
  ChatCompletionMessageParam,
  ChatCompletionTool,
} from 'openai/resources/chat/completions';
import type { FunctionParameters } from 'openai/resources/shared';
import { z } from 'zod';
import { MCPManager, NamespacedToolDefinition } from '../mcp/manager.js';
import { config } from '../config.js';
import { loadSession, saveSession } from '../storage/sessionStore.js';

const ChatMessageSchema = z.object({
  role: z.enum(['system', 'user', 'assistant', 'tool']),
  content: z.string().optional().default(''),
  tool_call_id: z.string().optional(),
  name: z.string().optional(),
});

const ChatRequestSchema = z.object({
  messages: z.array(ChatMessageSchema).min(1),
  maxIterations: z.number().int().positive().max(8).optional().default(4),
  sessionId: z.string().min(1).optional(),
});

type ChatRequest = z.infer<typeof ChatRequestSchema>;

interface RegisterChatRoutesOptions {
  mcpManager: MCPManager;
  openAi: OpenAI;
}

function sanitizeParameters(parameters: unknown): FunctionParameters {
  if (parameters && typeof parameters === 'object') {
    return parameters as FunctionParameters;
  }
  return { type: 'object', properties: {} } as FunctionParameters;
}

function toToolDefinition(tool: NamespacedToolDefinition): ChatCompletionTool {
  return {
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description ?? undefined,
      parameters: sanitizeParameters(tool.parameters),
    },
  };
}

function contentToString(content: unknown): string {
  if (typeof content === 'string') {
    return content;
  }
  if (!content) {
    return '';
  }
  if (Array.isArray(content)) {
    const text = content
      .map((part) => {
        if (typeof part === 'string') {
          return part;
        }
        if (part && typeof part === 'object') {
          const candidate = part as { type?: string; text?: string; content?: unknown };
          if (candidate.text) {
            return candidate.text;
          }
        }
        return '';
      })
      .filter(Boolean)
      .join('\n');
    if (text) {
      return text;
    }
    try {
      return JSON.stringify(content);
    } catch (error) {
      return '';
    }
  }
  try {
    return JSON.stringify(content);
  } catch (error) {
    return '';
  }
}

export async function registerChatRoutes(app: FastifyInstance<any>, options: RegisterChatRoutesOptions) {
  const { mcpManager, openAi } = options;

  app.post('/chat', async (request, reply) => {
    const body = ChatRequestSchema.safeParse(request.body);
    if (!body.success) {
      reply.status(400);
      return { error: 'Invalid request', details: body.error.issues };
    }

    const payload: ChatRequest = body.data;
    const sessionId = payload.sessionId ?? randomUUID();
    const existingSession = await loadSession(sessionId);
    const tools = await mcpManager.listTools();
    const toolDefs = tools.map(toToolDefinition);
    const conversation: ChatCompletionMessageParam[] = [];
    for (const message of payload.messages) {
      if (message.role === 'tool') {
        continue;
      }
      if (message.role === 'assistant') {
        conversation.push({
          role: 'assistant',
          content: message.content ?? '',
        });
      } else {
        conversation.push({
          role: message.role,
          content: message.content ?? '',
        } as ChatCompletionMessageParam);
      }
    }

    const toolResults: Array<{
      name: string;
      args: unknown;
      result: unknown;
      timestamp: string;
    }> = [];

    for (let iteration = 0; iteration < (payload.maxIterations ?? 4); iteration += 1) {
      const response = await openAi.chat.completions.create({
        model: config.llmModel,
        messages: conversation,
        tools: toolDefs,
        tool_choice: 'auto',
      });

      const choice = response.choices[0];
      const assistantMessage = choice?.message;

      if (!assistantMessage) {
        break;
      }

      if (!assistantMessage.tool_calls || assistantMessage.tool_calls.length === 0) {
        const assistantContent = contentToString(assistantMessage.content);
        conversation.push({
          role: 'assistant',
          content: assistantContent,
        });

        const storedMessages = payload.messages
          .filter((msg) => msg.role !== 'tool')
          .map((msg) => ({ role: msg.role, content: msg.content ?? '' }));
        if (assistantContent) {
          storedMessages.push({ role: 'assistant', content: assistantContent });
        }

        const combinedToolResults = [
          ...(existingSession?.toolResults ?? []),
          ...toolResults,
        ];
        const nowIso = new Date().toISOString();
        await saveSession({
          id: sessionId,
          messages: storedMessages,
          toolResults: combinedToolResults,
          createdAt: existingSession?.createdAt ?? nowIso,
          updatedAt: nowIso,
        });

        return {
          sessionId,
          message: {
            role: 'assistant',
            content: assistantMessage.content ?? '',
          },
          toolResults,
          messages: storedMessages,
          toolHistory: combinedToolResults,
        };
      }

      const assistantWithTools: ChatCompletionAssistantMessageParam = {
        role: 'assistant',
        content: assistantMessage.content ?? '',
        tool_calls: assistantMessage.tool_calls?.map((call) => ({
          id: call.id,
          type: 'function',
          function: {
            name: call.function?.name ?? '',
            arguments: call.function?.arguments ?? '{}',
          },
        })),
      };
      conversation.push(assistantWithTools);

      for (const call of assistantMessage.tool_calls) {
        const toolName = call.function?.name;
        if (!toolName) {
          request.log.error({ call }, 'Received tool call without name');
          continue;
        }
        const argsString = call.function?.arguments ?? '{}';
        let parsedArgs: unknown;

        try {
          parsedArgs = argsString ? JSON.parse(argsString) : {};
        } catch (error) {
          request.log.error({ err: error, toolName }, 'Failed to parse tool arguments');
          parsedArgs = {};
        }

        try {
          const result = await mcpManager.callTool(toolName, parsedArgs);
          toolResults.push({
            name: toolName,
            args: parsedArgs,
            result,
            timestamp: new Date().toISOString(),
          });
          conversation.push({
            role: 'tool',
            content: JSON.stringify(result ?? null),
            tool_call_id: call.id,
          });
        } catch (error) {
          request.log.error({ err: error, toolName }, 'Tool execution failed');
          const errorPayload = { error: (error as Error).message };
          toolResults.push({
            name: toolName,
            args: parsedArgs,
            result: errorPayload,
            timestamp: new Date().toISOString(),
          });
          conversation.push({
            role: 'tool',
            content: JSON.stringify(errorPayload),
            tool_call_id: call.id,
          });
        }
      }
    }

    const storedMessages = payload.messages
      .filter((msg) => msg.role !== 'tool')
      .map((msg) => ({ role: msg.role, content: msg.content ?? '' }));
    const lastAssistant = conversation[conversation.length - 1];
    if (lastAssistant?.role === 'assistant') {
      const content = contentToString(lastAssistant.content);
      if (content) {
        storedMessages.push({ role: 'assistant', content });
      }
    }

    const combinedToolResults = [...(existingSession?.toolResults ?? []), ...toolResults];
    const nowIso = new Date().toISOString();
    await saveSession({
      id: sessionId,
      messages: storedMessages,
      toolResults: combinedToolResults,
      createdAt: existingSession?.createdAt ?? nowIso,
      updatedAt: nowIso,
    });

    reply.status(422);
    return {
      sessionId,
      error: 'Unable to complete chat interaction within iteration limit',
      toolResults,
      messages: storedMessages,
      toolHistory: combinedToolResults,
    };
  });
}
