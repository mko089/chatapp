export function estimateTokensForMessages(messages: Array<{ content?: string | null }>): number {
  const chars = messages.reduce((sum, m) => {
    const c = typeof m?.content === 'string' ? m.content : '';
    return sum + c.length;
  }, 0);
  return Math.ceil(chars / 4);
}

export function resolveMaxContextTokens(model: string | undefined): number {
  const m = (model || '').toLowerCase();
  if (m.includes('nano')) return 8192;
  return 128000;
}

