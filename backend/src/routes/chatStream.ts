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

  const POLISH_TZ = 'Europe/Warsaw';

  function toYyyyMmDd(date: Date): string {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  function partsInZone(date: Date, tz: string) {
    const fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    });
    const parts = Object.fromEntries(fmt.formatToParts(date).map((p) => [p.type, p.value]));
    return parts as any;
  }

  function todayYmdInZone(tz: string): string {
    const parts = partsInZone(new Date(), tz);
    return `${parts.year}-${parts.month}-${parts.day}`;
  }

  function normalizeToolArgs(toolName: string, args: any): any {
    const name = (toolName || '').toLowerCase();
    const next = { ...(args ?? {}) } as Record<string, any>;

    if (name.startsWith('posbistro_')) {
      // Default location to the Garden Bistro alias when missing
      if (!next.location || String(next.location).trim().length === 0) {
        next.location = 'gardenbistro';
      }

      // Provide date defaults where required
      // Do not default from/to here; leave inference/fallback to later so
      // month/explicit ranges in user question can override correctly.
      // For today endpoints ensure offset/tz defaults are sane (optional)
      if (name.includes('normalized_item_sales_today') || name.includes('item_sales_today')) {
        if (next.offset_minutes === undefined) next.offset_minutes = 0;
      }
    }

    return next;
  }

  function extractTextContent(result: any): string | null {
    const content = (result && (result.content || result.data || result.body)) as any;
    if (Array.isArray(content)) {
      const firstText = content.find((c) => c && c.type === 'text' && typeof c.text === 'string');
      if (firstText) return firstText.text as string;
    }
    if (typeof result?.text === 'string') return result.text;
    if (typeof result === 'string') return result;
    return null;
  }

  function tryParseJsonLoose(text: string): any | null {
    if (!text || typeof text !== 'string') return null;
    try {
      return JSON.parse(text);
    } catch {}
    try {
      // Naive single-quote to double-quote replacement; best-effort for MCP text payloads
      const fixed = text.replace(/'/g, '"');
      return JSON.parse(fixed);
    } catch {}
    return null;
  }

  function normalizePosbistroResult(toolName: string, args: any, result: any): any | null {
    const name = (toolName || '').toLowerCase();
    const text = extractTextContent(result);
    const parsed = text ? tryParseJsonLoose(text) : null;

    if (!parsed) return null;

    if (name.includes('normalized_item_sales_daily_totals')) {
      const days = Array.isArray(parsed?.days) ? parsed.days : [];
      const totalGross = days.reduce((sum: number, d: any) => sum + (Number(d?.gross) || 0), 0);
      const totalNet = days.reduce((sum: number, d: any) => sum + (Number(d?.net) || 0), 0);
      return {
        type: 'posbistro.normalized_item_sales_daily_totals',
        location: args?.location ?? parsed?.location ?? null,
        from: args?.from ?? parsed?.from ?? null,
        to: args?.to ?? parsed?.to ?? null,
        offset_minutes: parsed?.offset_minutes ?? null,
        totalGross,
        totalNet,
        days,
      };
    }

    if (name.includes('item_sales_today')) {
      // Find summary row with data_type == 'summary'
      const rawItems = Array.isArray(parsed?.items) ? parsed.items : Array.isArray(parsed) ? parsed : [];
      const summary = rawItems.find((x: any) => (x?.data_type || x?.type) === 'summary') || null;
      const entries = rawItems.filter((x: any) => (x?.data_type || x?.type) !== 'summary');
      const gross = summary ? Number(summary.gross_expenditures_total || summary.gross || 0) : null;
      const net = summary ? Number(summary.net_expenditures_total || summary.net || 0) : null;
      const baseType = 'posbistro.item_sales_today';
      return {
        type: `${baseType}.summary`,
        tool: baseType,
        location: args?.location ?? null,
        gross,
        net,
        summary,
        entries,
        items: rawItems,
      };
    }

    if (name.includes('item_sales_range')) {
      const rawItems = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.items) ? parsed.items : [];
      const summary = rawItems.find((x: any) => (x?.data_type || x?.type) === 'summary') || null;
      const entries = rawItems.filter((x: any) => (x?.data_type || x?.type) !== 'summary');
      const gross = summary ? Number(summary.gross_expenditures_total || summary.gross || 0) : null;
      const net = summary ? Number(summary.net_expenditures_total || summary.net || 0) : null;
      const baseType = 'posbistro.item_sales_range';
      return {
        type: `${baseType}.summary`,
        tool: baseType,
        location: args?.location ?? null,
        from: args?.from ?? null,
        to: args?.to ?? null,
        gross,
        net,
        summary,
        entries,
        items: rawItems,
      };
    }

    return null;
  }

  function firstDayOfMonthInZone(date: Date, tz: string): string {
    const p = partsInZone(date, tz);
    return `${p.year}-${p.month}-01`;
  }

  function lastDayOfMonthInZone(date: Date, tz: string): string {
    const p = partsInZone(date, tz);
    const y = Number(p.year);
    const m = Number(p.month);
    const d = new Date(y, m, 0).getDate();
    return `${p.year}-${p.month}-${String(d).padStart(2, '0')}`;
  }

  function parseTimeframeFromMessages(messages: any[]): { from?: string; to?: string; period?: string } {
    const lastUser = [...messages].reverse().find((m) => m && m.role === 'user' && typeof m.content === 'string');
    const text = (lastUser?.content ?? '').toString().toLowerCase();
    const now = new Date();
    const today = todayYmdInZone(POLISH_TZ);

    // Explicit YYYY-MM-DD range like "od 2025-10-01 do 2025-10-31"
    const m = text.match(/(\d{4}-\d{2}-\d{2}).{0,10}(\d{4}-\d{2}-\d{2})/);
    if (m) {
      const from = m[1];
      const to = m[2];
      return { from, to, period: 'explicit' };
    }

    // This month (broad match incl. declensions/typos)
    if (/(w\s+tym\s+miesi[aą]cu|ten\s+miesi[aą]c|ca(ł|l)\w*\s+miesi[aą]c\w*|za\s+ca(ł|l)\w*\s+miesi[aą]c\w*|this\s+month)/.test(text)) {
      const from = firstDayOfMonthInZone(now, POLISH_TZ);
      return { from, to: today, period: 'this_month' };
    }

    // Last month (broad match)
    if (/(w\s+poprzednim\s+miesi[aą]cu|zesz(łym|lym)\s+miesi[aą]cu|ostatni\s+miesi[aą]c|last\s+month)/.test(text)) {
      const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const from = firstDayOfMonthInZone(prev, POLISH_TZ);
      const to = lastDayOfMonthInZone(prev, POLISH_TZ);
      return { from, to, period: 'last_month' };
    }

    // Yesterday
    if (/(wczoraj|yesterday)/.test(text)) {
      const y = new Date(now);
      y.setDate(y.getDate() - 1);
      const d = todayYmdInZone(POLISH_TZ);
      return { from: d, to: d, period: 'yesterday' };
    }

    // Today
    if (/(dzisiaj|today)/.test(text)) {
      return { from: today, to: today, period: 'today' };
    }

    // Generic hint: if user mentions "miesi" at all, assume this month as default intent
    if (/miesi[aą]c/.test(text) || /miesi/.test(text)) {
      const from = firstDayOfMonthInZone(now, POLISH_TZ);
      return { from, to: today, period: 'this_month' };
    }

    return {};
  }

  // Explicit preflight handler for CORS
  app.options('/chat/stream', async (request, reply) => {
    const reqOrigin = (request.headers as any)?.origin as string | undefined;
    reply.header('Access-Control-Allow-Origin', reqOrigin || '*');
    reply.header('Vary', 'Origin');
    reply.header('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    reply.header('Access-Control-Allow-Methods', 'POST, OPTIONS');
    reply.header('Access-Control-Max-Age', '86400');
    // Ensure raw headers as well
    try {
      reply.raw.setHeader('Access-Control-Allow-Origin', reqOrigin || '*');
      reply.raw.setHeader('Vary', 'Origin');
      reply.raw.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
      reply.raw.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
      reply.raw.setHeader('Access-Control-Max-Age', '86400');
    } catch {}
    reply.code(204).send();
  });

  app.post('/chat/stream', async (request, reply) => {
    const parsed = ChatRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      reply.status(400);
      return { error: 'Invalid request', details: parsed.error.issues };
    }

    const payload = parsed.data as ChatRequestPayload & { maxIterations?: number; model?: string };

    // Set CORS headers early (streamed response bypasses some hooks)
    const originHeader = (request.headers as any)?.origin as string | undefined;
    reply.header('Access-Control-Allow-Origin', originHeader || '*');
    reply.header('Vary', 'Origin');
    reply.header('Access-Control-Expose-Headers', 'x-budget-warning');
    reply.header('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    reply.header('Access-Control-Allow-Methods', 'POST, OPTIONS');
    // Ensure raw headers are set before flush
    try {
      reply.raw.setHeader('Access-Control-Allow-Origin', originHeader || '*');
      reply.raw.setHeader('Vary', 'Origin');
      reply.raw.setHeader('Access-Control-Expose-Headers', 'x-budget-warning');
      reply.raw.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
      reply.raw.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    } catch {}
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
    try { reply.raw.setHeader('Content-Type', 'application/x-ndjson'); } catch {}
    // CORS headers (manual, because we stream and bypass onSend hooks)
    reply.header('Access-Control-Allow-Origin', originHeader || '*');
    reply.header('Vary', 'Origin');
    reply.header('Access-Control-Expose-Headers', 'x-budget-warning');
    reply.header('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    reply.header('Access-Control-Allow-Methods', 'POST, OPTIONS');
    try {
      reply.raw.setHeader('Access-Control-Allow-Origin', originHeader || '*');
      reply.raw.setHeader('Vary', 'Origin');
      reply.raw.setHeader('Access-Control-Expose-Headers', 'x-budget-warning');
      reply.raw.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
      reply.raw.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    } catch {}
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
    const inferred = parseTimeframeFromMessages(payload.messages as any[]);
    const toolHistory: any[] = [];
    const executedResults = new Map<string, any>();

    function stableStringify(value: any): string {
      try {
        if (value && typeof value === 'object') {
          const keys = Object.keys(value).sort();
          const out: any = {};
          for (const k of keys) out[k] = (value as any)[k];
          return JSON.stringify(out);
        }
        return JSON.stringify(value);
      } catch {
        return String(value);
      }
    }
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
        }

        if (aborted) break;

        if (finishReason === 'tool_calls' && toolCallsBuffer.length > 0) {
          // Build a clean list of tool calls (with IDs and names present)
          const finalCalls = toolCallsBuffer
            .map((t) => ({
              id: (t.id && String(t.id).trim().length > 0) ? t.id : randomUUID(),
              name: (t.name ?? '').toString().trim(),
              arguments: (t.arguments ?? '').toString(),
            }))
            .filter((tc) => tc.name.length > 0);

          if (finalCalls.length === 0) {
            // No valid tool calls collected; treat as plain assistant completion
            if (assistantBuffer) {
              conversation.push({ role: 'assistant', content: assistantBuffer });
            }
            break;
          }

          // Ensure the assistant message preceding tools contains tool_calls for OpenAI compliance
          const toolCalls = finalCalls.map((tc) => ({
            id: tc.id,
            type: 'function',
            function: { name: tc.name, arguments: tc.arguments },
          }));
          conversation.push({ role: 'assistant', content: assistantBuffer || '', tool_calls: toolCalls } as any);
          // checkpoint: persist messages so far
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

          // Execute tools sequentially
          for (const call of finalCalls) {
            if (aborted) break;
            const toolName = call.name;
            let parsedArgs: unknown = {};
            try {
              parsedArgs = call.arguments ? JSON.parse(call.arguments) : {};
            } catch {
              parsedArgs = {};
            }
            // Apply heuristics for known tools (e.g., default posbistro location, date ranges)
            parsedArgs = normalizeToolArgs(toolName, parsedArgs);
            // Apply inferred timeframe if tool requires from/to and they are missing
            const toolLower = toolName.toLowerCase();
            const needsRange = toolLower.includes('normalized_item_sales_daily_totals') || toolLower.includes('item_sales_range');
            if (needsRange) {
              const today = toYyyyMmDd(new Date());
              const argsObj = parsedArgs as any;
              const hasTodayRange = argsObj?.from === today && argsObj?.to === today;

              // If user asked for explicit/this/last month, override any existing "today" defaults
              if (inferred.from && inferred.to && (inferred.period === 'this_month' || inferred.period === 'last_month' || inferred.period === 'explicit' || hasTodayRange)) {
                argsObj.from = inferred.from;
                argsObj.to = inferred.to;
              } else {
                // Otherwise, if missing, use inferred when available
                if ((!('from' in argsObj) || !argsObj.from) && inferred.from) argsObj.from = inferred.from;
                if ((!('to' in argsObj) || !argsObj.to) && inferred.to) argsObj.to = inferred.to;
              }

              // Final fallback to today if still missing
              if (!argsObj.from) argsObj.from = today;
              if (!argsObj.to) argsObj.to = today;
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

            // De-duplication: reuse cached result for identical tool+args within this stream
            const signature = `${toolName}|${stableStringify(parsedArgs)}`;
            const cached = executedResults.get(signature);
            writeNdjson(reply, { type: 'tool.started', id: call.id, name: toolName, args: parsedArgs });
            if (cached) {
              writeNdjson(reply, { type: 'tool.completed', id: call.id, name: toolName, result: cached });
              conversation.push({ role: 'tool', content: JSON.stringify(cached), tool_call_id: call.id });
              toolHistory.push({ name: toolName, args: parsedArgs, result: cached, timestamp: new Date().toISOString() });
              continue;
            }
            try {
              const result = await mcpManager.callTool(toolName, parsedArgs);
              const normalized = normalizePosbistroResult(toolName, parsedArgs, result);
              const payloadForModel = normalized ?? result ?? null;
              writeNdjson(reply, { type: 'tool.completed', id: call.id, name: toolName, result: payloadForModel });
              conversation.push({ role: 'tool', content: JSON.stringify(payloadForModel), tool_call_id: call.id });
              toolHistory.push({ name: toolName, args: parsedArgs, result: payloadForModel, timestamp: new Date().toISOString() });
              executedResults.set(signature, payloadForModel);
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
        if (assistantBuffer) {
          conversation.push({ role: 'assistant', content: assistantBuffer });
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
        break;
      }

      if (!aborted) {
        // Persist the latest state (excluding system/tool in messages saved for history)
        await saveSession({
          id: sessionId,
          messages: (conversation as any[])
            .filter((m) => m && (m.role === 'user' || m.role === 'assistant'))
            .map((m) => ({
              role: m.role,
              content: m.content ?? '',
              timestamp: m.timestamp ?? new Date().toISOString(),
            })),
          toolResults: toolHistory,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
        // Send the full conversation so the UI doesn't lose the streamed assistant message
        writeNdjson(reply, { type: 'final', sessionId, messages: conversation, toolHistory });
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
