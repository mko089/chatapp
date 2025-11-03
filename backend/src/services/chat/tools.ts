import type { ChatCompletionTool } from 'openai/resources/chat/completions';
import type { FunctionParameters } from 'openai/resources/shared';
import type { NamespacedToolDefinition } from '../../mcp/manager.js';
import { config } from '../../config.js';

const DEFAULT_TZ = 'Europe/Warsaw';

function sanitizeParameters(parameters: unknown): FunctionParameters {
  if (parameters && typeof parameters === 'object') {
    return parameters as FunctionParameters;
  }
  return { type: 'object', properties: {} } as FunctionParameters;
}

export function toToolDefinition(tool: NamespacedToolDefinition): ChatCompletionTool {
  return {
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description ?? undefined,
      parameters: sanitizeParameters(tool.parameters),
    },
  };
}

export function tryParseJsonLoose(text: string): any | null {
  if (!text || typeof text !== 'string') return null;
  const attempts: Array<(s: string) => string> = [
    (s) => s,
    (s) => {
      const start = s.indexOf('{');
      const end = s.lastIndexOf('}');
      return start >= 0 && end > start ? s.slice(start, end + 1) : s;
    },
    (s) => s.replace(/'/g, '"'),
    (s) => s.replace(/,\s*([}\]])/g, '$1'),
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

export function parseMcpError(message: string): any | null {
  if (!message || typeof message !== 'string') return null;
  const m = message.match(/HTTP\s+\d+\s*:\s*(\{.*\})\s*$/s);
  if (!m) return { error: { message } };
  try {
    const parsed = JSON.parse(m[1]);
    const code = (parsed as any)?.error?.code ?? (parsed as any)?.code ?? undefined;
    const errMsg = (parsed as any)?.error?.message ?? (parsed as any)?.message ?? message;
    const hints = (parsed as any)?.error?.hints ?? (parsed as any)?.hints ?? undefined;
    return { error: { code, message: errMsg, hints } };
  } catch {
    return { error: { message } };
  }
}

export function stableStringify(value: any): string {
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

export function normalizeToolArgs(toolName: string, args: any): any {
  if (!config.chatInferArgsEnabled) {
    return args ?? {};
  }
  const name = (toolName || '').toLowerCase();
  const next: any = args && typeof args === 'object' ? { ...args } : {};

  if (name.startsWith('posbistro_')) {
    // Default POSBistro location to gardenbistro if missing
    if (!next.location || String(next.location).trim().length === 0) {
      next.location = 'gardenbistro';
    }
    if (name.includes('normalized_item_sales_today') || name.includes('item_sales_today')) {
      if (next.offset_minutes === undefined) next.offset_minutes = 0;
    }
  }

  if (name.startsWith('employee_')) {
    if (!('environment' in next) || String(next.environment).trim().length === 0) {
      next.environment = 'prod';
    }
    if (!('tz' in next) || String(next.tz).trim().length === 0) {
      next.tz = DEFAULT_TZ;
    }
    // Ensure required date for attendances
    if (name.includes('employee_list_attendances')) {
      if (!next.date && !next.preset) {
        next.preset = 'today';
      }
    }
  }

  return next;
}

