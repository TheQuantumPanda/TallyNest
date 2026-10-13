import { useRef, useState } from 'react';
import { Dialog } from '../ui/Dialog';
import { Button } from '../ui/Button';
import { Notice } from '../ui/Notice';
import { transactionService } from '../../services/transactions';
import { categoryLabel, displayDate, formatINR, transactionError } from '../../utils/transactions';

export function TransactionDetails({ transaction, onClose }) {
  return (
    <Dialog title="Transaction details" onClose={onClose}>
      <div className="detail-amount">
        <span className="eyebrow">
          {transaction.type.toUpperCase()} · {transaction.currency}
        </span>
        <strong>{formatINR(transaction.amountMinor)}</strong>
      </div>
      <dl className="transaction-details">
        <div>
          <dt>Title</dt>
          <dd>{transaction.title}</dd>
        </div>
        <div>
          <dt>Category</dt>
          <dd>{categoryLabel(transaction.category)}</dd>
        </div>
        <div>
          <dt>Date (UTC)</dt>
          <dd>{displayDate(transaction.transactionDate)}</dd>
        </div>
        <div>
          <dt>Notes</dt>
          <dd className="transaction-notes">{transaction.notes || 'No notes added.'}</dd>
        </div>
      </dl>
      <div className="dialog-actions">
        <Button variant="ghost" onClick={onClose}>
          Done
        </Button>
      </div>
    </Dialog>
  );
}
export function DeleteTransaction({ transaction, onClose, onDeleted, onUnavailable }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const busy = useRef(false);
  async function remove() {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    setError('');
    try {
      await transactionService.remove(transaction.id);
      onDeleted('Transaction deleted.');
    } catch (err) {
      if (err.response?.status === 404) onUnavailable(transactionError(err));
      else setError(transactionError(err));
    } finally {
      busy.current = false;
      setPending(false);
    }
  }
  return (
    <Dialog title="Delete this transaction?" onClose={onClose} busy={pending}>
      <p className="dialog-description">
        “{transaction.title}” · {formatINR(transaction.amountMinor)}
      </p>
      <p className="delete-description">
        This will permanently remove this {transaction.type} from your ledger. It cannot be undone.
      </p>
      {error && <Notice>{error}</Notice>}
      <div className="dialog-actions">
        <Button variant="ghost" onClick={onClose} disabled={pending}>
          Keep transaction
        </Button>
        <Button className="button-danger" onClick={remove} loading={pending}>
          {pending ? 'Deleting…' : 'Delete transaction'}
        </Button>
      </div>
    </Dialog>
  );
}
