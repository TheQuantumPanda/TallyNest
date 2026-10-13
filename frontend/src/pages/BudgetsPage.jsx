import { useState } from 'react';
import { ChevronLeft, ChevronRight, Plus, RefreshCw } from 'lucide-react';
import { PageTransition } from '../components/ui/PageTransition';
import { Button } from '../components/ui/Button';
import { Field } from '../components/ui/Field';
import { Notice } from '../components/ui/Notice';
import { BudgetOverlay } from '../components/budgets/BudgetOverlay';
import {
  BudgetCard,
  BudgetTotals,
  BudgetEmptyState,
  BudgetSkeleton,
  UnbudgetedSpending,
  BudgetLedgerLink,
  SavedBudgetLimits,
} from '../components/budgets/BudgetOverview';
import { useBudgets } from '../hooks/useBudgets';
import { budgetError, currentUtcMonth, monthLabel, shiftMonth } from '../utils/budgets';

export function BudgetsPage() {
  const [month, setMonth] = useState(currentUtcMonth);
  const data = useBudgets(month);
  const [selected, setSelected] = useState(null),
    [success, setSuccess] = useState(null);
  function open(mode, row, category) {
    setSuccess(null);
    setSelected({ mode, row, category, month, trigger: document.activeElement });
  }
  function saved(message, tone = 'success') {
    setSelected(null);
    setSuccess({ message, tone });
    data.reload();
  }
  return (
    <PageTransition className="budgets-page">
      <div className="page-heading budget-page-heading">
        <div>
          <span className="eyebrow">
            <span className="status-dot" />
            YOUR MONTH, WITH INTENTION
          </span>
          <h1>
            Budgets<span className="heading-dot">.</span>
          </h1>
          <p>A little structure for spending. Room for what matters.</p>
        </div>
        <Button disabled={!data.valid} onClick={() => open('add')}>
          <Plus size={18} aria-hidden="true" />
          Add budget
        </Button>
      </div>
      {success && <Notice tone={success.tone}>{success.message}</Notice>}
      <section className="surface budget-month-toolbar" aria-label="Reporting month selection">
        <div>
          <span className="eyebrow">MONTHLY PERSPECTIVE</span>
          <h2>{data.valid ? monthLabel(month) : 'Choose a month'}</h2>
          <p>UTC calendar month · INR</p>
        </div>
        <div className="budget-month-controls">
          <button
            className="icon-button"
            aria-label="Previous month"
            disabled={!shiftMonth(month, -1)}
            onClick={() => {
              setSuccess(null);
              setMonth(shiftMonth(month, -1));
            }}
          >
            <ChevronLeft size={19} />
          </button>
          <Field
            label="Reporting month"
            id="reporting-month"
            type="month"
            min="0001-01"
            max="9999-12"
            value={month}
            onChange={(event) => {
              setSuccess(null);
              setMonth(event.target.value);
            }}
            error={data.valid ? undefined : 'Choose a valid month (YYYY-MM).'}
          />
          <button
            className="icon-button"
            aria-label="Next month"
            disabled={!shiftMonth(month, 1)}
            onClick={() => {
              setSuccess(null);
              setMonth(shiftMonth(month, 1));
            }}
          >
            <ChevronRight size={19} />
          </button>
          <button
            className="icon-button"
            aria-label="Reload budgets"
            disabled={!data.valid || data.loading}
            onClick={data.reload}
          >
            <RefreshCw size={16} />
          </button>
        </div>
      </section>
      <section aria-label="Monthly budgets" aria-busy={data.loading}>
        {data.loading ? (
          <BudgetSkeleton />
        ) : data.error ? (
          <div className="budget-error">
            <Notice>{budgetError(data.error)}</Notice>
            <Button variant="ghost" onClick={data.reload}>
              Retry summary
            </Button>
            {data.error.response?.status === 422 && (
              <>
                <Button variant="ghost" loading={data.reviewing} onClick={data.reviewLimits}>
                  Review saved limits
                </Button>
                <BudgetLedgerLink />
              </>
            )}
            {data.limitsError && <Notice>{budgetError(data.limitsError)}</Notice>}
            {data.limits && (
              <SavedBudgetLimits
                budgets={data.limits}
                onEdit={(row) => open('edit', row)}
                onDelete={(row) => open('delete', row)}
              />
            )}
          </div>
        ) : (
          data.summary && (
            <>
              <BudgetTotals summary={data.summary} />
              <div className="budget-section-heading">
                <div>
                  <h2>Category limits</h2>
                  <p>
                    {data.summary.counts.budgetCount} configured ·{' '}
                    {data.summary.counts.statuses.over_budget} over limit
                  </p>
                </div>
                <BudgetLedgerLink />
              </div>
              {data.summary.budgets.length ? (
                <div className="budget-grid">
                  {data.summary.budgets.map((row) => (
                    <BudgetCard
                      key={row.id}
                      budget={row}
                      onEdit={() => open('edit', row)}
                      onDelete={() => open('delete', row)}
                    />
                  ))}
                </div>
              ) : (
                <BudgetEmptyState onAdd={() => open('add')} />
              )}
              <UnbudgetedSpending
                summary={data.summary}
                onAdd={(category) => open('add', undefined, category)}
              />
              <p className="budget-consistency">
                A current, best-effort view of your records. Limits and expenses may change between
                reads. Reload to review the latest month.
              </p>
            </>
          )
        )}
      </section>
      {selected && (
        <BudgetOverlay
          selected={selected}
          configured={data.summary?.budgets ?? data.limits ?? []}
          onClose={() => setSelected(null)}
          onSaved={saved}
          onUnavailable={(message) => saved(message, 'error')}
        />
      )}
    </PageTransition>
  );
}
