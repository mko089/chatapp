import type { ChatMessage, ToolInvocation } from '../types';

export function computeAssistantToolCounts(messages: ChatMessage[], toolHistory: ToolInvocation[]): number[] {
  const assistantMessages = messages.filter((msg) => msg.role === 'assistant');
  if (assistantMessages.length === 0) {
    return [];
  }

  if (toolHistory.length === 0) {
    return new Array(assistantMessages.length).fill(0);
  }

  const assistantTimeline = assistantMessages
    .map((msg, idx) => ({ idx, timestamp: parseTimestampSafely(msg.timestamp, idx) }))
    .sort((a, b) => a.timestamp - b.timestamp || a.idx - b.idx);

  const counts = new Array(assistantMessages.length).fill(0);

  const toolTimeline = toolHistory
    .map((tool, idx) => ({ idx, timestamp: parseTimestampSafely(tool.timestamp, -1_000_000 + idx) }))
    .sort((a, b) => a.timestamp - b.timestamp || a.idx - b.idx);

  for (const entry of toolTimeline) {
    const target = assistantTimeline.find((assistant) => entry.timestamp <= assistant.timestamp)
      ?? assistantTimeline[assistantTimeline.length - 1];
    counts[target.idx] += 1;
  }

  return counts;
}

export function parseTimestampSafely(value: string | undefined, fallback: number): number {
  if (value) {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return fallback;
}

