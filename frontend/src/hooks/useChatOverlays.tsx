import { useMemo } from 'react';
import {
  ChatOverlays,
  type MobileSessionDrawerConfig,
  type MobileToolDrawerConfig,
  type ToolInfoOverlayConfig,
} from '../components/ChatOverlays';
import type {
  PromptOptions,
  TracesOptions,
  HistoryOptions,
  ToolRunOptions,
  ToolAccessOptions,
  BudgetOptions,
} from './overlays/types';
import { usePromptModalConfig } from './overlays/usePromptModalConfig';
import { useTracesModalConfig } from './overlays/useTracesModalConfig';
import { useHistoryModalConfig } from './overlays/useHistoryModalConfig';
import { useToolRunModalConfig } from './overlays/useToolRunModalConfig';
import { useToolAccessModalConfig } from './overlays/useToolAccessModalConfig';
import { useBudgetDrawerConfig } from './overlays/useBudgetDrawerConfig';

export type UseChatOverlaysParams = {
  baseUrl: string;
  sessionId: string | null;
  toolDrawer: MobileToolDrawerConfig;
  sessionDrawer: MobileSessionDrawerConfig;
  prompt: PromptOptions;
  traces: TracesOptions;
  history: HistoryOptions;
  toolRun: ToolRunOptions;
  selectedToolInfo: ToolInfoOverlayConfig;
  toolAccess: ToolAccessOptions;
  budget: BudgetOptions;
};

export function useChatOverlays({
  baseUrl,
  sessionId,
  toolDrawer,
  sessionDrawer,
  prompt,
  traces,
  history,
  toolRun,
  selectedToolInfo,
  toolAccess,
  budget,
}: UseChatOverlaysParams) {
  const promptModal = usePromptModalConfig(prompt);
  const llmTracesModal = useTracesModalConfig(baseUrl, sessionId, traces);
  const historyModal = useHistoryModalConfig(history);
  const toolRunModal = useToolRunModalConfig(toolRun);
  const toolAccessModal = useToolAccessModalConfig(baseUrl, toolAccess);
  const budgetDrawer = useBudgetDrawerConfig(budget);

  return useMemo(
    () => (
      <ChatOverlays
        mobileToolDrawer={toolDrawer}
        mobileSessionDrawer={sessionDrawer}
        promptModal={promptModal}
        llmTracesModal={llmTracesModal}
        historyModal={historyModal}
        toolRunModal={toolRunModal}
        selectedToolInfo={selectedToolInfo}
        toolAccessModal={toolAccessModal}
        budgetDrawer={budgetDrawer}
      />
    ),
    [
      budgetDrawer,
      historyModal,
      llmTracesModal,
      promptModal,
      selectedToolInfo,
      sessionDrawer,
      toolAccessModal,
      toolDrawer,
      toolRunModal,
    ],
  );
}
