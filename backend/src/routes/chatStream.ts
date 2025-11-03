import type { FastifyInstance } from 'fastify';
import type OpenAI from 'openai';
import { recordLlmRequestMetric } from '../metrics/prometheus.js';
import { runWithBreaker } from '../utils/circuitBreaker.js';
import { retry } from '../utils/retry.js';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { MCPManager, type NamespacedToolDefinition } from '../mcp/manager.js';
import { config } from '../config.js';
import { recordLlmTrace } from '../services/llmTraceLogger.js';
import { evaluateBudgetsForContext } from '../services/budgetEvaluator.js';
import { filterToolsByPermissions, isModelAllowed, resolveEffectivePermissions } from '../rbac/index.js';
import type { ChatRequestPayload } from '../types/chat.js';
import { loadSession, saveSession } from '../storage/sessionStore.js';
import { recordUsage } from '../metrics/costTracker.js';
import { recordToolInvocation } from '../services/toolInvocationLogger.js';

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
    if (!config.chatInferArgsEnabled) {
      return args ?? {};
    }
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

    if (name.startsWith('employee_')) {
      // Sensible defaults for read-only employee tools
      if (!('environment' in next) || String(next.environment).trim().length === 0) {
        next.environment = 'prod';
      }
      if (!('tz' in next) || String(next.tz).trim().length === 0) {
        next.tz = POLISH_TZ;
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
    const attempts: Array<(s: string) => string> = [
      // as-is
      (s) => s,
      // extract first {...} block if extra tokens present
      (s) => {
        const start = s.indexOf('{');
        const end = s.lastIndexOf('}');
        return (start >= 0 && end > start) ? s.slice(start, end + 1) : s;
      },
      // normalize quotes (best-effort)
      (s) => s.replace(/'/g, '"'),
      // remove trailing commas before } or ]
      (s) => s.replace(/,\s*([}\]])/g, '$1'),
      // collapse newlines and excessive whitespace
      (s) => s.replace(/[\r\n]+/g, ' ').replace(/\s{2,}/g, ' '),
    ];
    for (const fix of attempts) {
      const candidate = fix(text);
      try {
        return JSON.parse(candidate);
      } catch {}
    }
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

  function parseMcpError(message: string): any | null {
    if (!message || typeof message !== 'string') return null;
    // Example: "MCP error -32603: HTTP 422: {\"statusCode\":422,\"error\":{\"code\":\"MISSING_DATE\",...}}"
    const m = message.match(/HTTP\s+\d+\s*:\s*(\{.*\})\s*$/s);
    if (!m) {
      return { error: { message } };
    }
    try {
      const parsed = JSON.parse(m[1]);
      const code = parsed?.error?.code ?? parsed?.code ?? undefined;
      const errMsg = parsed?.error?.message ?? parsed?.message ?? message;
      const hints = parsed?.error?.hints ?? parsed?.hints ?? undefined;
      return { error: { code, message: errMsg, hints } };
    } catch {
      return { error: { message } };
    }
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

    // Single explicit ISO date YYYY-MM-DD
    const singleIso = text.match(/\b(\d{4}-\d{2}-\d{2})\b/);
    if (singleIso) {
      const d = singleIso[1];
      return { from: d, to: d, period: 'explicit' };
    }

    // Single explicit DD.MM.YYYY or DD-MM-YYYY or DD/MM/YYYY
    const singlePl = text.match(/\b(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{4})\b/);
    if (singlePl) {
      const dd = String(singlePl[1]).padStart(2, '0');
      const mm = String(singlePl[2]).padStart(2, '0');
      const yyyy = singlePl[3];
      const d = `${yyyy}-${mm}-${dd}`;
      return { from: d, to: d, period: 'explicit' };
    }

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
    const authContext = (request as any).auth;
    const existingSession = await loadSession(sessionId);
    if (existingSession && existingSession.userId && existingSession.userId !== authContext?.sub) {
      reply.status(404);
      return { error: 'Session not found' };
    }
    const sessionUserId = existingSession?.userId ?? authContext?.sub ?? null;
    const sessionAccountId = existingSession?.accountId ?? authContext?.accountId ?? null;
    const sessionCreatedAt = existingSession?.createdAt ?? new Date().toISOString();
    // Clamp to server-side cap to prevent excessive loops
    const maxIterations = Math.min(
      payload.maxIterations ?? config.chatMaxIterations,
      config.chatMaxIterations,
    );
    const model = payload.model ?? config.llmModel;

    const permissions = resolveEffectivePermissions(authContext);
    if (!config.llmAllowedModels.includes(model)) {
      reply.status(400);
      return { error: `Model ${model} is not allowed` };
    }
    if (!isModelAllowed(model, permissions)) {
      reply.status(403);
      return { error: `Model ${model} is not permitted for your role` };
    }

    const budgetBefore = await evaluateBudgetsForContext({
      accountId: authContext?.accountId ?? null,
      userId: authContext?.sub ?? null,
      roles: authContext?.roles ?? [],
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
    const inferred = config.chatInferArgsEnabled ? parseTimeframeFromMessages(payload.messages as any[]) : {};
    try {
      request.log.debug({ inferred }, 'Inferred timeframe from user messages');
    } catch {}
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
        if (config.llmTraceEnabled) {
          try {
            recordLlmTrace({
              sessionId,
              route: 'stream',
              phase: 'request',
              model,
              iteration: iter,
              payload: {
                messages: conversation,
                tools: toolDefs,
                tool_choice: 'auto',
                stream: true,
              },
            });
          } catch {}
        }
        let stream: any;
        try {
          stream = await runWithBreaker('llm', () => retry(() => openAi.chat.completions.create({
            model,
            messages: conversation as any,
            tools: toolDefs as any,
            tool_choice: 'auto',
            stream: true,
          } as any), {
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

        let assistantBuffer = '';
        // Accumulate tool_calls deltas per index to avoid mixing fragments
        const toolCallsByIndex = new Map<number, { id?: string; name: string; arguments: string }>();
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
              const idxRaw: any = (td as any)?.index;
              const index = Number.isFinite(Number(idxRaw)) ? Number(idxRaw) : null;
              const id = td?.id ?? undefined;
              const name = td?.function?.name ?? '';
              const args = td?.function?.arguments ?? '';
              if (index === null && !id && !name && !args) continue;
              if (index !== null) {
                const existing = toolCallsByIndex.get(index) ?? { id: id || undefined, name: '', arguments: '' };
                if (id && !existing.id) existing.id = id;
                if (name) existing.name = name;
                if (args) existing.arguments += args;
                toolCallsByIndex.set(index, existing);
              } else if (id) {
                // Fallback: no index — use id as a synthetic index based on current size
                const synthetic = toolCallsByIndex.size;
                const existing = toolCallsByIndex.get(synthetic) ?? { id, name: '', arguments: '' };
                if (name) existing.name = name;
                if (args) existing.arguments += args;
                toolCallsByIndex.set(synthetic, existing);
              }
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

        // Estimate usage for streaming responses (approximate tokens by chars/4)
        try {
          const promptChars = conversation.reduce((sum, m: any) => sum + (typeof m?.content === 'string' ? m.content.length : 0), 0);
          const completionChars = assistantBuffer.length;
          const promptTokens = Math.ceil(promptChars / 4);
          const completionTokens = Math.ceil(completionChars / 4);
          const totalTokens = promptTokens + completionTokens;
          const usageRecord = recordUsage(sessionId, {
            prompt_tokens: promptTokens,
            completion_tokens: completionTokens,
            total_tokens: totalTokens,
            prompt_tokens_details: { cached_tokens: 0 },
          } as any, model);
          if (usageRecord) {
            writeNdjson(reply, {
              type: 'usage',
              promptTokens: usageRecord.promptTokens,
              completionTokens: usageRecord.completionTokens,
              totalTokens: usageRecord.totalTokens,
              costUsd: usageRecord.costUsd,
            });
          }
        } catch {}

        if (aborted) break;

        if (config.llmTraceEnabled) {
          try {
            const finalCalls = Array.from(toolCallsByIndex.entries())
              .sort((a, b) => a[0] - b[0])
              .map(([_, t]) => ({ id: (t.id && String(t.id).trim().length > 0) ? t.id : undefined, name: (t.name ?? '').toString().trim(), arguments: (t.arguments ?? '').toString() }))
              .filter((tc) => tc.name.length > 0);
            recordLlmTrace({
              sessionId,
              route: 'stream',
              phase: 'response',
              model,
              iteration: iter,
              status: finishReason ?? undefined,
              meta: { durationMs },
              payload: { content: assistantBuffer, tool_calls: finalCalls },
            });
          } catch {}
        }

        const finalCalls = Array.from(toolCallsByIndex.entries())
          .sort((a, b) => a[0] - b[0])
          .map(([_, t]) => ({
            id: (t.id && String(t.id).trim().length > 0) ? t.id : randomUUID(),
            name: (t.name ?? '').toString().trim(),
            arguments: (t.arguments ?? '').toString(),
          }))
          .filter((tc) => tc.name.length > 0);

        if (finishReason === 'tool_calls' && finalCalls.length > 0) {
          // Build a clean list of tool calls (with IDs and names present)

          try {
            request.log.debug({ toolCalls: finalCalls }, 'Collected tool_calls from model');
          } catch {}

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
              userId: sessionUserId,
              accountId: sessionAccountId,
              messages: payload.messages
                .filter((m) => m.role !== 'system' && m.role !== 'tool')
                .map((m) => ({ role: m.role, content: m.content ?? '', timestamp: m.timestamp ?? new Date().toISOString() })),
              toolResults: toolHistory,
              createdAt: sessionCreatedAt,
              updatedAt: new Date().toISOString(),
            });
          } catch {}

          // Execute tools sequentially
          const executedRawArgs = new Map<string, unknown>();
          for (const call of finalCalls) {
            if (aborted) break;
            const toolName = call.name;
            let parsedArgs: unknown = {};
            let parseOk = true;
            try {
              // Try strict JSON first
              parsedArgs = call.arguments ? JSON.parse(call.arguments) : {};
            } catch {
              // Fall back to a loose JSON parse (e.g., single quotes, minor mistakes)
              try {
                const loose = typeof call.arguments === 'string' ? tryParseJsonLoose(call.arguments) : null;
                if (loose === null) {
                  parseOk = false;
                } else {
                  parsedArgs = loose;
                }
              } catch {
                parseOk = false;
              }
            }
            // Apply heuristics for known tools only when inference is enabled
            if (config.chatInferArgsEnabled) {
              parsedArgs = normalizeToolArgs(toolName, parsedArgs);
              // Apply inferred timeframe if tool requires from/to and they are missing
              const toolLower = toolName.toLowerCase();
              const needsRange =
                toolLower.includes('normalized_item_sales_daily_totals') ||
                toolLower.includes('item_sales_range') ||
                toolLower.includes('employee_employee_employees_costs');
              if (needsRange) {
                const today = toYyyyMmDd(new Date());
                const argsObj = parsedArgs as any;
                const hasTodayRange = argsObj?.from === today && argsObj?.to === today;

                // If user asked for explicit/this/last month, override any existing "today" defaults
                if (
                  inferred.from &&
                  inferred.to &&
                  (inferred.period === 'this_month' || inferred.period === 'last_month' || inferred.period === 'explicit' || hasTodayRange)
                ) {
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
            }
            try {
              request.log.debug({ toolName, callId: call.id, args: parsedArgs, inferred }, 'Executing tool with arguments');
            } catch {}
            const def = toolName ? allowedToolMap.get(toolName.toLowerCase()) : undefined;
            if (!def) {
              writeNdjson(reply, { type: 'tool.started', id: call.id, name: toolName || 'unknown', args: parsedArgs });
              const result = { error: `Tool ${toolName || 'unknown'} is not permitted for your role` };
              writeNdjson(reply, { type: 'tool.completed', id: call.id, name: toolName || 'unknown', result });
              conversation.push({ role: 'tool', content: JSON.stringify(result), tool_call_id: call.id });
              toolHistory.push({ name: toolName || 'unknown', args: parsedArgs, rawArgs: call.arguments, result, timestamp: new Date().toISOString() });
              try { recordToolInvocation({ sessionId, toolName: toolName || 'unknown', args: parsedArgs, result }); } catch {}
              continue;
            }

            if (!parseOk) {
              // Do not execute tool with empty/invalid args — report error with raw payload
              writeNdjson(reply, { type: 'tool.started', id: call.id, name: toolName, args: {} });
              const result = { error: { code: 'MALFORMED_TOOL_ARGS', message: 'Tool arguments could not be parsed as JSON', raw: call.arguments } };
              writeNdjson(reply, { type: 'tool.completed', id: call.id, name: toolName, result });
              conversation.push({ role: 'tool', content: JSON.stringify(result), tool_call_id: call.id });
              toolHistory.push({ name: toolName, args: {}, rawArgs: call.arguments, result, timestamp: new Date().toISOString() });
              try { recordToolInvocation({ sessionId, toolName, args: {}, result }); } catch {}
              continue;
            }

            // De-duplication: reuse cached result for identical tool+args within this stream
            const signature = `${toolName}|${stableStringify(parsedArgs)}`;
            const cached = executedResults.get(signature);
            writeNdjson(reply, { type: 'tool.started', id: call.id, name: toolName, args: parsedArgs });
            if (cached) {
              writeNdjson(reply, { type: 'tool.completed', id: call.id, name: toolName, result: cached });
              conversation.push({ role: 'tool', content: JSON.stringify(cached), tool_call_id: call.id });
              toolHistory.push({ name: toolName, args: parsedArgs, rawArgs: executedRawArgs.get(signature) ?? call.arguments, result: cached, timestamp: new Date().toISOString() });
              continue;
            }
            try {
              const breakerKey = def ? `mcp:${def.serverId}` : 'mcp';
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
              const normalized = normalizePosbistroResult(toolName, parsedArgs, result);
              const payloadForModel = normalized ?? result ?? null;
              writeNdjson(reply, { type: 'tool.completed', id: call.id, name: toolName, result: payloadForModel });
              conversation.push({ role: 'tool', content: JSON.stringify(payloadForModel), tool_call_id: call.id });
              toolHistory.push({ name: toolName, args: parsedArgs, rawArgs: call.arguments, result: payloadForModel, timestamp: new Date().toISOString() });
              try { recordToolInvocation({ sessionId, toolName, args: parsedArgs, result: payloadForModel }); } catch {}
              executedResults.set(signature, payloadForModel);
              try { executedRawArgs.set(signature, call.arguments); } catch {}
              // checkpoint: persist after each tool
              try {
                await saveSession({
                  id: sessionId,
                  userId: sessionUserId,
                  accountId: sessionAccountId,
                  messages: payload.messages
                    .filter((m) => m.role !== 'system' && m.role !== 'tool')
                    .map((m) => ({ role: m.role, content: m.content ?? '', timestamp: m.timestamp ?? new Date().toISOString() })),
                  toolResults: toolHistory,
                  createdAt: sessionCreatedAt,
                  updatedAt: new Date().toISOString(),
                });
              } catch {}
            } catch (error) {
              const rawMsg = (error as Error).message;
              const errPayload = parseMcpError(rawMsg) ?? { error: { message: rawMsg } };
              writeNdjson(reply, { type: 'tool.completed', id: call.id, name: toolName, result: errPayload });
              conversation.push({ role: 'tool', content: JSON.stringify(errPayload), tool_call_id: call.id });
              toolHistory.push({ name: toolName, args: parsedArgs, rawArgs: call.arguments, result: errPayload, timestamp: new Date().toISOString() });
              try { recordToolInvocation({ sessionId, toolName, args: parsedArgs, result: null, error: (error as Error).message }); } catch {}
              // Cache error as well to prevent repeated identical calls within this stream
              try { executedResults.set(signature, errPayload); } catch {}
              try { executedRawArgs.set(signature, call.arguments); } catch {}
              try {
                await saveSession({
                  id: sessionId,
                  userId: sessionUserId,
                  accountId: sessionAccountId,
                  messages: payload.messages
                    .filter((m) => m.role !== 'system' && m.role !== 'tool')
                    .map((m) => ({ role: m.role, content: m.content ?? '', timestamp: m.timestamp ?? new Date().toISOString() })),
                  toolResults: toolHistory,
                  createdAt: sessionCreatedAt,
                  updatedAt: new Date().toISOString(),
                });
              } catch {}
            }
          }
          // Continue loop for next iteration
          // (usage for this iteration was already estimated and emitted above)
          // Continue loop for next iteration
          continue;
        }

        // No tool calls; finish
        if (assistantBuffer) {
          conversation.push({ role: 'assistant', content: assistantBuffer });
          try {
            await saveSession({
              id: sessionId,
              userId: sessionUserId,
              accountId: sessionAccountId,
              messages: payload.messages
                .filter((m) => m.role !== 'system' && m.role !== 'tool')
                .map((m) => ({ role: m.role, content: m.content ?? '', timestamp: m.timestamp ?? new Date().toISOString() })),
              toolResults: toolHistory,
              createdAt: sessionCreatedAt,
              updatedAt: new Date().toISOString(),
            });
          } catch {}
        }
        break;
      }

      if (!aborted) {
        // Persist the latest state but exclude the transitional assistant message that only carries tool_calls
        let filteredForHistory = (conversation as any[])
          .filter((m) => m && (m.role === 'user' || m.role === 'assistant'))
          .filter((m) => !(m.role === 'assistant' && Array.isArray((m as any).tool_calls) && (m as any).tool_calls.length > 0));

        const hasAssistant = filteredForHistory.some((m) => m.role === 'assistant' && typeof m.content === 'string' && m.content.trim().length > 0);
        if (!hasAssistant) {
          // Build a concise fallback from recent tool errors/hints
          const errorSummaries: string[] = [];
          for (let i = toolHistory.length - 1; i >= 0 && errorSummaries.length < 3; i -= 1) {
            const tr = toolHistory[i] as any;
            const res = tr?.result;
            const err = res?.error || res?.message || null;
            if (err) {
              const code = typeof err?.code === 'string' ? ` (${err.code})` : '';
              const msg = typeof err?.message === 'string' ? err.message : (typeof res?.error === 'string' ? res.error : 'Nieznany błąd');
              errorSummaries.push(`- ${tr.name}${code}: ${msg}`);
            }
          }
          const hintLines: string[] = [];
          const firstHint = toolHistory.find((tr: any) => tr?.result?.error?.hints && Array.isArray(tr.result.error.hints));
          if (firstHint) {
            for (const h of (firstHint.result.error.hints as string[]).slice(0, 3)) hintLines.push(`• ${h}`);
          }
          const fallback = [
            errorSummaries.length ? `Napotkałem błąd(y) narzędzi:\n${errorSummaries.join('\n')}` : 'Narzędzia nie zwróciły danych, więc nie mogę dokończyć odpowiedzi.',
            hintLines.length ? `Sugestie z narzędzia:\n${hintLines.join('\n')}` : undefined,
            'Możemy kontynuować mimo to: podaj brakujące parametry (np. data YYYY-MM-DD, lokalizacja), albo napisz „pomiń narzędzia”, a odpowiem szacunkowo bez wywołań.',
          ].filter(Boolean).join('\n\n');
          filteredForHistory = [...filteredForHistory, { role: 'assistant', content: fallback, timestamp: new Date().toISOString() }];
        }

        await saveSession({
          id: sessionId,
          userId: sessionUserId,
          accountId: sessionAccountId,
          messages: filteredForHistory.map((m) => ({
            role: m.role,
            content: m.content ?? '',
            timestamp: m.timestamp ?? new Date().toISOString(),
          })),
          toolResults: toolHistory,
          createdAt: sessionCreatedAt,
          updatedAt: new Date().toISOString(),
        });
        // Send filtered messages to avoid showing the pre-tool_call assistant stub
        writeNdjson(reply, { type: 'final', sessionId, messages: filteredForHistory, toolHistory });
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
