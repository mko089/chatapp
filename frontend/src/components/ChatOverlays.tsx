import type { RefObject } from 'react';
import { MobileToolDrawer, MobileSessionDrawer } from './MobileSidebars';
import { ToolDock } from './ToolDock';
import { PromptModal } from './modals/PromptModal';
import { LlmTracesModal } from './modals/LlmTracesModal';
import { HistoryModal } from './modals/HistoryModal';
import { ToolRunModal } from './modals/ToolRunModal';
import { ToolAccessAdminModal } from './ToolAccessAdminModal';
import { BudgetDrawer, type BudgetFormState } from './BudgetDrawer';
import type { ToolGroupInfo, ToolInfo, ToolInvocation, SessionSummary, BudgetRecord, BudgetEvaluation } from '../types';
import type { RunEditorState } from '../hooks/useToolRunner';

export type LlmTraceEntry = {
  id: string;
  route: string;
  phase: string;
  model: string | null;
  iteration: number | null;
  status: string | null;
  meta: any;
  payload: any;
  occurredAt: string;
};

export type MobileToolDrawerConfig = {
  open: boolean;
  onClose: () => void;
  groups: ToolGroupInfo[];
  history: ToolInvocation[];
  favorites: string[];
  onToggleFavorite: (key: string) => void;
  onSelectTool: (tool: ToolInfo) => void;
  searchRef: RefObject<HTMLInputElement>;
};

export type MobileSessionDrawerConfig = {
  open: boolean;
  onClose: () => void;
  isSuperAdmin: boolean;
  sessionFilter: string;
  onSessionFilterChange: (value: string) => void;
  availableSessionOwners: string[];
  currentUserId: string;
  onCreateNewSession: () => void | Promise<void>;
  sessions: SessionSummary[];
  activeSessionId: string | null;
  isLoading: boolean;
  error: string | null;
  onSelectSession: (id: string) => void | Promise<void>;
  onDeleteSession: (id: string) => void | Promise<void>;
};

export type PromptModalConfig = {
  open: boolean;
  onClose: () => void;
  systemText: string;
  contextPreview: string;
  onCopy: () => void;
};

export type LlmTracesModalConfig = {
  open: boolean;
  onClose: () => void;
  sessionId: string | null;
  loading: boolean;
  error: string | null;
  items: LlmTraceEntry[];
  onRefresh: () => void;
  traceLink: string;
  formatJson: (value: unknown) => string;
};

export type HistoryModalConfig = {
  open: boolean;
  items: ToolInvocation[];
  onClose: () => void;
  onInspect: (entry: ToolInvocation) => void;
};

export type ToolRunModalConfig = {
  open: boolean;
  onClose: () => void;
  selected: ToolInvocation | null;
  editor: RunEditorState;
  setEditor: (next: RunEditorState) => void;
  onRun: () => void;
  formatArgs?: (args: unknown) => string;
  formatResult?: (result: unknown) => string;
};

export type ToolInfoOverlayConfig = {
  tool: ToolInfo | null;
  onClose: () => void;
};

export type ToolAccessModalConfig = {
  enabled: boolean;
  open: boolean;
  onClose: () => void;
  baseUrl: string;
};

export type BudgetDrawerConfig = {
  enabled: boolean;
  open: boolean;
  onClose: () => void;
  budgets: BudgetRecord[];
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
  onCreate: (input: BudgetFormState) => Promise<void>;
  onDelete: (budget: BudgetRecord) => Promise<void>;
  evaluation: BudgetEvaluation | null;
};

export type ChatOverlaysProps = {
  mobileToolDrawer: MobileToolDrawerConfig;
  mobileSessionDrawer: MobileSessionDrawerConfig;
  promptModal: PromptModalConfig;
  llmTracesModal: LlmTracesModalConfig;
  historyModal: HistoryModalConfig;
  toolRunModal: ToolRunModalConfig;
  selectedToolInfo: ToolInfoOverlayConfig;
  toolAccessModal: ToolAccessModalConfig;
  budgetDrawer: BudgetDrawerConfig;
};

export function ChatOverlays(props: ChatOverlaysProps) {
  const {
    mobileToolDrawer,
    mobileSessionDrawer,
    promptModal,
    llmTracesModal,
    historyModal,
    toolRunModal,
    selectedToolInfo,
    toolAccessModal,
    budgetDrawer,
  } = props;

  return (
    <>
      <MobileToolDrawer open={mobileToolDrawer.open} onClose={mobileToolDrawer.onClose}>
        <ToolDock
          open
          groups={mobileToolDrawer.groups}
          history={mobileToolDrawer.history}
          favorites={mobileToolDrawer.favorites}
          onToggleFavorite={mobileToolDrawer.onToggleFavorite}
          onSelectTool={mobileToolDrawer.onSelectTool}
          searchRef={mobileToolDrawer.searchRef}
        />
      </MobileToolDrawer>

      <MobileSessionDrawer
        open={mobileSessionDrawer.open}
        onClose={mobileSessionDrawer.onClose}
        isSuperAdmin={mobileSessionDrawer.isSuperAdmin}
        sessionFilter={mobileSessionDrawer.sessionFilter}
        onSessionFilterChange={mobileSessionDrawer.onSessionFilterChange}
        availableSessionOwners={mobileSessionDrawer.availableSessionOwners}
        currentUserId={mobileSessionDrawer.currentUserId}
        onCreateNewSession={mobileSessionDrawer.onCreateNewSession}
        sessions={mobileSessionDrawer.sessions}
        activeSessionId={mobileSessionDrawer.activeSessionId}
        isLoading={mobileSessionDrawer.isLoading}
        error={mobileSessionDrawer.error}
        onSelectSession={mobileSessionDrawer.onSelectSession}
        onDeleteSession={mobileSessionDrawer.onDeleteSession}
      />

      <PromptModal
        open={promptModal.open}
        onClose={promptModal.onClose}
        systemText={promptModal.systemText}
        contextPreview={promptModal.contextPreview}
        onCopy={promptModal.onCopy}
      />

      <LlmTracesModal
        open={llmTracesModal.open}
        onClose={llmTracesModal.onClose}
        sessionId={llmTracesModal.sessionId}
        loading={llmTracesModal.loading}
        error={llmTracesModal.error}
        items={llmTracesModal.items}
        onRefresh={llmTracesModal.onRefresh}
        traceLink={llmTracesModal.traceLink}
        formatJson={llmTracesModal.formatJson}
      />

      <HistoryModal
        open={historyModal.open}
        items={historyModal.items}
        onClose={historyModal.onClose}
        onInspect={historyModal.onInspect}
      />

      <ToolRunModal
        open={toolRunModal.open}
        onClose={toolRunModal.onClose}
        selected={toolRunModal.selected}
        editor={toolRunModal.editor}
        setEditor={toolRunModal.setEditor}
        onRun={toolRunModal.onRun}
        formatArgs={toolRunModal.formatArgs}
        formatResult={toolRunModal.formatResult}
      />

      {selectedToolInfo.tool ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm" onClick={selectedToolInfo.onClose}>
          <div className="glass-panel w-full max-w-xl overflow-hidden" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-white/5 px-6 py-4">
              <div>
                <div className="text-lg font-semibold text-white">{selectedToolInfo.tool.name}</div>
                <div className="text-sm text-slate-400">Serwer: {selectedToolInfo.tool.serverId}</div>
              </div>
              <button
                type="button"
                className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-sm text-slate-300 hover:border-white/30 hover:bg-white/10"
                onClick={selectedToolInfo.onClose}
              >
                Zamknij
              </button>
            </div>
            <div className="px-6 py-4 text-sm text-slate-200">
              {selectedToolInfo.tool.description ?? 'Brak dodatkowego opisu dla tego narzędzia.'}
            </div>
          </div>
        </div>
      ) : null}

      {toolAccessModal.enabled ? (
        <ToolAccessAdminModal
          open={toolAccessModal.open}
          onClose={toolAccessModal.onClose}
          baseUrl={toolAccessModal.baseUrl}
        />
      ) : null}

      {budgetDrawer.enabled ? (
        <BudgetDrawer
          open={budgetDrawer.open}
          onClose={budgetDrawer.onClose}
          budgets={budgetDrawer.budgets}
          loading={budgetDrawer.loading}
          error={budgetDrawer.error}
          onRefresh={budgetDrawer.onRefresh}
          onCreate={budgetDrawer.onCreate}
          onDelete={budgetDrawer.onDelete}
          evaluation={budgetDrawer.evaluation}
        />
      ) : null}
    </>
  );
}
