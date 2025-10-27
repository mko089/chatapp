import { useMemo, useState, type FormEvent } from 'react';
import type { BudgetRecord, BudgetEvaluation } from '../types';

type ScopeType = 'account' | 'role' | 'user';
type PeriodType = 'monthly' | 'daily' | 'rolling_30d';

interface BudgetDrawerProps {
  open: boolean;
  onClose: () => void;
  budgets: BudgetRecord[];
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
  onCreate: (input: BudgetFormState) => Promise<void>;
  onDelete: (budget: BudgetRecord) => Promise<void>;
  evaluation?: BudgetEvaluation | null;
}

export interface BudgetFormState {
  scopeType: ScopeType;
  scopeId: string;
  period: PeriodType;
  limitUsd: number;
  hardLimit: boolean;
  resetDay: number | null;
}

const DEFAULT_FORM: BudgetFormState = {
  scopeType: 'account',
  scopeId: '',
  period: 'monthly',
  limitUsd: 100,
  hardLimit: false,
  resetDay: null,
};

function formatCurrency(valueCents: number, currency = 'USD'): string {
  const amount = valueCents / 100;
  return new Intl.NumberFormat('pl-PL', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
  }).format(amount);
}

export function BudgetDrawer(props: BudgetDrawerProps) {
  const { open, onClose, budgets, loading, error, onRefresh, onCreate, onDelete, evaluation } = props;
  const [formState, setFormState] = useState<BudgetFormState>(DEFAULT_FORM);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const groupedBudgets = useMemo(() => {
    return budgets.reduce<Record<ScopeType, BudgetRecord[]>>(
      (acc, budget) => {
        acc[budget.scopeType] = [...(acc[budget.scopeType] ?? []), budget];
        return acc;
      },
      { account: [], role: [], user: [] },
    );
  }, [budgets]);

  if (!open) {
    return null;
  }

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setFormError(null);
    if (!formState.scopeId.trim()) {
      setFormError('Identyfikator zakresu jest wymagany');
      return;
    }
    if (Number.isNaN(formState.limitUsd) || formState.limitUsd < 0) {
      setFormError('Limit musi być liczbą nieujemną');
      return;
    }
    setIsSubmitting(true);
    try {
      await onCreate({ ...formState, scopeId: formState.scopeId.trim() });
      setFormState(DEFAULT_FORM);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Nie udało się zapisać budżetu');
    } finally {
      setIsSubmitting(false);
    }
  };

  const renderBudgetList = (scopeType: ScopeType) => {
    const list = groupedBudgets[scopeType] ?? [];
    if (list.length === 0) {
      return <div className="budget-empty">Brak budżetów dla tej kategorii.</div>;
    }
    return (
      <div className="budget-list">
        {list.map((budget) => {
          const limitLabel = formatCurrency(budget.limitCents, budget.currency);
          const matches = evaluation?.statuses.find(
            (status) => status.budget.scopeType === budget.scopeType && status.budget.scopeId === budget.scopeId,
          );
          const remainingLabel = matches ? formatCurrency(matches.remainingCents, budget.currency) : null;
          const breached = matches?.hardLimitBreached || matches?.softLimitBreached;
          return (
            <div key={budget.id} className={`budget-entry${breached ? ' budget-entry-warning' : ''}`}>
              <div className="budget-entry-main">
                <div className="budget-entry-title">
                  <strong>{budget.scopeId}</strong>
                  <span>{budget.scopeType}</span>
                  <span>{budget.period}</span>
                  {budget.resetDay ? <span>reset {budget.resetDay} dzień</span> : null}
                  {budget.hardLimit ? <span className="budget-chip-hard">hard limit</span> : <span className="budget-chip-soft">soft limit</span>}
                </div>
                <div className="budget-entry-meta">
                  <span>Limit: {limitLabel}</span>
                  {remainingLabel ? <span>Pozostało: {remainingLabel}</span> : null}
                </div>
              </div>
              <div className="budget-entry-actions">
                <button type="button" onClick={() => onDelete(budget)}>
                  Usuń
                </button>
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <div className="drawer budget-drawer" onClick={(event) => event.stopPropagation()}>
        <div className="drawer-header">
          <div>
            <div className="drawer-title">Budżety</div>
            <div className="drawer-subtitle">Zarządzaj limitami kosztów dla kont, ról i użytkowników</div>
          </div>
          <button type="button" className="drawer-close" onClick={onClose}>
            ×
          </button>
        </div>

        <div className="budget-toolbar">
          <button type="button" onClick={onRefresh} disabled={loading}>
            Odśwież
          </button>
          {loading ? <span className="budget-status">Ładowanie…</span> : null}
          {error ? <span className="budget-error">{error}</span> : null}
        </div>

        <form className="budget-form" onSubmit={handleSubmit}>
          <div className="budget-form-row">
            <label>
              Zakres
              <select
                value={formState.scopeType}
                onChange={(event) => setFormState((prev) => ({ ...prev, scopeType: event.target.value as ScopeType }))}
              >
                <option value="account">Konto</option>
                <option value="role">Rola</option>
                <option value="user">Użytkownik</option>
              </select>
            </label>
            <label>
              Identyfikator
              <input
                type="text"
                value={formState.scopeId}
                onChange={(event) => setFormState((prev) => ({ ...prev, scopeId: event.target.value }))}
                placeholder="np. 123 lub admin"
              />
            </label>
            <label>
              Okres
              <select
                value={formState.period}
                onChange={(event) => setFormState((prev) => ({ ...prev, period: event.target.value as PeriodType }))}
              >
                <option value="monthly">Miesięczny</option>
                <option value="daily">Dzienny</option>
                <option value="rolling_30d">Ruchome 30 dni</option>
              </select>
            </label>
          </div>
          <div className="budget-form-row">
            <label>
              Limit (USD)
              <input
                type="number"
                min="0"
                step="1"
                value={formState.limitUsd}
                onChange={(event) => setFormState((prev) => ({ ...prev, limitUsd: Number(event.target.value) }))}
              />
            </label>
            <label>
              Reset (dzień)
              <input
                type="number"
                min="1"
                max="28"
                value={formState.resetDay ?? ''}
                onChange={(event) => {
                  const value = event.target.value;
                  setFormState((prev) => ({ ...prev, resetDay: value ? Number(value) : null }));
                }}
                placeholder="opcjonalnie"
              />
            </label>
            <label className="budget-checkbox">
              <input
                type="checkbox"
                checked={formState.hardLimit}
                onChange={(event) => setFormState((prev) => ({ ...prev, hardLimit: event.target.checked }))}
              />
              Hard limit (blokuj po przekroczeniu)
            </label>
            <button type="submit" disabled={isSubmitting}>
              Dodaj / Zapisz
            </button>
          </div>
          {formError ? <div className="budget-error">{formError}</div> : null}
        </form>

        <div className="budget-section">
          <h3>Konta</h3>
          {renderBudgetList('account')}
        </div>
        <div className="budget-section">
          <h3>Role</h3>
          {renderBudgetList('role')}
        </div>
        <div className="budget-section">
          <h3>Użytkownicy</h3>
          {renderBudgetList('user')}
        </div>

        {evaluation ? (
          <div className="budget-evaluation">
            <h3>Aktywne ostrzeżenia</h3>
            {evaluation.hardLimitBreaches.length === 0 && evaluation.softLimitBreaches.length === 0 ? (
              <div className="budget-empty">Brak aktywnych przekroczeń limitów.</div>
            ) : null}
            {evaluation.hardLimitBreaches.map((status) => (
              <div key={`hard-${status.budget.scopeType}-${status.budget.scopeId}`} className="budget-alert budget-alert-hard">
                <strong>
                  {status.budget.scopeType} {status.budget.scopeId}
                </strong>{' '}
                przekroczyło twardy limit. Pozostało {formatCurrency(status.remainingCents, status.budget.currency)}.
              </div>
            ))}
            {evaluation.softLimitBreaches.map((status) => (
              <div key={`soft-${status.budget.scopeType}-${status.budget.scopeId}`} className="budget-alert budget-alert-soft">
                <strong>
                  {status.budget.scopeType} {status.budget.scopeId}
                </strong>{' '}
                przekroczyło miękki limit. Pozostało {formatCurrency(status.remainingCents, status.budget.currency)}.
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
