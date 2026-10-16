import { useEffect, useMemo, useState } from 'react';
import { Plus, RefreshCw, LockKeyhole } from 'lucide-react';
import { PageTransition } from '../components/ui/PageTransition';
import { Button } from '../components/ui/Button';
import { Notice } from '../components/ui/Notice';
import { Dialog } from '../components/ui/Dialog';
import { TransactionForm } from '../components/transactions/TransactionForm';
import { TransactionFilters } from '../components/transactions/TransactionFilters';
import {
  TransactionList,
  TransactionEmptyState,
  TransactionSkeleton,
} from '../components/transactions/TransactionList';
import {
  TransactionDetails,
  DeleteTransaction,
} from '../components/transactions/TransactionDetails';
import { DEFAULT_FILTERS, transactionQuery, transactionError } from '../utils/transactions';
import { transactionService } from '../services/transactions';
import { useDebouncedValue, useTransactions } from '../hooks/useTransactions';

function TransactionOverlay({ selected, onClose, onSaved, onUnavailable, onReview }) {
  const [record, setRecord] = useState(null);
  const [revision, setRevision] = useState(0);
  const [error, setError] = useState('');
  useEffect(() => {
    if (selected.mode === 'add' || selected.mode === 'delete') return;
    const controller = new AbortController();
    transactionService.get(selected.row.id, controller.signal).then(
      (value) => {
        if (!controller.signal.aborted) setRecord(value);
      },
      (err) => {
        if (!controller.signal.aborted) setError(transactionError(err));
      },
    );
    return () => controller.abort();
  }, [selected]);
  if (selected.mode === 'add')
    return <TransactionForm onClose={onClose} onSaved={onSaved} onReview={onReview} />;
  if (selected.mode === 'delete')
    return (
      <DeleteTransaction
        transaction={selected.row}
        onClose={onClose}
        onDeleted={onSaved}
        onUnavailable={onUnavailable}
      />
    );
  if (!record)
    return (
      <Dialog
        title={selected.mode === 'edit' ? 'Edit transaction' : 'Transaction details'}
        onClose={onClose}
      >
        {error ? (
          <Notice>{error}</Notice>
        ) : (
          <p role="status" className="dialog-description">
            Loading transaction…
          </p>
        )}
        <div className="dialog-actions">
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
        </div>
      </Dialog>
    );
  if (selected.mode === 'details')
    return <TransactionDetails transaction={record} onClose={onClose} />;
  return (
    <TransactionForm
      key={`${record.id}:${record.version}:${revision}`}
      transaction={record}
      onClose={onClose}
      onSaved={onSaved}
      onReload={async () => {
        const latest = await transactionService.get(record.id);
        setRecord(latest);
        setRevision((value) => value + 1);
      }}
    />
  );
}
export function TransactionsPage() {
  const [filters, setFilters] = useState({ ...DEFAULT_FILTERS });
  const search = useDebouncedValue(filters.search);
  const { query, errors } = useMemo(() => transactionQuery(filters, search), [filters, search]);
  const valid = Object.keys(errors).length === 0;
  const searchPending = filters.search !== search;
  const ledger = useTransactions(query, valid && !searchPending);
  const [selected, setSelected] = useState(null);
  const [success, setSuccess] = useState(null);
  const filtered = ['type', 'category', 'from', 'to', 'search'].some(
    (key) => filters[key] !== DEFAULT_FILTERS[key],
  );
  function saved(message, tone = 'success') {
    setSelected(null);
    setSuccess({ message, tone });
    ledger.reload();
  }
  function open(mode, row) {
    setSuccess(null);
    setSelected({ mode, row });
  }
  const cursorError = ledger.error?.response?.data?.code === 'INVALID_CURSOR';
  return (
    <PageTransition className="transactions-page">
      <div className="page-heading transaction-page-heading">
        <div>
          <span className="eyebrow">
            <span className="status-dot" />
            YOUR PERSONAL LEDGER
          </span>
          <h1>
            Transactions<span className="heading-dot">.</span>
          </h1>
          <p>The details behind your money. Organized, in one place.</p>
        </div>
        <Button onClick={() => open('add')}>
          <Plus size={18} aria-hidden="true" />
          Add transaction
        </Button>
      </div>
      {success && <Notice tone={success.tone}>{success.message}</Notice>}
      <TransactionFilters values={filters} onChange={setFilters} errors={errors} />
      <section
        className="transaction-ledger surface"
        aria-label="Transaction ledger"
        aria-busy={ledger.loading || searchPending || ledger.more}
      >
        <div className="ledger-heading">
          <div>
            <h2>Your transactions</h2>
            <span>
              {ledger.loading || searchPending
                ? 'Opening your ledger…'
                : `${ledger.rows.length} loaded`}{' '}
              · INR
            </span>
          </div>
          <button
            className="icon-button"
            aria-label="Reload transactions"
            onClick={ledger.reload}
            disabled={ledger.loading || searchPending || !valid}
          >
            <RefreshCw size={16} />
          </button>
        </div>
        {ledger.error && (
          <div className="ledger-error">
            <Notice>
              {cursorError
                ? 'This page link has expired or changed. Reload the list to continue.'
                : transactionError(ledger.error)}
            </Notice>
            <Button variant="ghost" onClick={ledger.reload}>
              Reload list
            </Button>
          </div>
        )}
        {!valid ? (
          <p className="transaction-empty">Adjust the date range to continue.</p>
        ) : ledger.loading || searchPending ? (
          <TransactionSkeleton />
        ) : ledger.rows.length ? (
          <TransactionList
            rows={ledger.rows}
            onDetails={(row) => open('details', row)}
            onEdit={(row) => open('edit', row)}
            onDelete={(row) => open('delete', row)}
          />
        ) : (
          !ledger.error && <TransactionEmptyState filtered={filtered} onAdd={() => open('add')} />
        )}
        {ledger.rows.length > 0 && (
          <div className="ledger-footer">
            <span>
              {ledger.pagination?.hasMore
                ? 'More records are ready when you are.'
                : 'You’re up to date with this view.'}
            </span>
            {ledger.pagination?.hasMore && (
              <Button
                variant="ghost"
                loading={ledger.more}
                disabled={cursorError || !valid}
                onClick={ledger.loadMore}
              >
                {ledger.more ? 'Loading…' : 'Load more'}
              </Button>
            )}
          </div>
        )}
      </section>
      <p className="ledger-privacy">
        <LockKeyhole size={14} aria-hidden="true" />
        Your records are private to your account.
      </p>
      {selected && (
        <TransactionOverlay
          selected={selected}
          onClose={() => setSelected(null)}
          onReview={() => {
            setSelected(null);
            ledger.reload();
          }}
          onSaved={saved}
          onUnavailable={(message) => saved(message, 'error')}
        />
      )}
    </PageTransition>
  );
}
