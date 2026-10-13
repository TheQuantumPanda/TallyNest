import { useEffect, useRef, useState } from 'react';
import { Dialog } from '../ui/Dialog';
import { Button } from '../ui/Button';
import { Notice } from '../ui/Notice';
import { BudgetForm } from './BudgetForm';
import { budgetService } from '../../services/budgets';
import { budgetError, monthLabel } from '../../utils/budgets';
import { categoryLabel, formatINR } from '../../utils/transactions';

function DeleteBudget({ row, onClose, onSaved, onUnavailable, returnFocus }) {
  const [pending, setPending] = useState(false),
    [error, setError] = useState('');
  const busy = useRef(false);
  async function remove() {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    setError('');
    try {
      await budgetService.remove(row.id);
      onSaved('Budget deleted. Your expenses are unchanged.');
    } catch (err) {
      if (err.response?.status === 404) onUnavailable(budgetError(err));
      else setError(budgetError(err));
    } finally {
      busy.current = false;
      setPending(false);
    }
  }
  return (
    <Dialog title="Delete this budget?" onClose={onClose} busy={pending} returnFocus={returnFocus}>
      <p className="dialog-description">
        {categoryLabel(row.category)} · {monthLabel(row.month)} · {formatINR(row.limitMinor)}
      </p>
      <p className="delete-description">
        This permanently removes this monthly limit. Expense transactions will remain, and spending
        in this category will be shown as unbudgeted.
      </p>
      {error && <Notice>{error}</Notice>}
      <div className="dialog-actions">
        <Button variant="ghost" onClick={onClose} disabled={pending}>
          Keep budget
        </Button>
        <Button className="button-danger" onClick={remove} loading={pending}>
          {pending ? 'Deleting…' : 'Delete budget'}
        </Button>
      </div>
    </Dialog>
  );
}
export function BudgetOverlay({ selected, configured, onClose, onSaved, onUnavailable }) {
  const [record, setRecord] = useState(null),
    [revision, setRevision] = useState(0),
    [cycle, setCycle] = useState(0);
  const [error, setError] = useState('');
  useEffect(() => {
    if (selected.mode !== 'edit') return;
    const controller = new AbortController();
    budgetService.get(selected.row.id, controller.signal).then(
      (value) => {
        if (!controller.signal.aborted) {
          setRecord(value);
          setError('');
        }
      },
      (err) => {
        if (!controller.signal.aborted) setError(budgetError(err));
      },
    );
    return () => controller.abort();
  }, [selected, cycle]);
  const props = { onClose, onSaved, returnFocus: selected.trigger };
  if (selected.mode === 'add')
    return (
      <BudgetForm
        {...props}
        month={selected.month}
        category={selected.category}
        configured={configured}
      />
    );
  if (selected.mode === 'delete')
    return <DeleteBudget {...props} row={selected.row} onUnavailable={onUnavailable} />;
  if (!record)
    return (
      <Dialog title="Edit budget" onClose={onClose} returnFocus={selected.trigger}>
        {error ? (
          <Notice>{error}</Notice>
        ) : (
          <p role="status" className="dialog-description">
            Loading latest budget…
          </p>
        )}
        <div className="dialog-actions">
          {error && (
            <Button
              onClick={() => {
                setError('');
                setCycle((value) => value + 1);
              }}
            >
              Retry
            </Button>
          )}
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
        </div>
      </Dialog>
    );
  return (
    <BudgetForm
      key={`${record.id}:${record.version}:${revision}`}
      {...props}
      budget={record}
      configured={configured}
      onReload={async () => {
        const latest = await budgetService.get(record.id);
        setRecord(latest);
        setRevision((value) => value + 1);
      }}
    />
  );
}
