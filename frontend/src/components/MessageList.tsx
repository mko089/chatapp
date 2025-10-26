import { Fragment, type CSSProperties } from 'react';
import type { ChatMessage, ToolInvocation } from '../types';
import { renderInlineValue } from '../utils/inlineFormat';

interface MessageListProps {
  messages: ChatMessage[];
  toolResults?: ToolInvocation[];
  assistantToolCounts?: number[];
  onSelectToolResult?: (tool: ToolInvocation) => void;
  inlineSummaryFormatter?: (tool: ToolInvocation) => string;
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
  isBusy,
  fontScale = 1,
  showInlineTools = true,
}: MessageListProps) {
  if (messages.length === 0) {
    return (
      <div
        className="messages-panel"
        style={{ '--chat-font-scale': fontScale } as CSSProperties}
      >
        <div className="message assistant">
          Zacznij rozmowę, aby zobaczyć odpowiedzi i wyniki narzędzi MCP.
        </div>
      </div>
    );
  }

  let toolCursor = 0;
  let assistantIndex = 0;

  return (
    <div
      className="messages-panel"
      style={{ '--chat-font-scale': fontScale } as CSSProperties}
    >
      {messages.map((message, idx) => {
        const nodes: JSX.Element[] = [];

        if (message.role === 'assistant') {
          const count = assistantToolCounts[assistantIndex] ?? 0;
          const slice = toolResults.slice(toolCursor, toolCursor + Math.max(0, count));

          if (showInlineTools) {
            slice.forEach((tool, innerIdx) => {
              const key = `tool-${toolCursor + innerIdx}`;
              const summary = inlineSummaryFormatter
                ? inlineSummaryFormatter(tool)
                : fallbackSummary(tool);
              const preview = limitInline(summary);
              const toolTimestamp = formatTimestampLabel(tool.timestamp);
              nodes.push(
                <div key={key} className="message tool tool-inline" title={summary}>
                  <div className="tool-inline-summary">{preview}</div>
                  <div className="tool-inline-footer">
                    {toolTimestamp ? <span className="tool-inline-timestamp">{toolTimestamp}</span> : <span />}
                    <div className="tool-inline-actions">
                      <button type="button" onClick={() => onSelectToolResult?.(tool)}>
                        Szczegóły
                      </button>
                    </div>
                  </div>
                </div>
              );
            });
          }

          toolCursor += slice.length;
        }

        const timestampLabel = formatTimestampLabel(message.timestamp);

        nodes.push(
          <div key={`msg-${idx}`} className={`message ${message.role}`}>
            <div className="message-body">
              {message.role === 'tool' ? <pre>{message.content}</pre> : message.content}
            </div>
            {timestampLabel ? (
              <div className={`message-meta message-meta-${message.role}`}>{timestampLabel}</div>
            ) : null}
          </div>
        );

        if (message.role === 'assistant') {
          assistantIndex += 1;
        }

        return <Fragment key={`entry-${idx}`}>{nodes}</Fragment>;
      })}
      {showInlineTools && toolCursor < toolResults.length
        ? toolResults.slice(toolCursor).map((tool, idx) => {
            const summary = inlineSummaryFormatter
              ? inlineSummaryFormatter(tool)
              : fallbackSummary(tool);
            const preview = limitInline(summary);
            const toolTimestamp = formatTimestampLabel(tool.timestamp);
            return (
              <div key={`tool-tail-${toolCursor + idx}`} className="message tool tool-inline" title={summary}>
                <div className="tool-inline-summary">{preview}</div>
                <div className="tool-inline-footer">
                  {toolTimestamp ? <span className="tool-inline-timestamp">{toolTimestamp}</span> : <span />}
                  <div className="tool-inline-actions">
                    <button type="button" onClick={() => onSelectToolResult?.(tool)}>
                      Szczegóły
                    </button>
                  </div>
                </div>
              </div>
            );
          })
        : null}
      {isBusy ? (
        <div className="message assistant">
          <span className="typing-indicator">
            <span />
            <span />
            <span />
          </span>
        </div>
      ) : null}
    </div>
  );
}

function fallbackSummary(tool: ToolInvocation): string {
  const args = renderInlineValue(tool.args, 220, '{}');
  const result = renderInlineValue(tool.result ?? null, 320, 'null');
  return `• Called ${tool.name}(${args})\n  └ ${result}`;
}

function limitInline(summary: string, maxChars = 520): string {
  if (summary.length <= maxChars) {
    return summary;
  }
  return `${summary.slice(0, maxChars - 1)}…`;
}

function formatTimestampLabel(timestamp?: string): string | null {
  if (!timestamp) {
    return null;
  }
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();
  if (isToday) {
    return new Intl.DateTimeFormat('pl-PL', {
      hour: '2-digit',
      minute: '2-digit',
    }).format(date);
  }
  return new Intl.DateTimeFormat('pl-PL', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}
