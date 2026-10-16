import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, RefreshCw, ArrowUpRight } from 'lucide-react';
import { PageTransition } from '../components/ui/PageTransition';
import { Button } from '../components/ui/Button';
import { Notice } from '../components/ui/Notice';
import {
  RecurringList,
  RecurringEmpty,
  RecurringSkeleton,
} from '../components/recurring/RecurringList';
import { RecurringOverlay } from '../components/recurring/RecurringOverlay';
import { DueProcessing } from '../components/recurring/DueProcessing';
import { useRecurring } from '../hooks/useRecurring';
import { recurringError } from '../utils/recurring';

export function RecurringPage() {
  const [status, setStatus] = useState(''),
    [selected, setSelected] = useState(null),
    [success, setSuccess] = useState(null);
  const data = useRecurring(status);
  useEffect(() => {
    const previous = document.title;
    document.title = 'Recurring · TallyNest';
    return () => {
      document.title = previous;
    };
  }, []);
  function open(mode, row) {
    setSuccess(null);
    setSelected({ mode, row, trigger: document.activeElement });
  }
  function saved(message, tone = 'success') {
    setSelected(null);
    setSuccess({ message, tone });
    data.reload();
  }
  return (
    <PageTransition className="recurring-page">
      <div className="page-heading recurring-page-heading">
        <div>
          <span className="eyebrow">
            <span className="status-dot" />A RHYTHM FOR YOUR RECORDS
          </span>
          <h1>
            Recurring<span className="heading-dot">.</span>
          </h1>
          <p>Scheduled personal income and expenses. Entries, not payments.</p>
        </div>
        <Button onClick={() => open('add')}>
          <Plus size={18} aria-hidden="true" />
          Add schedule
        </Button>
      </div>
      {success && <Notice tone={success.tone}>{success.message}</Notice>}
      <section className="surface recurring-toolbar" aria-label="Schedule filters">
        <div className="field">
          <label htmlFor="recurring-status">Schedule status</label>
          <select
            id="recurring-status"
            value={status}
            onChange={(e) => {
              setSuccess(null);
              setStatus(e.target.value);
            }}
          >
            <option value="">All schedules</option>
            <option value="active">Active</option>
            <option value="paused">Paused</option>
          </select>
        </div>
        <p>
          UTC scheduling · INR
          <br />
          Templates are not counted in financial totals.
        </p>
        <button
          className="icon-button"
          aria-label="Reload schedules"
          onClick={data.reload}
          disabled={data.loading}
        >
          <RefreshCw size={18} />
        </button>
      </section>
      <section aria-label="Recurring schedules" aria-busy={data.loading}>
        {data.loading ? (
          <RecurringSkeleton />
        ) : (
          <>
            {data.error && (
              <div className="recurring-error">
                <Notice>{recurringError(data.error)}</Notice>
                <Button variant="ghost" onClick={data.reload}>
                  Reload list
                </Button>
              </div>
            )}
            {!!data.rows.length && <RecurringList rows={data.rows} onAction={open} />}
            {!data.rows.length && !data.error && (
              <RecurringEmpty filtered={!!status} onAdd={() => open('add')} />
            )}
            {data.pagination?.hasMore && !data.error && (
              <div className="recurring-load-more">
                <Button variant="ghost" loading={data.more} onClick={data.loadMore}>
                  {data.more ? 'Loading more…' : 'Load more schedules'}
                </Button>
              </div>
            )}
          </>
        )}
      </section>
      <DueProcessing onProcessed={data.reload} />
      <div className="recurring-history">
        <div>
          <h2>Completed entries live in your ledger.</h2>
          <p>
            View generated income and expenses alongside manual records. Schedule-specific history
            filtering is not available yet.
          </p>
        </div>
        <Link to="/app/transactions" className="budget-ledger-link">
          Open transaction ledger
          <ArrowUpRight size={16} aria-hidden="true" />
        </Link>
      </div>
      {selected && (
        <RecurringOverlay
          selected={selected}
          onClose={() => setSelected(null)}
          onReview={() => {
            setSelected(null);
            data.reload();
          }}
          onSaved={saved}
          onUnavailable={(message) => saved(message, 'error')}
        />
      )}
    </PageTransition>
  );
}
