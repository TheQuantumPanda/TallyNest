import {
  ArrowDownLeft,
  ArrowUpRight,
  CalendarClock,
  Pencil,
  Pause,
  Play,
  Trash2,
} from 'lucide-react';
import { Button } from '../ui/Button';
import { categoryLabel, formatINR } from '../../utils/transactions';
import { displayUtc, frequencyLabel } from '../../utils/recurring';

export function RecurringList({ rows, onAction }) {
  const now = new Date().toISOString();
  return (
    <div className="recurring-grid">
      {rows.map((row) => {
        const overdue =
          row.status === 'active' && row.nextOccurrenceDate && row.nextOccurrenceDate < now;
        const IncomeIcon = row.type === 'income' ? ArrowDownLeft : ArrowUpRight;
        return (
          <article
            key={row.id}
            className={`surface recurring-card recurring-${row.status}`}
            aria-label={`${row.title} schedule`}
          >
            <div className="recurring-card-heading">
              <span className={`recurring-kind recurring-${row.type}`}>
                <IncomeIcon size={15} aria-hidden="true" />
                {row.type === 'income' ? 'Income' : 'Expense'} · {categoryLabel(row.category)}
              </span>
              <span className={`recurring-status ${row.exhausted ? 'is-exhausted' : ''}`}>
                {row.status === 'active' ? 'Active' : 'Paused'}
                {row.exhausted ? ' · Exhausted' : ''}
              </span>
            </div>
            <h2>{row.title}</h2>
            <div className="recurring-amount">
              <strong>{formatINR(row.amountMinor)}</strong>
              <span>INR · {frequencyLabel(row.frequency)}</span>
            </div>
            <dl className="recurring-dates">
              <div>
                <dt>{overdue ? 'Overdue · next scheduled' : 'Next scheduled'}</dt>
                <dd>
                  {row.nextOccurrenceDate ? (
                    <time dateTime={row.nextOccurrenceDate}>
                      {displayUtc(row.nextOccurrenceDate)}
                    </time>
                  ) : (
                    'No further eligible dates'
                  )}
                </dd>
              </div>
              {row.endDate && (
                <div>
                  <dt>Ends (inclusive)</dt>
                  <dd>
                    <time dateTime={row.endDate}>{displayUtc(row.endDate)}</time>
                  </dd>
                </div>
              )}
            </dl>
            {row.processing && (
              <p className="recurring-reserved">
                Processing reserved entry · changes may temporarily be blocked.
              </p>
            )}
            <div className="recurring-card-actions">
              <button onClick={() => onAction('edit', row)} aria-label={`Edit ${row.title}`}>
                <Pencil size={15} aria-hidden="true" />
                Edit
              </button>
              <button
                onClick={() => onAction(row.status === 'active' ? 'pause' : 'resume', row)}
                aria-label={`${row.status === 'active' ? 'Pause' : 'Resume'} ${row.title}`}
              >
                {row.status === 'active' ? (
                  <Pause size={15} aria-hidden="true" />
                ) : (
                  <Play size={15} aria-hidden="true" />
                )}
                {row.status === 'active' ? 'Pause' : 'Resume'}
              </button>
              <button onClick={() => onAction('delete', row)} aria-label={`Delete ${row.title}`}>
                <Trash2 size={15} aria-hidden="true" />
                Delete
              </button>
            </div>
          </article>
        );
      })}
    </div>
  );
}
export function RecurringEmpty({ filtered, onAdd }) {
  return (
    <div className="surface recurring-empty">
      <CalendarClock size={28} aria-hidden="true" />
      <div>
        <h2>{filtered ? 'No schedules with this status.' : 'Make room for a steady rhythm.'}</h2>
        <p>
          {filtered
            ? 'Try all schedules, or create a new one.'
            : 'Schedule regular income and expenses. Entries appear in your ledger when due processing completes; no money is moved.'}
        </p>
      </div>
      <Button onClick={onAdd}>Add a schedule</Button>
    </div>
  );
}
export function RecurringSkeleton() {
  return (
    <div role="status" aria-label="Loading schedules" className="recurring-grid">
      <span className="sr-only">Loading schedules…</span>
      {[0, 1, 2, 3].map((id) => (
        <div key={id} className="surface skeleton-row recurring-skeleton">
          <span />
          <span />
        </div>
      ))}
    </div>
  );
}
