import { useMemo } from 'react';
import type { ToolRunModalConfig } from '../../components/ChatOverlays';
import type { ToolRunOptions } from './types';

export function useToolRunModalConfig(options: ToolRunOptions): ToolRunModalConfig {
  return useMemo(
    () => ({
      open: options.open,
      onClose: options.onClose,
      selected: options.selected,
      editor: options.editor,
      setEditor: options.setEditor,
      onRun: options.onRun,
      formatArgs: options.formatArgs,
      formatResult: options.formatResult,
    }),
    [
      options.editor,
      options.formatArgs,
      options.formatResult,
      options.onClose,
      options.onRun,
      options.open,
      options.selected,
      options.setEditor,
    ],
  );
}
