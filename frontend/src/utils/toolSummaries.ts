import { renderInlineValue } from './inlineFormat';
import { formatStructuredValue } from './format';
import type { ToolInvocation } from '../types';

function posbistroInline(tool: ToolInvocation): string | null {
  const result = tool.result as any;
  if (!result || typeof result !== 'object') return null;
  const type = typeof result.type === 'string' ? result.type : '';
  if (!type.startsWith('posbistro.') || !type.endsWith('.summary')) return null;

  const baseType = typeof result.tool === 'string' ? result.tool : type.replace(/\.summary$/, '');
  const readableName = baseType.split('.').pop() ?? baseType;

  const getLocation = (): string | null => {
    if (typeof result.location === 'string' && result.location.trim().length > 0) return result.location;
    if (tool.args && typeof tool.args === 'object' && tool.args !== null) {
      const candidate = (tool.args as Record<string, unknown>).location;
      if (typeof candidate === 'string' && candidate.trim().length > 0) return candidate;
    }
    return null;
  };

  const parseNumber = (value: unknown): number | null => {
    const num = typeof value === 'string' ? Number(value) : (typeof value === 'number' ? value : NaN);
    return Number.isFinite(num) ? num : null;
  };

  const location = getLocation();
  const from = typeof result.from === 'string' ? result.from : undefined;
  const to = typeof result.to === 'string' ? result.to : undefined;
  const period = from && to ? `${from} → ${to}` : from ?? to ?? undefined;
  const gross = parseNumber(result.gross ?? result.summary?.gross_expenditures_total);
  const net = parseNumber(result.net ?? result.summary?.net_expenditures_total);
  const entries = Array.isArray(result.entries) ? result.entries : [];
  const entryCount = entries.length;
  const topItems = entries
    .map((entry: any) => (typeof entry?.item_name === 'string' ? entry.item_name : null))
    .filter((name: string | null): name is string => Boolean(name))
    .slice(0, 3);

  const formatter = new Intl.NumberFormat('pl-PL', {
    style: 'currency', currency: 'PLN', minimumFractionDigits: 2, maximumFractionDigits: 2,
  });

  const grossLabel = gross !== null ? formatter.format(gross) : 'brak danych';
  const netLabel = net !== null ? formatter.format(net) : 'brak danych';
  const locationLabel = location ? ` @ ${location}` : '';
  const periodLabel = period ? ` • ${period}` : '';
  const entriesLabel = entryCount > 0 ? `${entryCount} pozycji` : '0 pozycji';
  const topLabel = topItems.length > 0 ? ` • Top: ${topItems.join(', ')}` : '';

  return `• ${readableName} summary${locationLabel}${periodLabel} ⇒ ${entriesLabel}, brutto ${grossLabel} (netto ${netLabel})${topLabel}`;
}

export function buildInlineSummary(tool: ToolInvocation): string {
  const specialized = posbistroInline(tool);
  if (specialized) return specialized;
  const argsInline = renderInlineValue(tool.args, 220, '{}');
  const resultInline = renderInlineValue(tool.result ?? null, 320, 'null');
  return `• Called ${tool.name}(${argsInline})\n  └ ${resultInline}`;
}

export function buildDetailedSummary(tool: ToolInvocation): string {
  const header = `Called ${tool.name}`;
  const prettyRaw = tool.rawArgs === undefined
    ? null
    : (typeof tool.rawArgs === 'string' ? tool.rawArgs : formatStructuredValue(tool.rawArgs, 2, 'null'));
  const prettyArgs = formatStructuredValue(tool.args, 2, '{}');
  const prettyResult = formatStructuredValue(tool.result ?? null, 2, 'null');
  const rawSection = prettyRaw === null ? null : (prettyRaw.includes('\n') ? `Raw args:\n${prettyRaw}` : `Raw args: ${prettyRaw}`);
  const argsSection = prettyArgs.includes('\n') ? `Args:\n${prettyArgs}` : `Args: ${prettyArgs}`;
  const resultSection = prettyResult.includes('\n') ? `Result:\n${prettyResult}` : `Result: ${prettyResult}`;
  return [header, rawSection, argsSection, resultSection].filter(Boolean).join('\n');
}

