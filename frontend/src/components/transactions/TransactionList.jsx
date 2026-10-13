import { ArrowDownLeft, ArrowUpRight, Pencil, Trash2, ReceiptText } from 'lucide-react';
import { categoryLabel, displayDate, formatINR } from '../../utils/transactions';
import { Button } from '../ui/Button';

function Type({ type }) {
  return (
    <span className={`transaction-type ${type}`}>
      {type === 'income' ? (
        <ArrowDownLeft size={14} aria-hidden="true" />
      ) : (
        <ArrowUpRight size={14} aria-hidden="true" />
      )}
      {type === 'income' ? 'Income' : 'Expense'}
    </span>
  );
}
function Actions({ row, onEdit, onDelete }) {
  return (
    <div className="transaction-actions">
      <button className="icon-button" aria-label={`Edit ${row.title}`} onClick={() => onEdit(row)}>
        <Pencil size={15} />
      </button>
      <button
        className="icon-button delete-icon"
        aria-label={`Delete ${row.title}`}
        onClick={() => onDelete(row)}
      >
        <Trash2 size={15} />
      </button>
    </div>
  );
}
export function TransactionList({ rows, onDetails, onEdit, onDelete }) {
  return (
    <>
      <table className="transaction-table">
        <caption className="sr-only">
          Your transactions in the selected order. Dates use UTC.
        </caption>
        <thead>
          <tr>
            <th scope="col">Transaction</th>
            <th scope="col">Category</th>
            <th scope="col">Date</th>
            <th scope="col" className="amount-column">
              Amount
            </th>
            <th scope="col">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              <td>
                <div className="transaction-title-cell">
                  <span className={`transaction-symbol ${row.type}`} aria-hidden="true">
                    {row.type === 'income' ? (
                      <ArrowDownLeft size={19} />
                    ) : (
                      <ArrowUpRight size={19} />
                    )}
                  </span>
                  <div>
                    <button className="transaction-title" onClick={() => onDetails(row)}>
                      {row.title}
                    </button>
                    <Type type={row.type} />
                  </div>
                </div>
              </td>
              <td>
                <span className="category-pill">{categoryLabel(row.category)}</span>
              </td>
              <td className="muted">{displayDate(row.transactionDate)}</td>
              <td className="amount-column">
                <strong className={`transaction-amount ${row.type}`}>
                  {row.type === 'income' ? '+' : '−'}
                  {formatINR(row.amountMinor)}
                </strong>
                <small className="currency-label">{row.currency}</small>
              </td>
              <td>
                <Actions row={row} onEdit={onEdit} onDelete={onDelete} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <ul className="transaction-cards" aria-label="Transactions">
        {rows.map((row) => (
          <li key={row.id}>
            <div className="card-top">
              <button className="transaction-title" onClick={() => onDetails(row)}>
                {row.title}
              </button>
              <strong className={`transaction-amount ${row.type}`}>
                {row.type === 'income' ? '+' : '−'}
                {formatINR(row.amountMinor)}
                <small className="currency-label">{row.currency}</small>
              </strong>
            </div>
            <div className="card-middle">
              <Type type={row.type} />
              <span>{categoryLabel(row.category)}</span>
            </div>
            <div className="card-bottom">
              <time dateTime={row.transactionDate}>{displayDate(row.transactionDate)}</time>
              <Actions row={row} onEdit={onEdit} onDelete={onDelete} />
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}
export function TransactionEmptyState({ filtered, onAdd }) {
  return (
    <div className="transaction-empty">
      <span className="empty-mark">
        <ReceiptText size={27} aria-hidden="true" />
      </span>
      <h2>{filtered ? 'No transactions match this view.' : 'Your ledger starts here.'}</h2>
      <p>
        {filtered
          ? 'Try a different filter or reset your view.'
          : 'Record your first income or expense. Every entry brings a little more clarity.'}
      </p>
      {!filtered && <Button onClick={onAdd}>Add your first transaction</Button>}
    </div>
  );
}
export function TransactionSkeleton() {
  return (
    <div className="transaction-skeleton" role="status" aria-label="Loading transactions">
      <span className="sr-only">Loading transactions…</span>
      {Array.from({ length: 5 }, (_, index) => (
        <div key={index}>
          <span />
          <span />
          <span />
        </div>
      ))}
    </div>
  );
}
