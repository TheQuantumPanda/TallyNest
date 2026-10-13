import { Fragment } from 'react';
import { Link } from 'react-router-dom';
import { Pencil, Trash2, Plus, ArrowUpRight, Target } from 'lucide-react';
import { Button } from '../ui/Button';
import { categoryLabel, formatINR } from '../../utils/transactions';
import { BUDGET_STATUSES, utilizationText } from '../../utils/budgets';

function BudgetMoney({ value }) {
  const text = formatINR(value);
  if (text.length <= 16) return text;
  const groups = text.split(',');
  return groups.map((group, index) => (
    <Fragment key={index}>
      <span className="budget-money-part">
        {group}
        {index < groups.length - 1 ? ',' : ''}
      </span>
      {index < groups.length - 1 && <wbr />}
    </Fragment>
  ));
}

export function BudgetTotals({ summary }) {
  const totals = summary.totals;
  return (
    <section className="budget-totals" aria-label="Monthly budget totals">
      {[
        ['Configured limits', totals.budgetLimitMinor, 'Your category allowances for this month.'],
        [
          'Spending under budgets',
          totals.budgetedSpendingMinor,
          'Expenses in configured categories only.',
        ],
        [
          'Remaining allowance',
          totals.remainingMinor,
          'Limit minus spending in configured categories.',
        ],
      ].map(([label, value, hint]) => (
        <div className="surface budget-total" key={label}>
          <span>{label}</span>
          <strong>
            <BudgetMoney value={value} />
          </strong>
          <p>{hint}</p>
        </div>
      ))}
      <p className="budget-total-note">
        Total monthly expenses <strong>{formatINR(totals.expenseMinor)}</strong> · Category
        overspending <strong>{formatINR(totals.overspentMinor)}</strong>. Remaining allowance is not
        a bank balance. Surplus in one category does not cancel overspending in another.
      </p>
    </section>
  );
}
export function BudgetCard({ budget, onEdit, onDelete }) {
  const name = categoryLabel(budget.category),
    percent = utilizationText(budget.utilizationBasisPoints);
  return (
    <article
      className={`surface budget-card budget-${budget.status}`}
      aria-label={`${name} budget`}
    >
      <div className="budget-card-top">
        <div>
          <span className="budget-kind">MONTHLY LIMIT · INR</span>
          <h3>{name}</h3>
        </div>
        <span className="budget-status">{BUDGET_STATUSES[budget.status]}</span>
      </div>
      <div className="budget-spend">
        <span>
          Spent{' '}
          <strong>
            <BudgetMoney value={budget.spentMinor} />
          </strong>
        </span>
        <span>
          Limit{' '}
          <strong>
            <BudgetMoney value={budget.limitMinor} />
          </strong>
        </span>
      </div>
      <div
        className="budget-progress"
        role="progressbar"
        aria-label={`${name} utilization`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.min(10000, budget.utilizationBasisPoints) / 100}
        aria-valuetext={`${percent} of budget used`}
      >
        <span style={{ width: `${Math.min(10000, budget.utilizationBasisPoints) / 100}%` }} />
      </div>
      <div className="budget-remaining">
        <span>{percent} used</span>
        <strong>
          {budget.overspentMinor > 0
            ? `${formatINR(budget.overspentMinor)} over limit`
            : `${formatINR(budget.remainingMinor)} remaining`}
        </strong>
      </div>
      <div className="budget-card-actions">
        <button onClick={onEdit} aria-label={`Edit ${name} budget`}>
          <Pencil size={15} aria-hidden="true" />
          Edit limit
        </button>
        <button onClick={onDelete} aria-label={`Delete ${name} budget`}>
          <Trash2 size={15} aria-hidden="true" />
          Delete
        </button>
      </div>
    </article>
  );
}
export function UnbudgetedSpending({ summary, onAdd }) {
  return (
    <section className="surface unbudgeted-section" aria-labelledby="unbudgeted-title">
      <div className="budget-section-heading">
        <div>
          <span className="eyebrow">OUTSIDE CONFIGURED LIMITS</span>
          <h2 id="unbudgeted-title">Unbudgeted spending</h2>
        </div>
        <strong>{formatINR(summary.totals.unbudgetedSpendingMinor)}</strong>
      </div>
      <p>
        These expenses have no category allowance this month. They are separate from your remaining
        budget.
      </p>
      {summary.unbudgetedCategories.length ? (
        <ul className="unbudgeted-list">
          {summary.unbudgetedCategories.map((row) => (
            <li key={row.category}>
              <span>{categoryLabel(row.category)}</span>
              <strong>{formatINR(row.spentMinor)}</strong>
              <Button
                variant="ghost"
                onClick={() => onAdd(row.category)}
                aria-label={`Create ${categoryLabel(row.category)} budget`}
              >
                <Plus size={15} aria-hidden="true" />
                Set a limit
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="unbudgeted-empty">No unbudgeted expenses recorded for this month.</p>
      )}
    </section>
  );
}
export function BudgetEmptyState({ onAdd }) {
  return (
    <div className="surface budget-empty">
      <Target size={28} aria-hidden="true" />
      <div>
        <h2>Give this month a little direction.</h2>
        <p>
          Set your first category limit. Recorded expenses will show how much you’ve used, without
          changing your transactions.
        </p>
      </div>
      <Button onClick={onAdd}>Set your first budget</Button>
    </div>
  );
}
export function BudgetSkeleton() {
  return (
    <div className="budget-skeleton" role="status" aria-label="Loading budgets">
      <span className="sr-only">Loading your monthly budget overview…</span>
      {[1, 2, 3].map((id) => (
        <div className="surface skeleton-row" key={id}>
          <i />
          <i />
          <i />
        </div>
      ))}
    </div>
  );
}
export function BudgetLedgerLink() {
  return (
    <Link className="budget-ledger-link" to="/app/transactions">
      Manage expense transactions <ArrowUpRight size={16} aria-hidden="true" />
    </Link>
  );
}

export function SavedBudgetLimits({ budgets, onEdit, onDelete }) {
  return (
    <section className="surface unbudgeted-section" aria-label="Saved budget limits">
      <div className="budget-section-heading">
        <div>
          <h2>Review saved limits</h2>
          <p>Spending is unavailable. These are saved limits only.</p>
        </div>
      </div>
      <ul className="saved-budget-limits">
        {budgets.map((row) => (
          <li key={row.id}>
            <div>
              <strong>{categoryLabel(row.category)}</strong>
              <span>
                <BudgetMoney value={row.amountMinor} />
              </span>
            </div>
            <div className="budget-card-actions">
              <button
                onClick={() => onEdit(row)}
                aria-label={`Edit ${categoryLabel(row.category)} budget`}
              >
                Edit limit
              </button>
              <button
                onClick={() => onDelete({ ...row, limitMinor: row.amountMinor })}
                aria-label={`Delete ${categoryLabel(row.category)} budget`}
              >
                Delete
              </button>
            </div>
          </li>
        ))}
      </ul>
      {!budgets.length && (
        <p>No configured limits for this month. Review expense records in the ledger.</p>
      )}
    </section>
  );
}
