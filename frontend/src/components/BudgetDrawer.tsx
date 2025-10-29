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
      return <div className="rounded-2xl border border-dashed border-white/10 bg-white/5 px-4 py-3 text-sm text-slate-400">Brak budżetów dla tej kategorii.</div>;
    }
    return (
      <div className="space-y-3">
        {list.map((budget) => {
          const limitLabel = formatCurrency(budget.limitCents, budget.currency);
          const matches = evaluation?.statuses.find(
            (status) => status.budget.scopeType === budget.scopeType && status.budget.scopeId === budget.scopeId,
          );
          const remainingLabel = matches ? formatCurrency(matches.remainingCents, budget.currency) : null;
          const breached = matches?.hardLimitBreached || matches?.softLimitBreached;
          return (
            <div
              key={budget.id}
              className={`rounded-2xl border px-5 py-4 transition ${breached ? 'border-danger/60 bg-danger/10' : 'border-white/5 bg-white/5 hover:border-white/15 hover:bg-white/10'}`}
            >
              <div className="flex flex-col gap-2 text-sm text-slate-200">
                <div className="flex flex-wrap items-center gap-2">
                  <strong className="text-white">{budget.scopeId}</strong>
                  <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-xs uppercase tracking-wide text-slate-400">
                    {budget.scopeType}
                  </span>
                  <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-xs uppercase tracking-wide text-slate-400">
                    {budget.period}
                  </span>
                  {budget.resetDay ? (
                    <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-xs uppercase tracking-wide text-slate-400">
                      reset {budget.resetDay}. dnia
                    </span>
                  ) : null}
                  <span className={`rounded-full border px-2 py-0.5 text-xs uppercase tracking-wide ${budget.hardLimit ? 'border-danger/40 bg-danger/15 text-danger' : 'border-primary/40 bg-primary/15 text-primary'}`}>
                    {budget.hardLimit ? 'Hard limit' : 'Soft limit'}
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-4 text-xs text-slate-400">
                  <span>Limit: {limitLabel}</span>
                  {remainingLabel ? <span>Pozostało: {remainingLabel}</span> : null}
                </div>
              </div>
              <div className="mt-3 flex justify-end">
                <button
                  type="button"
                  onClick={() => onDelete(budget)}
                  className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs uppercase tracking-wide text-slate-200 transition hover:border-danger/40 hover:bg-danger/20 hover:text-danger"
                >
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm" onClick={onClose}>
      <div className="glass-panel w-full max-w-4xl overflow-hidden" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-white/5 px-6 py-4">
          <div>
            <div className="text-lg font-semibold text-white">Budżety</div>
            <div className="text-sm text-slate-400">Zarządzaj limitami kosztów dla kont, ról i użytkowników</div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-sm text-slate-300 transition hover:border-white/30 hover:bg-white/10"
          >
            Zamknij
          </button>
        </div>

        <div className="space-y-6 px-6 py-5">
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={onRefresh}
              disabled={loading}
              className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs uppercase tracking-wide text-slate-200 transition hover:border-primary/40 hover:bg-primary/20 hover:text-primary disabled:cursor-not-allowed disabled:opacity-60"
            >
              Odśwież
            </button>
            {loading ? <span className="chip chip-muted">Ładowanie…</span> : null}
            {error ? <span className="rounded-full border border-danger/40 bg-danger/15 px-3 py-1 text-xs text-danger">{error}</span> : null}
          </div>

          <form className="space-y-4" onSubmit={handleSubmit}>
            <div className="grid gap-4 md:grid-cols-3">
              <label className="flex flex-col gap-2 text-sm text-slate-200">
                <span>Zakres</span>
                <select
                  value={formState.scopeType}
                  onChange={(event) => setFormState((prev) => ({ ...prev, scopeType: event.target.value as ScopeType }))}
                  className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white focus:border-primary/40 focus:outline-none focus:ring-2 focus:ring-primary/30"
                >
                  <option value="account">Konto</option>
                  <option value="role">Rola</option>
                  <option value="user">Użytkownik</option>
                </select>
              </label>
              <label className="flex flex-col gap-2 text-sm text-slate-200">
                <span>Identyfikator</span>
                <input
                  type="text"
                  value={formState.scopeId}
                  onChange={(event) => setFormState((prev) => ({ ...prev, scopeId: event.target.value }))}
                  placeholder="np. 123 lub admin"
                  className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:border-primary/40 focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
              </label>
              <label className="flex flex-col gap-2 text-sm text-slate-200">
                <span>Okres</span>
                <select
                  value={formState.period}
                  onChange={(event) => setFormState((prev) => ({ ...prev, period: event.target.value as PeriodType }))}
                  className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white focus:border-primary/40 focus:outline-none focus:ring-2 focus:ring-primary/30"
                >
                  <option value="monthly">Miesięczny</option>
                  <option value="daily">Dzienny</option>
                  <option value="rolling_30d">Ruchome 30 dni</option>
                </select>
              </label>
            </div>
            <div className="grid gap-4 md:grid-cols-3">
              <label className="flex flex-col gap-2 text-sm text-slate-200">
                <span>Limit (USD)</span>
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={formState.limitUsd}
                  onChange={(event) => setFormState((prev) => ({ ...prev, limitUsd: Number(event.target.value) }))}
                  className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white focus:border-primary/40 focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
              </label>
              <label className="flex flex-col gap-2 text-sm text-slate-200">
                <span>Reset (dzień)</span>
                <input
                  type="number"
                  min="1"
                  max="28"
                  value={formState.resetDay ?? ''}
                  onChange={(event) => {
                    const value = event.target.value === '' ? null : Number(event.target.value);
                    setFormState((prev) => ({ ...prev, resetDay: value }));
                  }}
                  placeholder="opcjonalnie"
                  className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:border-primary/40 focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
              </label>
              <label className="flex items-center gap-2 text-sm text-slate-200">
                <input
                  type="checkbox"
                  checked={formState.hardLimit}
                  onChange={(event) => setFormState((prev) => ({ ...prev, hardLimit: event.target.checked }))}
                  className="h-4 w-4 rounded border border-white/10 bg-white/5 text-primary focus:ring-primary/40"
                />
                Hard limit (blokuj po przekroczeniu)
              </label>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3">
              {formError ? (
                <div className="rounded-2xl border border-danger/40 bg-danger/15 px-4 py-2 text-sm text-danger">{formError}</div>
              ) : (
                <span className="text-xs text-slate-500">Dostępne waluty zgodne z konfiguracją konta.</span>
              )}
              <button
                type="submit"
                disabled={isSubmitting}
                className="rounded-full border border-primary/40 bg-primary/20 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-primary transition hover:bg-primary/25 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isSubmitting ? 'Zapisywanie…' : 'Dodaj budżet'}
              </button>
            </div>
          </form>

          <div className="space-y-5">
            <section>
              <div className="text-xs uppercase tracking-wide text-slate-500">Budżety kont</div>
              {renderBudgetList('account')}
            </section>
            <section>
              <div className="text-xs uppercase tracking-wide text-slate-500">Budżety ról</div>
              {renderBudgetList('role')}
            </section>
            <section>
              <div className="text-xs uppercase tracking-wide text-slate-500">Budżety użytkowników</div>
              {renderBudgetList('user')}
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}
