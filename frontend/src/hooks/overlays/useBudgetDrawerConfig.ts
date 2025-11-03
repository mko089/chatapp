import { useMemo } from 'react';
import type { BudgetDrawerConfig } from '../../components/ChatOverlays';
import type { BudgetOptions } from './types';

export function useBudgetDrawerConfig(options: BudgetOptions): BudgetDrawerConfig {
  return useMemo(
    () => ({
      enabled: options.enabled,
      open: options.open,
      onClose: options.onClose,
      budgets: options.budgets,
      loading: options.loading,
      error: options.error,
      onRefresh: options.onRefresh,
      onCreate: options.onCreate,
      onDelete: options.onDelete,
      evaluation: options.evaluation,
    }),
    [
      options.budgets,
      options.enabled,
      options.error,
      options.evaluation,
      options.loading,
      options.onClose,
      options.onCreate,
      options.onDelete,
      options.onRefresh,
      options.open,
    ],
  );
}
