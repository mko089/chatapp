import type { ToolInvocation, BudgetRecord, BudgetEvaluation } from '../../types';
import type { BudgetFormState } from '../../components/BudgetDrawer';
import type { RunEditorState } from '../../hooks/useToolRunner';
import type { Dispatch, SetStateAction } from 'react';

export type PromptOptions = {
  open: boolean;
  onClose: () => void;
  systemText?: string;
  buildPreview: () => string;
};

export type TracesOptions = {
  open: boolean;
  onClose: () => void;
  loading: boolean;
  error: string | null;
  items: ToolInvocation[] | any[];
  refresh: () => void;
};

export type HistoryOptions = {
  open: boolean;
  items: ToolInvocation[];
  onClose: () => void;
  onInspect: (entry: ToolInvocation) => void;
};

export type ToolRunOptions = {
  open: boolean;
  onClose: () => void;
  selected: ToolInvocation | null;
  editor: RunEditorState;
  setEditor: Dispatch<SetStateAction<RunEditorState>>;
  onRun: () => void;
  formatArgs: (args: unknown) => string;
  formatResult: (result: unknown) => string;
};

export type ToolAccessOptions = {
  enabled: boolean;
  open: boolean;
  onClose: () => void;
};

export type BudgetOptions = {
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
