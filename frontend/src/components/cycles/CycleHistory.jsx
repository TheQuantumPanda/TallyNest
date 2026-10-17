import { useCallback } from 'react';
import { useGroupPage } from '../../hooks/useGroupData';
import { cyclesService } from '../../services/cycles';
import { GroupFeedback, GroupPageMore } from '../groups/GroupFeedback';
import { displayCycleUtc } from '../../utils/cycleDates';

export function CycleHistory({ groupId, selectedId, currentId, onSelect, revision }) {
  const load = useCallback(
    (query, signal) => cyclesService.list(groupId, query, signal),
    [groupId],
  );
  const page = useGroupPage(groupId, load, revision);
  return (
    <section className="group-panel" aria-label="Cycle history">
      <h2>Accounting cycles</h2>
      <p className="group-muted">
        Cycles are separate rounds, not calendar months. Selecting history does not change the
        current cycle.
      </p>
      <GroupFeedback {...page} retry={page.reload} />
      {!page.loading && !page.rows.length && (
        <p className="group-empty">No cycle has been opened.</p>
      )}
      <div className="cycle-history-list">
        {page.rows.map((cycle) => (
          <button
            type="button"
            key={cycle.id}
            className="cycle-choice"
            aria-current={selectedId === cycle.id ? 'true' : undefined}
            onClick={() => onSelect(cycle.id)}
          >
            <strong>Cycle {cycle.sequence}</strong>
            <span className="category-pill">
              {cycle.state}
              {currentId === cycle.id ? ' · Current' : ''}
            </span>
            <small>
              Opened <time dateTime={cycle.openedAt}>{displayCycleUtc(cycle.openedAt)}</time>
              {cycle.frozenAt && (
                <>
                  {' · Frozen '}
                  <time dateTime={cycle.frozenAt}>{displayCycleUtc(cycle.frozenAt)}</time>
                </>
              )}
              {cycle.closedAt && (
                <>
                  {' · Closed '}
                  <time dateTime={cycle.closedAt}>{displayCycleUtc(cycle.closedAt)}</time>
                </>
              )}
            </small>
          </button>
        ))}
      </div>
      <GroupPageMore page={page} />
    </section>
  );
}
