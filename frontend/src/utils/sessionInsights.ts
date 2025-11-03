import type { ToolInvocation } from '../types';

export type SessionMetrics = {
  location?: string | null;
  from?: string | null;
  to?: string | null;
  gross?: number | null;
  net?: number | null;
  receipts?: number | null;
  timestamp?: string | null;
};

export function deriveSessionInsights(toolResults: ToolInvocation[]): SessionMetrics | null {
  for (let index = toolResults.length - 1; index >= 0; index -= 1) {
    const tool = toolResults[index];
    const result = tool.result as any;
    if (!result || typeof result !== 'object') continue;

    const location = extractLocation(tool);
    const from = typeof result.from === 'string' ? result.from : typeof result.window?.from === 'string' ? result.window.from : undefined;
    const to = typeof result.to === 'string' ? result.to : typeof result.window?.to === 'string' ? result.window.to : undefined;

    const summary = typeof result.summary === 'object' && result.summary !== null ? result.summary : undefined;
    const totals = typeof result.totals === 'object' && result.totals !== null ? result.totals : undefined;

    const gross = parseMetricNumber(
      result.gross ?? summary?.gross_expenditures_total ?? summary?.gross ?? totals?.gross ?? totals?.grossTotal,
    );
    const net = parseMetricNumber(
      result.net ?? summary?.net_expenditures_total ?? summary?.net ?? totals?.net ?? totals?.netTotal,
    );
    let receipts = parseMetricNumber(result.receipts ?? summary?.receipt_count ?? summary?.receipts ?? totals?.receipts);
    if (receipts === null && Array.isArray(result.entries)) {
      receipts = result.entries.length;
    }

    const metrics: SessionMetrics = {
      location,
      from: from ?? null,
      to: to ?? null,
      gross,
      net,
      receipts,
      timestamp: tool.timestamp ?? null,
    };

    const hasData = Object.values(metrics).some((value) => value !== null && value !== undefined);
    if (hasData) {
      return metrics;
    }
  }
  return null;
}

export function extractLocation(tool: ToolInvocation): string | null {
  const result = tool.result as any;
  if (typeof result?.location === 'string' && result.location.trim().length > 0) {
    return result.location.trim();
  }
  if (result?.meta && typeof result.meta === 'object' && typeof result.meta.location === 'string') {
    const candidate = result.meta.location.trim();
    if (candidate.length > 0) return candidate;
  }
  if (tool.args && typeof tool.args === 'object' && tool.args !== null) {
    const candidate = (tool.args as Record<string, unknown>).location;
    if (typeof candidate === 'string' && candidate.trim().length > 0) {
      return candidate.trim();
    }
  }
  return null;
}

function parseMetricNumber(value: unknown): number | null {
  const num = typeof value === 'string' ? Number(value) : (typeof value === 'number' ? value : NaN);
  return Number.isFinite(num) ? num : null;
}

