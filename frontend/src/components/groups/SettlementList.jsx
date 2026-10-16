import { useCallback, useState } from 'react';
import { groupSettlementsService } from '../../services/groupSettlements';
import { useGroupPage } from '../../hooks/useGroupData';
import { GroupFeedback, GroupPageMore } from './GroupFeedback';
import { Button } from '../ui/Button';
import { formatINR, displayDate } from '../../utils/transactions';
export function SettlementList({ groupId, members, userId, revision, select, disabled }) {
  const load = useCallback(
      (query, signal) => groupSettlementsService.list(groupId, query, signal),
      [groupId],
    ),
    page = useGroupPage(groupId, load, revision),
    [filter, setFilter] = useState('all');
  const name = (id) => members.find((m) => m.id === id)?.name || id;
  const rows = page.rows.filter(
    (row) =>
      filter === 'all' ||
      (filter === 'incoming'
        ? row.status === 'pending' && row.recipient === userId
        : filter === 'outgoing'
          ? row.status === 'pending' && row.sender === userId
          : row.status === filter),
  );
  return (
    <section className="group-panel">
      <h2>Settlement records</h2>
      <p className="group-muted">
        Only confirmed records change positions. This history is append-only; terminal records have
        no edit, delete or reversal controls.
      </p>
      <div className="group-tabs" aria-label="Loaded settlement records">
        {['all', 'incoming', 'outgoing', 'confirmed', 'rejected'].map((value) => (
          <Button
            key={value}
            variant="ghost"
            aria-pressed={filter === value}
            onClick={() => setFilter(value)}
          >
            {value}
          </Button>
        ))}
      </div>
      <p className="group-muted">
        Views apply to loaded records only. Load more to inspect older history.
      </p>
      <GroupFeedback {...page} retry={page.reload} />
      {!page.loading && !page.error && !rows.length && (
        <p className="group-empty">No matching records on loaded pages.</p>
      )}
      <ul className="group-roster">
        {rows.map((row) => (
          <li key={row.id}>
            <div>
              <strong>
                {name(row.sender)} → {name(row.recipient)}
              </strong>
              <span className="group-role">
                {row.status} · {displayDate(row.createdAt)}
              </span>
              <span className="group-amount">{formatINR(row.amountMinor)}</span>
            </div>
            {row.status === 'pending' && row.recipient === userId && (
              <div className="group-actions">
                <Button
                  variant="ghost"
                  disabled={disabled}
                  onClick={(e) => select('confirm', row, e.currentTarget)}
                >
                  Confirm settlement
                </Button>
                <Button
                  variant="ghost"
                  disabled={disabled}
                  onClick={(e) => select('reject', row, e.currentTarget)}
                >
                  Reject settlement
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
