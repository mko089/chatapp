import { useMemo } from 'react';
import type { ToolAccessModalConfig } from '../../components/ChatOverlays';
import type { ToolAccessOptions } from './types';

export function useToolAccessModalConfig(
  baseUrl: string,
  options: ToolAccessOptions,
): ToolAccessModalConfig {
  return useMemo(
    () => ({
      enabled: options.enabled,
      open: options.open,
      onClose: options.onClose,
      baseUrl,
    }),
    [baseUrl, options.enabled, options.onClose, options.open],
  );
}
