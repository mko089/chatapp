import { useEffect, useState, type Dispatch, type SetStateAction } from 'react';
import type { ToolInfo } from '../types';

export function useOverlayState(params: { adminAccess: boolean }) {
  const { adminAccess } = params;

  const [historyOpen, setHistoryOpen] = useState(false);
  const [promptOpen, setPromptOpen] = useState(false);
  const [toolAccessOpen, setToolAccessOpen] = useState(false);
  const [selectedToolInfo, setSelectedToolInfo] = useState<ToolInfo | null>(null);

  useEffect(() => {
    if (!adminAccess && toolAccessOpen) {
      setToolAccessOpen(false);
    }
  }, [adminAccess, toolAccessOpen]);

  return {
    historyOpen,
    setHistoryOpen,
    openHistory: () => setHistoryOpen(true),
    closeHistory: () => setHistoryOpen(false),
    promptOpen,
    openPrompt: () => setPromptOpen(true),
    closePrompt: () => setPromptOpen(false),
    toolAccessOpen,
    openToolAccess: () => setToolAccessOpen(true),
    closeToolAccess: () => setToolAccessOpen(false),
    setToolAccessOpen: setToolAccessOpen as Dispatch<SetStateAction<boolean>>,
    selectedToolInfo,
    setSelectedToolInfo,
    clearSelectedToolInfo: () => setSelectedToolInfo(null),
  } as const;
}

