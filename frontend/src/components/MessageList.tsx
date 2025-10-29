import { Fragment, useMemo, type ReactNode } from 'react';
import type { ChatMessage, ToolInvocation } from '../types';
import { renderInlineValue } from '../utils/inlineFormat';

interface MessageListProps {
  messages: ChatMessage[];
  toolResults?: ToolInvocation[];
  assistantToolCounts?: number[];
  onSelectToolResult?: (tool: ToolInvocation) => void;
  inlineSummaryFormatter?: (tool: ToolInvocation) => string;
  toolDetailsFormatter?: (tool: ToolInvocation) => string;
  isBusy?: boolean;
  fontScale?: number;
  showInlineTools?: boolean;
}

export function MessageList({
  messages,
  toolResults = [],
  assistantToolCounts = [],
  onSelectToolResult,
  inlineSummaryFormatter,
  toolDetailsFormatter,
  isBusy,
  fontScale = 1,
  showInlineTools = true,
}: MessageListProps) {
  const scaleStyle = useMemo(() => ({ fontSize: `${fontScale}rem` }), [fontScale]);

  if (messages.length === 0) {
    return (
      <div className="relative flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col items-center justify-center gap-3 px-6 py-20 text-center" style={scaleStyle}>
          <div className="rounded-full border border-white/10 bg-white/5 px-4 py-1 text-xs uppercase tracking-wide text-slate-400">Gotowy do rozmowy</div>
          <p className="max-w-xl text-lg text-slate-300">
            Zacznij rozmowę, aby zobaczyć odpowiedzi asystenta i wyniki narzędzi MCP. Podpowiedz czego szukasz – np. obrotów Garden Bistro z wczoraj.
          </p>
        </div>
      </div>
    );
  }

  let toolCursor = 0;
  let assistantIndex = 0;
  let lastSeparator: string | null = null;

  return (
    <div className="relative flex-1 overflow-y-auto">
      <div className="mx-auto flex w-full max-w-4xl flex-col space-y-3 px-4 pb-32 pt-8 leading-relaxed" style={scaleStyle}>
        {messages.map((message, idx) => {
          const nodes: JSX.Element[] = [];

          const separator = formatBlockSeparator(message.timestamp);
          if (separator && separator !== lastSeparator) {
            lastSeparator = separator;
            nodes.push(
              <Separator key={`separator-${idx}`} label={separator} />
            );
          }

          if (message.role === 'tool') {
            if (showInlineTools) {
              nodes.push(
                <ToolResultCard
                  key={`tool-msg-${idx}`}
                  tool={{ name: 'Tool output', args: {}, result: message.content, timestamp: message.timestamp }}
                  summary={typeof message.content === 'string' ? message.content : JSON.stringify(message.content, null, 2)}
                  onInspect={onSelectToolResult}
                  prettyFormatter={toolDetailsFormatter}
                />
              );
            }
            return <Fragment key={`entry-${idx}`}>{nodes}</Fragment>;
          }

          const timestampLabel = formatTimeLabel(message.timestamp);
          const thinkingLabel = formatThinkingDuration(message.metadata?.llmDurationMs);
          const metaParts = [timestampLabel, thinkingLabel].filter(Boolean) as string[];

          nodes.push(
            <MessageBubble key={`msg-${idx}`} role={message.role} meta={metaParts.join(' • ')}>
              {message.content}
            </MessageBubble>
          );

          if (message.role === 'assistant') {
            const count = assistantToolCounts[assistantIndex] ?? 0;
            const slice = toolResults.slice(toolCursor, toolCursor + Math.max(0, count));

            if (showInlineTools) {
              slice.forEach((tool, innerIdx) => {
                const summary = inlineSummaryFormatter ? inlineSummaryFormatter(tool) : fallbackSummary(tool);
                nodes.push(
                  <ToolResultCard
                    key={`tool-${toolCursor + innerIdx}`}
                    tool={tool}
                    summary={summary}
                    onInspect={onSelectToolResult}
                    prettyFormatter={toolDetailsFormatter}
                  />
                );
              });
            }

            toolCursor += slice.length;
            assistantIndex += 1;
          }

          return <Fragment key={`entry-${idx}`}>{nodes}</Fragment>;
        })}

        {showInlineTools && toolCursor < toolResults.length
          ? toolResults.slice(toolCursor).map((tool, idx) => {
              const summary = inlineSummaryFormatter ? inlineSummaryFormatter(tool) : fallbackSummary(tool);
              return (
                <ToolResultCard
                  key={`tool-tail-${toolCursor + idx}`}
                  tool={tool}
                  summary={summary}
                  onInspect={onSelectToolResult}
                  prettyFormatter={toolDetailsFormatter}
                />
              );
            })
          : null}

        {isBusy ? (
          <div className="flex justify-start">
            <div className="ml-2 flex items-center gap-2 rounded-3xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-slate-300">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-slate-300 opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-slate-100" />
              </span>
              Asystent myśli…
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

interface MessageBubbleProps {
  role: ChatMessage['role'];
  meta?: string;
  children: ReactNode;
}

function MessageBubble({ role, meta, children }: MessageBubbleProps) {
  const base = 'max-w-[80%] rounded-3xl px-5 py-4 shadow-card whitespace-pre-wrap break-words';
  const variants: Record<ChatMessage['role'], string> = {
    user: 'ml-auto bg-gradient-to-br from-accent/40 via-accent/20 to-accent/10 text-slate-50',
    assistant: 'mr-auto bg-white/5 text-slate-100',
    system: 'mx-auto bg-surface/80 text-slate-300 text-sm uppercase tracking-wide',
    tool: 'mr-auto bg-white/5 text-slate-100',
  };

  return (
    <div className="flex flex-col gap-2">
      <div className={`${base} ${variants[role]}`}>{children}</div>
      {meta ? <div className="text-xs text-slate-500">{meta}</div> : null}
    </div>
  );
}

interface ToolResultCardProps {
  tool: ToolInvocation;
  summary: string;
  onInspect?: (tool: ToolInvocation) => void;
  prettyFormatter?: (tool: ToolInvocation) => string;
}

function ToolResultCard({ tool, summary, onInspect, prettyFormatter }: ToolResultCardProps) {
  const { label, tone } = deriveToolStatus(tool);
  const badgeClass = tone === 'ok' ? 'chip chip-primary' : tone === 'error' ? 'chip chip-danger' : 'chip chip-accent';
  const timestamp = formatTimeLabel(tool.timestamp);
  const csvPayload = toCsv(tool);

  const handleCopy = async () => {
    const payload = prettyFormatter ? prettyFormatter(tool) : summary;
    try {
      await navigator.clipboard?.writeText(payload);
    } catch {
      // no-op: clipboard unavailable
    }
  };

  const handleDownloadCsv = () => {
    if (!csvPayload) {
      return;
    }
    const blob = new Blob([csvPayload], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `${tool.name}-${Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const hasCsv = Boolean(csvPayload);

  return (
    <div className="glass-panel flex flex-col gap-4 px-5 py-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-white">{tool.name}</div>
          {timestamp ? <div className="text-xs text-slate-500">{timestamp}</div> : null}
        </div>
        <span className={badgeClass}>{label}</span>
      </div>
      <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-xl bg-surface-muted/60 px-4 py-3 text-sm text-slate-200">
        {summary}
      </pre>
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs uppercase tracking-wide text-slate-300">
        <div className="flex gap-2">
          <button
            type="button"
            onClick={handleCopy}
            className="rounded-full border border-white/10 bg-white/5 px-4 py-2 transition hover:border-white/20 hover:bg-white/10"
          >
            Kopiuj
          </button>
          <button
            type="button"
            onClick={handleDownloadCsv}
            disabled={!hasCsv}
            className="rounded-full border border-white/10 bg-white/5 px-4 py-2 transition hover:border-white/20 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
          >
            CSV
          </button>
          <button
            type="button"
            onClick={() => onInspect?.(tool)}
            className="rounded-full border border-white/10 bg-white/5 px-4 py-2 transition hover:border-white/20 hover:bg-white/10"
          >
            Logi
          </button>
        </div>
      </div>
    </div>
  );
}

function Separator({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3 px-2 text-xs uppercase tracking-wide text-slate-500">
      <span className="h-px flex-1 bg-white/10" />
      <span>{label}</span>
      <span className="h-px flex-1 bg-white/10" />
    </div>
  );
}

function fallbackSummary(tool: ToolInvocation): string {
  const args = renderInlineValue(tool.args, 220, '{}');
  const result = renderInlineValue(tool.result ?? null, 320, 'null');
  return `• Called ${tool.name}(${args})\n  └ ${result}`;
}

function deriveToolStatus(tool: ToolInvocation): { label: string; tone: 'ok' | 'error' | 'loading' } {
  const result = tool.result as any;
  const statusValue: string | undefined = typeof result === 'object' && result !== null && typeof result.status === 'string' ? result.status : undefined;
  const errorPresent = Boolean(result?.error || result?.message?.toLowerCase?.().includes?.('error'));

  if (statusValue) {
    const normalized = statusValue.toLowerCase();
    if (['ok', 'success', 'done', 'completed'].includes(normalized)) {
      return { label: 'OK', tone: 'ok' };
    }
    if (['running', 'pending', 'in-progress'].includes(normalized)) {
      return { label: 'RUNNING', tone: 'loading' };
    }
    if (['error', 'failed', 'fail'].includes(normalized)) {
      return { label: 'ERROR', tone: 'error' };
    }
  }

  if (errorPresent) {
    return { label: 'ERROR', tone: 'error' };
  }

  return { label: 'OK', tone: 'ok' };
}

function formatBlockSeparator(timestamp?: string): string | null {
  if (!timestamp) {
    return null;
  }
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  const datePart = new Intl.DateTimeFormat('pl-PL', {
    dateStyle: 'medium',
  }).format(date);
  const timePart = new Intl.DateTimeFormat('pl-PL', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
  return `${datePart} • ${timePart}`;
}

function formatTimeLabel(timestamp?: string): string | null {
  if (!timestamp) {
    return null;
  }
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return new Intl.DateTimeFormat('pl-PL', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function formatThinkingDuration(durationMs?: number): string | null {
  if (durationMs === undefined) {
    return null;
  }
  const numeric = Number(durationMs);
  if (!Number.isFinite(numeric) || numeric < 0) {
    return null;
  }
  if (numeric < 1000) {
    return `Myślenie: ${Math.round(numeric)} ms`;
  }
  return `Myślenie: ${(numeric / 1000).toFixed(numeric >= 10_000 ? 0 : 1)} s`;
}

function toCsv(tool: ToolInvocation): string | null {
  const result = tool.result as any;
  const entries: any[] | undefined = Array.isArray(result?.entries) ? result.entries : undefined;
  if (!entries || entries.length === 0) {
    return null;
  }

  const header = Array.from(
    entries.reduce<Set<string>>((cols, entry) => {
      Object.keys(entry ?? {}).forEach((key) => cols.add(key));
      return cols;
    }, new Set<string>())
  );

  const encode = (value: unknown): string => {
    if (value === null || value === undefined) {
      return '';
    }
    if (typeof value === 'number') {
      return String(value);
    }
    const str = typeof value === 'string' ? value : JSON.stringify(value);
    if (/[",\n]/.test(str)) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  const rows = entries.map((entry) => header.map((key) => encode((entry as any)[key])));
  return [header.join(','), ...rows.map((row) => row.join(','))].join('\n');
}
