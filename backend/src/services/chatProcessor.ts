import type { ChatCompletionAssistantMessageParam, ChatCompletionMessageParam, ChatCompletionTool } from 'openai/resources/chat/completions';
import type { FunctionParameters } from 'openai/resources/shared';
import type OpenAI from 'openai';
import { MCPManager, type NamespacedToolDefinition } from '../mcp/manager.js';
import type { ChatRequestPayload, IncomingChatMessage, ToolCallResult, AssistantMessage } from '../types/chat.js';
import { saveSession } from '../storage/sessionStore.js';
import { getSessionTotals, recordUsage } from '../metrics/costTracker.js';
import type { SessionRecord, StoredChatMessage, StoredToolInvocation } from '../storage/sessionStore.js';

interface Logger {
  error: (obj: unknown, msg?: string) => void;
}

interface ProcessChatOptions {
  payload: ChatRequestPayload & { maxIterations: number };
  sessionId: string;
  existingSession: SessionRecord | null;
  mcpManager: MCPManager;
  openAi: OpenAI;
  model: string;
  logger: Logger;
}

export type ChatProcessOutcome =
  | {
      kind: 'success';
      sessionId: string;
      assistantMessage?: AssistantMessage;
      storedMessages: StoredChatMessage[];
      newToolResults: ToolCallResult[];
      combinedToolHistory: StoredToolInvocation[];
      usageSummary: ReturnType<typeof getSessionTotals>;
    }
  | {
      kind: 'incomplete';
      sessionId: string;
      error: string;
      storedMessages: StoredChatMessage[];
      newToolResults: ToolCallResult[];
      combinedToolHistory: StoredToolInvocation[];
      usageSummary: ReturnType<typeof getSessionTotals>;
    };

export async function processChatInteraction(options: ProcessChatOptions): Promise<ChatProcessOutcome> {
  const { payload, sessionId, existingSession, mcpManager, openAi, model, logger } = options;

  const tools = await mcpManager.listTools();
  const toolDefs = tools.map(toToolDefinition);
  const conversation = buildInitialConversation(payload.messages);
  const toolResults: ToolCallResult[] = [];

  for (let iteration = 0; iteration < payload.maxIterations; iteration += 1) {
    const response = await openAi.chat.completions.create({
      model,
      messages: conversation,
      tools: toolDefs,
      tool_choice: 'auto',
    });

    recordUsage(sessionId, response.usage);

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

      const { storedMessages, assistantRecord } = prepareStoredMessages(payload.messages, assistantContent);
      const combinedToolHistory = combineToolResults(existingSession?.toolResults ?? [], toolResults);
      await persistSession({
        existingSession,
        sessionId,
        messages: storedMessages,
        toolHistory: combinedToolHistory,
      });

      return {
        kind: 'success',
        sessionId,
        assistantMessage: assistantContent
          ? {
              role: 'assistant',
              content: assistantContent,
              timestamp: assistantRecord?.timestamp ?? new Date().toISOString(),
            }
          : undefined,
        storedMessages,
        newToolResults: toolResults,
        combinedToolHistory,
        usageSummary: getSessionTotals(sessionId),
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
        logger.error({ call }, 'Received tool call without name');
        continue;
      }

      const argsString = call.function?.arguments ?? '{}';
      let parsedArgs: unknown;
      try {
        parsedArgs = argsString ? JSON.parse(argsString) : {};
      } catch (error) {
        logger.error({ err: error, toolName }, 'Failed to parse tool arguments');
        parsedArgs = {};
      }

      try {
        const result = await mcpManager.callTool(toolName, parsedArgs);
        const record = createToolRecord(toolName, parsedArgs, result);
        toolResults.push(record);
        conversation.push({
          role: 'tool',
          content: JSON.stringify(result ?? null),
          tool_call_id: call.id,
        });
      } catch (error) {
        logger.error({ err: error, toolName }, 'Tool execution failed');
        const errorPayload = { error: (error as Error).message };
        const record = createToolRecord(toolName, parsedArgs, errorPayload);
        toolResults.push(record);
        conversation.push({
          role: 'tool',
          content: JSON.stringify(errorPayload),
          tool_call_id: call.id,
        });
      }
    }
  }

  const { storedMessages } = prepareStoredMessages(payload.messages, extractLastAssistant(conversation));
  const combinedToolHistory = combineToolResults(existingSession?.toolResults ?? [], toolResults);
  await persistSession({
    existingSession,
    sessionId,
    messages: storedMessages,
    toolHistory: combinedToolHistory,
  });

  return {
    kind: 'incomplete',
    sessionId,
    error: 'Unable to complete chat interaction within iteration limit',
    storedMessages,
    newToolResults: toolResults,
    combinedToolHistory,
    usageSummary: getSessionTotals(sessionId),
  };
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

function buildInitialConversation(messages: IncomingChatMessage[]): ChatCompletionMessageParam[] {
  const conversation: ChatCompletionMessageParam[] = [];
  for (const message of messages) {
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
  return conversation;
}

function createToolRecord(name: string, args: unknown, result: unknown): ToolCallResult {
  return {
    name,
    args,
    result,
    timestamp: new Date().toISOString(),
  };
}

function combineToolResults(existing: StoredToolInvocation[], latest: ToolCallResult[]): StoredToolInvocation[] {
  const normalizedExisting = existing.map((entry) => ({
    name: entry.name,
    args: entry.args,
    result: entry.result,
    timestamp: normalizeTimestamp(entry.timestamp),
  }));
  const mappedLatest = latest.map((entry) => ({
    name: entry.name,
    args: entry.args,
    result: entry.result,
    timestamp: normalizeTimestamp(entry.timestamp),
  }));
  return [...normalizedExisting, ...mappedLatest];
}

function extractLastAssistant(conversation: ChatCompletionMessageParam[]): string | null {
  for (let i = conversation.length - 1; i >= 0; i -= 1) {
    const message = conversation[i];
    if (message.role === 'assistant') {
      return contentToString(message.content);
    }
  }
  return null;
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

async function persistSession(options: {
  existingSession: SessionRecord | null;
  sessionId: string;
  messages: StoredChatMessage[];
  toolHistory: StoredToolInvocation[];
}): Promise<void> {
  const { existingSession, sessionId, messages, toolHistory } = options;
  const nowIso = new Date().toISOString();
  await saveSession({
    id: sessionId,
    messages,
    toolResults: toolHistory,
    createdAt: existingSession?.createdAt ?? nowIso,
    updatedAt: nowIso,
  });
}

function prepareStoredMessages(
  messages: IncomingChatMessage[],
  assistantContent: string | null,
): { storedMessages: StoredChatMessage[]; assistantRecord?: StoredChatMessage } {
  const storedMessages: StoredChatMessage[] = messages
    .filter((msg) => msg.role !== 'tool' && msg.role !== 'system')
    .map((msg) => ({
      role: msg.role,
      content: msg.content ?? '',
      timestamp: normalizeTimestamp(msg.timestamp),
    }));

  if (!assistantContent) {
    return { storedMessages };
  }

  const assistantRecord: StoredChatMessage = {
    role: 'assistant',
    content: assistantContent,
    timestamp: new Date().toISOString(),
  };

  storedMessages.push(assistantRecord);
  return { storedMessages, assistantRecord };
}

function normalizeTimestamp(input?: string): string {
  if (input) {
    const parsed = new Date(input);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString();
    }
  }
  return new Date().toISOString();
}
