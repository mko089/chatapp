import { useMemo } from 'react';
import type { HistoryModalConfig } from '../../components/ChatOverlays';
import type { HistoryOptions } from './types';

export function useHistoryModalConfig(options: HistoryOptions): HistoryModalConfig {
  return useMemo(
    () => ({
      open: options.open,
      items: options.items,
      onClose: options.onClose,
      onInspect: options.onInspect,
    }),
    [options.items, options.onClose, options.onInspect, options.open],
  );
}
