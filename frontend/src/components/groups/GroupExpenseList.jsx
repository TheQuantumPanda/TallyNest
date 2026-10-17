import { useCallback } from 'react';
import { groupExpensesService } from '../../services/groupExpenses';
import { useGroupPage } from '../../hooks/useGroupData';
import { GroupFeedback, GroupPageMore } from './GroupFeedback';
import { Button } from '../ui/Button';
import { formatINR, categoryLabel, displayDate } from '../../utils/transactions';
export function GroupExpenseList({
  group,
  cycleId,
  service = groupExpensesService,
  members,
  userId,
  revision,
  select,
  disabled,
}) {
  const load = useCallback(
      (query, signal) =>
        cycleId
          ? service.list(group.id, cycleId, query, signal)
          : service.list(group.id, query, signal),
      [group.id, cycleId, service],
    ),
    page = useGroupPage(`${group.id}:${cycleId || 'legacy'}`, load, revision);
  const name = (id) => members.find((m) => m.id === id)?.name || id;
  return (
    <section className="group-panel">
      <div className="group-section-heading">
        <div>
          <h2>Shared expense ledger</h2>
          <p>Recorded obligations · INR · UTC dates{cycleId ? ' · Selected cycle only' : ''}</p>
        </div>
        <Button
          disabled={disabled || group.settlementMode || group.financialBusy || !members.length}
          onClick={(e) => select('add-expense', null, e.currentTarget)}
        >
          Add shared expense
        </Button>
      </div>
      <GroupFeedback {...page} retry={page.reload} />
      {group.settlementMode && (
        <p className="group-policy">
          {cycleId
            ? 'This cycle is frozen or closed. Its expenses are permanently read-only.'
            : 'Settlement mode is permanent. Expense creation, editing and deletion are frozen.'}
        </p>
      )}
      {!page.loading && !page.error && !page.rows.length && (
        <div className="group-empty">
          <h3>No shared expenses yet</h3>
          <p>
            Add a real expense and choose who benefited. Nothing is added to personal financial
            records.
          </p>
        </div>
      )}
      <ul className="group-expenses">
        {page.rows.map((row) => (
          <li className="group-expense" key={row.id}>
            <div className="group-expense-heading">
              <div>
                <h3>{row.title}</h3>
                <p>
                  Paid by {name(row.payer)} · {displayDate(row.expenseDate)}
                </p>
              </div>
              <strong className="group-amount">{formatINR(row.amountMinor)}</strong>
            </div>
            <span className="category-pill">{categoryLabel(row.category)}</span>
            <details>
              <summary>
                {row.shares.length} beneficiaries · {row.split.method} split · View allocation
              </summary>
              <dl>
                {row.shares.map((s) => (
                  <div key={s.user}>
                    <dt>{name(s.user)}</dt>
                    <dd>{formatINR(s.amountMinor)}</dd>
                  </div>
                ))}
              </dl>
              {row.notes && <p className="group-notes">{row.notes}</p>}
              <small className="group-identity">Created by {name(row.creatorId)}</small>
            </details>
            {!group.settlementMode &&
              (group.membership.role === 'owner' || row.creatorId === userId) && (
                <div className="group-actions">
                  <Button
                    variant="ghost"
                    disabled={disabled}
                    onClick={(e) => select('edit-expense', row, e.currentTarget)}
                  >
                    Edit expense
                  </Button>
                  <Button
                    variant="ghost"
                    disabled={disabled}
                    onClick={(e) => select('delete-expense', row, e.currentTarget)}
                  >
                    Delete expense
                  </Button>
                </div>
              )}
          </li>
        ))}
      </ul>
      <GroupPageMore page={page} />
    </section>
  );
}
