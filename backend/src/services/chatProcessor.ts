import type { ChatCompletionAssistantMessageParam, ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import type OpenAI from 'openai';
import { MCPManager, type NamespacedToolDefinition } from '../mcp/manager.js';
import type {
  ChatRequestPayload,
  IncomingChatMessage,
  ToolCallResult,
  AssistantMessage,
  ChatMessageMetadata,
} from '../types/chat.js';
import { recordToolInvocation } from './toolInvocationLogger.js';
import { getSessionTotals, recordUsage } from '../metrics/costTracker.js';
import type { SessionRecord, StoredChatMessage, StoredToolInvocation } from '../storage/sessionStore.js';
import {
  filterToolsByPermissions,
  isToolAllowed,
  type EffectivePermissions,
} from '../rbac/index.js';
import { recordUsageEvent } from './usageService.js';
import type { AuthContext } from '../auth/context.js';
import { evaluateBudgetsForContext, type BudgetEvaluationResult } from './budgetEvaluator.js';
import { config } from '../config.js';
import { recordLlmTrace } from './llmTraceLogger.js';
import { recordLlmRequestMetric } from '../metrics/prometheus.js';
import { runWithBreaker } from '../utils/circuitBreaker.js';
import { retry } from '../utils/retry.js';
import { buildInitialConversation, contentToString, extractLastAssistant } from './chat/conversation.js';
import { combineToolResults, createToolRecord, persistSession, prepareStoredMessages } from './chat/persistence.js';
import { normalizeToolArgs, parseMcpError, stableStringify, toToolDefinition, tryParseJsonLoose } from './chat/tools.js';

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
  permissions: EffectivePermissions;
  authContext?: AuthContext;
  initialBudgetEvaluation: BudgetEvaluationResult;
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
      llmDurationMs: number;
      budgets: {
        before: BudgetEvaluationResult;
        after: BudgetEvaluationResult;
      };
    }
  | {
      kind: 'incomplete';
      sessionId: string;
      error: string;
      storedMessages: StoredChatMessage[];
      newToolResults: ToolCallResult[];
      combinedToolHistory: StoredToolInvocation[];
      usageSummary: ReturnType<typeof getSessionTotals>;
      llmDurationMs: number;
      budgets: {
        before: BudgetEvaluationResult;
        after: BudgetEvaluationResult;
      };
    };

export async function processChatInteraction(options: ProcessChatOptions): Promise<ChatProcessOutcome> {
  const {
    payload,
    sessionId,
    existingSession,
    mcpManager,
    openAi,
    model,
    permissions,
    authContext,
    initialBudgetEvaluation,
    logger,
  } = options;

  const sessionUserId = existingSession?.userId ?? authContext?.sub ?? null;
  const sessionAccountId = existingSession?.accountId ?? authContext?.accountId ?? null;

  const rawTools = await mcpManager.listTools();
  const allowedTools = filterToolsByPermissions(rawTools, permissions);
  const allowedToolMap = new Map<string, NamespacedToolDefinition>(
    allowedTools.map((tool) => [tool.name.toLowerCase(), tool]),
  );
  const toolDefs = allowedTools.map(toToolDefinition);
  const conversation = buildInitialConversation(payload.messages);
  const toolGuidance = [
    'Instrukcje dla narzędzi MCP:',
    '- Używaj narzędzi tylko gdy pomagają odpowiedzieć na pytanie.',
    '- Dobieraj argumenty tak, aby spełniały schemat JSON narzędzia.',
    '- Jeśli narzędzie zwróci błąd z polami error.hints, wykorzystaj te wskazówki do korekty argumentów i spróbuj ponownie maksymalnie raz dla tego zestawu parametrów.',
    '- Nie powtarzaj identycznych wywołań z tymi samymi argumentami.',
    '',
    'MCP tool guidance:',
    '- Use tools only when they help answer the question.',
    '- Choose arguments to satisfy the tool JSON schema.',
    '- If a tool returns an error payload with error.hints, use those hints to adjust arguments and retry at most once for that parameter set.',
    '- Do not repeat identical tool calls with the same arguments.',
  ].join('\n');
  conversation.unshift({ role: 'system', content: toolGuidance });
  const toolResults: ToolCallResult[] = [];
  const executedResults = new Map<string, any>();
  const executedRawArgs = new Map<string, unknown>();
  let totalLlmDurationMs = 0;
  let lastCompletionDurationMs: number | undefined;
  const POLISH_TZ = 'Europe/Warsaw';

  // helper moved to ./chat/tools

  for (let iteration = 0; iteration < payload.maxIterations; iteration += 1) {
    const iterationStart = process.hrtime.bigint();
    if (config.llmTraceEnabled) {
      try {
        recordLlmTrace({
          sessionId,
          route: 'chat',
          phase: 'request',
          model,
          iteration,
          payload: { messages: conversation, tools: toolDefs, tool_choice: 'auto' },
        });
      } catch {}
    }
    let response;
    try {
      response = await runWithBreaker('llm', () => retry(() => openAi.chat.completions.create({
        model,
        messages: conversation,
        tools: toolDefs,
        tool_choice: 'auto',
      }), {
        retries: 2,
        baseDelayMs: 200,
        maxDelayMs: 800,
        shouldRetry: (err) => {
          const anyErr: any = err ?? {};
          const status = Number(anyErr?.status ?? anyErr?.response?.status ?? anyErr?.httpStatus);
          const code = String(anyErr?.code ?? '').toUpperCase();
          if (Number.isFinite(status) && status >= 500) return true;
          if (code && ['ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN', 'ENETUNREACH', 'EHOSTUNREACH'].includes(code)) return true;
          const msg = String(anyErr?.message ?? '').toLowerCase();
          return msg.includes('socket hang up') || msg.includes('timeout') || msg.includes('network');
        },
      }));
      try { recordLlmRequestMetric({ model, status: 'ok' }); } catch {}
    } catch (err) {
      try { recordLlmRequestMetric({ model, status: 'error' }); } catch {}
      throw err;
    }
    const iterationDurationMs = Number((process.hrtime.bigint() - iterationStart) / BigInt(1_000_000));
    if (Number.isFinite(iterationDurationMs) && iterationDurationMs >= 0) {
      totalLlmDurationMs += iterationDurationMs;
      lastCompletionDurationMs = iterationDurationMs;
    }

    const usageRecord = recordUsage(sessionId, response.usage, model);
    if (config.llmTraceEnabled) {
      try {
        const choice = (response.choices && response.choices[0]) as any;
        const delta = choice?.message ?? {};
        const payload = {
          content: typeof delta?.content === 'string' ? delta.content : delta?.content ?? null,
          tool_calls: delta?.tool_calls ?? null,
          finish_reason: choice?.finish_reason ?? null,
          usage: response.usage ?? null,
        };
        recordLlmTrace({
          sessionId,
          route: 'chat',
          phase: 'response',
          model,
          iteration,
          status: choice?.finish_reason ?? undefined,
          meta: { lastCompletionDurationMs },
          payload,
        });
      } catch {}
    }
    if (usageRecord) {
      try {
        recordUsageEvent({
          sessionId,
          accountId: authContext?.accountId ?? null,
          userId: authContext?.sub ?? null,
          roles: authContext?.roles,
          model,
          promptTokens: usageRecord.promptTokens,
          cachedPromptTokens: usageRecord.cachedPromptTokens,
          completionTokens: usageRecord.completionTokens,
          totalTokens: usageRecord.totalTokens,
          costUsd: usageRecord.costUsd,
          occurredAt: usageRecord.timestamp,
        });
      } catch (error) {
        logger.error({ err: error }, 'Failed to persist usage event');
      }
    }

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

      const assistantMetadata = lastCompletionDurationMs !== undefined ? { llmDurationMs: lastCompletionDurationMs } : undefined;
      const { storedMessages, assistantRecord } = prepareStoredMessages(payload.messages, assistantContent, assistantMetadata);
      const combinedToolHistory = combineToolResults(existingSession?.toolResults ?? [], toolResults);
      await persistSession({
        existingSession,
        sessionId,
        messages: storedMessages,
        toolHistory: combinedToolHistory,
        userId: sessionUserId,
        accountId: sessionAccountId,
      });

      const updatedBudgets = await evaluateBudgetsForContext({
        accountId: authContext?.accountId,
        userId: authContext?.sub,
        roles: authContext?.roles,
      });

      return {
        kind: 'success',
        sessionId,
        assistantMessage: assistantContent
          ? {
              role: 'assistant',
              content: assistantContent,
              timestamp: assistantRecord?.timestamp ?? new Date().toISOString(),
              metadata: assistantRecord?.metadata,
            }
          : undefined,
        storedMessages,
        newToolResults: toolResults,
        combinedToolHistory,
        usageSummary: getSessionTotals(sessionId),
        llmDurationMs: totalLlmDurationMs,
        budgets: {
          before: initialBudgetEvaluation,
          after: updatedBudgets,
        },
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
        // Fallback to a loose JSON parse to handle streamed/inexact JSON
        try {
          const loose = tryParseJsonLoose(argsString);
          parsedArgs = loose ?? {};
        } catch (e2) {
          logger.error({ err: error, toolName }, 'Failed to parse tool arguments');
          parsedArgs = {};
        }
      }

      const normalizedToolName = toolName.toLowerCase();
      // Optional defaults for employee_employee_employees_costs (only when inference is enabled)
      if (config.chatInferArgsEnabled) {
        if (normalizedToolName.includes('employee_employee_employees_costs')) {
          const POLISH_TZ = 'Europe/Warsaw';
          const todayInTz = (() => {
            const fmt = new Intl.DateTimeFormat('en-CA', {
              timeZone: POLISH_TZ,
              year: 'numeric',
              month: '2-digit',
              day: '2-digit',
            });
            const parts = Object.fromEntries(fmt.formatToParts(new Date()).map((p) => [p.type, p.value])) as any;
            return `${parts.year}-${parts.month}-${parts.day}`;
          })();
          const obj = (parsedArgs && typeof parsedArgs === 'object') ? (parsedArgs as any) : {};
          if (!obj.from) obj.from = todayInTz;
          if (!obj.to) obj.to = todayInTz;
          if (!obj.tz) obj.tz = POLISH_TZ;
          if (!obj.environment) obj.environment = 'prod';
          parsedArgs = obj;
        }
      }
      const toolDefinition = allowedToolMap.get(normalizedToolName);
      if (!toolDefinition || !isToolAllowed(toolName, toolDefinition.serverId, permissions)) {
        const errorPayload = {
          error: `Tool ${toolName} is not permitted for your role`,
          code: 'tool_not_permitted',
        };
        toolResults.push(createToolRecord(toolName, parsedArgs, errorPayload, argsString));
        conversation.push({
          role: 'tool',
          content: JSON.stringify(errorPayload),
          tool_call_id: call.id,
        });
        continue;
      }

      // De-duplication within this interaction: avoid repeated identical tool+args
      const signature = `${toolName}|${stableStringify(parsedArgs)}`;
      const cached = executedResults.get(signature);
      if (cached !== undefined) {
        const record = createToolRecord(toolName, parsedArgs, cached, executedRawArgs.get(signature));
        toolResults.push(record);
        conversation.push({
          role: 'tool',
          content: JSON.stringify(cached),
          tool_call_id: call.id,
        });
        continue;
      }

      try {
        // Apply basic argument normalization/inference
        parsedArgs = normalizeToolArgs(toolName, parsedArgs);
        const breakerKey = toolDefinition ? `mcp:${toolDefinition.serverId}` : 'mcp';
        const result = await runWithBreaker(breakerKey, () => retry(() => mcpManager.callTool(toolName, parsedArgs), {
          retries: 1,
          baseDelayMs: 200,
          maxDelayMs: 600,
          shouldRetry: (err) => {
            const anyErr: any = err ?? {};
            const code = String(anyErr?.code ?? '').toUpperCase();
            if (code && ['ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN', 'ENETUNREACH', 'EHOSTUNREACH'].includes(code)) return true;
            const msg = String(anyErr?.message ?? '').toLowerCase();
            return msg.includes('socket hang up') || msg.includes('timeout') || msg.includes('network');
          },
        }));
        const record = createToolRecord(toolName, parsedArgs, result, argsString);
        toolResults.push(record);
        conversation.push({
          role: 'tool',
          content: JSON.stringify(result ?? null),
          tool_call_id: call.id,
        });
        executedResults.set(signature, result ?? null);
        try { executedRawArgs.set(signature, argsString); } catch {}
        try { recordToolInvocation({ sessionId, toolName, args: parsedArgs, result }); } catch {}
      } catch (error) {
        logger.error({ err: error, toolName }, 'Tool execution failed');
        const structured = parseMcpError((error as Error).message);
        const errorPayload = structured ?? { error: { message: (error as Error).message } };
        const record = createToolRecord(toolName, parsedArgs, errorPayload, argsString);
        toolResults.push(record);
        conversation.push({
          role: 'tool',
          content: JSON.stringify(errorPayload),
          tool_call_id: call.id,
        });
        try { executedResults.set(signature, errorPayload ?? null); } catch {}
        try { executedRawArgs.set(signature, argsString); } catch {}
        try { recordToolInvocation({ sessionId, toolName, args: parsedArgs, result: null, error: (error as Error).message }); } catch {}
      }
    }
  }

  const assistantMetadata = lastCompletionDurationMs !== undefined ? { llmDurationMs: lastCompletionDurationMs } : undefined;
  let finalAssistant = extractLastAssistant(conversation);
  if (!finalAssistant || finalAssistant.trim().length === 0) {
    // Build a concise fallback assistant message from tool errors/hints
    const errorSummaries: string[] = [];
    for (let i = toolResults.length - 1; i >= 0 && errorSummaries.length < 3; i -= 1) {
      const tr = toolResults[i];
      const res: any = tr?.result;
      const err = res?.error || res?.message || null;
      if (err) {
        const code = typeof err?.code === 'string' ? ` (${err.code})` : '';
        const msg = typeof err?.message === 'string' ? err.message : (typeof res?.error === 'string' ? res.error : 'Nieznany błąd');
        errorSummaries.push(`- ${tr.name}${code}: ${msg}`);
      }
    }
    const hintLines: string[] = [];
    // Try to surface the first available hints
    const firstHint = toolResults.find((tr) => {
      const result: any = tr?.result;
      return result?.error?.hints && Array.isArray(result.error.hints);
    });
    if (firstHint) {
      const hints = ((firstHint.result as any).error.hints ?? []) as string[];
      for (const h of hints.slice(0, 3)) hintLines.push(`• ${h}`);
    }
    const tail = [
      errorSummaries.length ? `Napotkałem błąd(y) narzędzi:
${errorSummaries.join('\n')}` : 'Narzędzia nie zwróciły danych, więc nie mogę dokończyć odpowiedzi.',
      hintLines.length ? `Sugestie z narzędzia:
${hintLines.join('\n')}` : undefined,
      'Możemy kontynuować mimo to: podaj brakujące parametry (np. data YYYY-MM-DD, lokalizacja), albo napisz „pomiń narzędzia”, a odpowiem szacunkowo bez wywołań.',
    ].filter(Boolean).join('\n\n');
    finalAssistant = tail;
  }
  const { storedMessages } = prepareStoredMessages(
    payload.messages,
    finalAssistant,
    assistantMetadata,
  );
  const combinedToolHistory = combineToolResults(existingSession?.toolResults ?? [], toolResults);
        await persistSession({
          existingSession,
          sessionId,
          messages: storedMessages,
          toolHistory: combinedToolHistory,
          userId: sessionUserId,
          accountId: sessionAccountId,
        });

  const updatedBudgets = await evaluateBudgetsForContext({
    accountId: authContext?.accountId,
    userId: authContext?.sub,
    roles: authContext?.roles,
  });

  return {
    kind: 'success',
    sessionId,
    assistantMessage: finalAssistant
      ? {
          role: 'assistant',
          content: finalAssistant,
          timestamp: new Date().toISOString(),
          metadata: assistantMetadata,
        }
      : undefined,
    storedMessages,
    newToolResults: toolResults,
    combinedToolHistory,
    usageSummary: getSessionTotals(sessionId),
    llmDurationMs: totalLlmDurationMs,
    budgets: {
      before: initialBudgetEvaluation,
      after: updatedBudgets,
    },
  };
}

// helper implementations moved to ./chat/* modules
