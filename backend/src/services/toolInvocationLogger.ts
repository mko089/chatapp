import { getDb } from '../db/index.js';
import { recordToolInvocationMetric } from '../metrics/prometheus.js';

export interface ToolInvocationEvent {
  sessionId?: string;
  toolName: string;
  args?: unknown;
  result?: unknown;
  error?: string | null;
  occurredAt?: string;
}

export function recordToolInvocation(event: ToolInvocationEvent): void {
  const db = getDb();
  const occurredAt = event.occurredAt ?? new Date().toISOString();
  const argsJson = safeStringify(event.args);
  const resultJson = safeStringify(event.result);
  const error = event.error ?? null;

  db.prepare(
    `INSERT INTO tool_invocations (
      id,
      session_id,
      tool_name,
      args_json,
      result_json,
      error,
      occurred_at
    ) VALUES (
      lower(hex(randomblob(16))),
      @session_id,
      @tool_name,
      @args_json,
      @result_json,
      @error,
      @occurred_at
    )`,
  ).run({
    session_id: event.sessionId ?? null,
    tool_name: event.toolName,
    args_json: argsJson,
    result_json: resultJson,
    error,
    occurred_at: occurredAt,
  });

  try {
    recordToolInvocationMetric({ tool: event.toolName.toLowerCase(), status: event.error ? 'error' : 'success' });
  } catch {}
}

function safeStringify(value: unknown): string | null {
  if (value === undefined) return null;
  try {
    return JSON.stringify(value);
  } catch {
    try {
      return String(value);
    } catch {
      return null;
    }
  }
}
