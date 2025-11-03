import { useMemo } from 'react';
import type { LlmTracesModalConfig } from '../../components/ChatOverlays';
import { formatStructuredValue } from '../../utils/format';
import type { TracesOptions } from './types';

export function useTracesModalConfig(
  baseUrl: string,
  sessionId: string | null,
  options: TracesOptions,
): LlmTracesModalConfig {
  const { open, onClose, loading, error, items, refresh } = options;

  return useMemo(
    () => ({
      open,
      onClose,
      sessionId,
      loading,
      error,
      items: items as any,
      onRefresh: () => refresh(),
      traceLink: sessionId
        ? `${baseUrl}/admin/llm-traces?sessionId=${encodeURIComponent(sessionId)}&limit=200`
        : `${baseUrl}/admin/llm-traces`,
      formatJson: (value) => formatStructuredValue(value, 2, 'null'),
    }),
    [baseUrl, error, items, loading, onClose, open, refresh, sessionId],
  );
}
