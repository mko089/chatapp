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
              nodes.push(
                <div key={key} className="message tool tool-inline" title={summary}>
                  <div className="tool-inline-summary">{preview}</div>
                  <div className="tool-inline-actions">
                    <button type="button" onClick={() => onSelectToolResult?.(tool)}>
                      Szczegóły
                    </button>
                  </div>
                </div>
              );
            });
          }

          toolCursor += slice.length;
        }

        nodes.push(
          <div key={`msg-${idx}`} className={`message ${message.role}`}>
            {message.role === 'tool' ? <pre>{message.content}</pre> : message.content}
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
            return (
              <div key={`tool-tail-${toolCursor + idx}`} className="message tool tool-inline" title={summary}>
                <div className="tool-inline-summary">{preview}</div>
                <div className="tool-inline-actions">
                  <button type="button" onClick={() => onSelectToolResult?.(tool)}>
                    Szczegóły
                  </button>
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
