import { getDb } from '../db/index.js';

export interface LlmTraceEvent {
  sessionId?: string | null;
  route: 'stream' | 'chat';
  phase: 'request' | 'response' | 'error';
  model?: string;
  iteration?: number;
  status?: string;
  payload?: unknown;
  meta?: unknown;
  occurredAt?: string;
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

export function recordLlmTrace(event: LlmTraceEvent): void {
  const db = getDb();
  const occurredAt = event.occurredAt ?? new Date().toISOString();
  const payloadJson = safeStringify(event.payload);
  const metaJson = safeStringify(event.meta);

  db.prepare(
    `INSERT INTO llm_traces (
      id,
      session_id,
      route,
      phase,
      model,
      iteration,
      status,
      meta_json,
      payload_json,
      occurred_at
    ) VALUES (
      lower(hex(randomblob(16))),
      @session_id,
      @route,
      @phase,
      @model,
      @iteration,
      @status,
      @meta_json,
      @payload_json,
      @occurred_at
    )`,
  ).run({
    session_id: event.sessionId ?? null,
    route: event.route,
    phase: event.phase,
    model: event.model ?? null,
    iteration: Number.isFinite(event.iteration) ? event.iteration : null,
    status: event.status ?? null,
    meta_json: metaJson,
    payload_json: payloadJson,
    occurred_at: occurredAt,
  });
}

export function listLlmTraces(sessionId: string, limit = 200): Array<{ id: string; route: string; phase: string; model: string | null; iteration: number | null; status: string | null; meta: any; payload: any; occurredAt: string }>
{
  const db = getDb();
  const rows = db.prepare(
    `SELECT id, route, phase, model, iteration, status, meta_json, payload_json, occurred_at
     FROM llm_traces
     WHERE session_id = @session_id
     ORDER BY occurred_at DESC
     LIMIT @limit`,
  ).all({ session_id: sessionId, limit });

  return rows.map((row: any) => ({
    id: row.id,
    route: row.route,
    phase: row.phase,
    model: row.model ?? null,
    iteration: row.iteration ?? null,
    status: row.status ?? null,
    meta: tryParseJson(row.meta_json),
    payload: tryParseJson(row.payload_json),
    occurredAt: row.occurred_at,
  }));
}

function tryParseJson(text: string | null): any {
  if (!text || typeof text !== 'string') return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

