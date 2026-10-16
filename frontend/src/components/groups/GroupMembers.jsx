import { Button } from '../ui/Button';
import { displayDate } from '../../utils/transactions';
export function GroupMembers({ group, members, userId, select, disabled }) {
  return (
    <section className="group-panel">
      <div className="group-section-heading">
        <h2>People in this group</h2>
        <span className="category-pill">{members.length} / 100 members</span>
      </div>
      <p className="group-muted">
        Names and stable IDs identify participants. Private email addresses are not shared.
      </p>
      <ul className="group-roster">
        {members.map((m) => (
          <li key={m.id}>
            <div>
              <strong>
                {m.name}
                {m.id === userId ? ' · You' : ''}
              </strong>
              <span className="group-role">
                {m.role === 'owner' ? 'Owner' : 'Member'} · Joined {displayDate(m.joinedAt)}
              </span>
              <small className="group-identity">{m.id}</small>
            </div>
            {group.membership.role === 'owner' && m.role === 'member' && (
              <Button
                variant="ghost"
                disabled={disabled || group.financialHistoryLocked}
                onClick={(e) => select('remove-member', m, e.currentTarget)}
              >
                Remove member
              </Button>
            )}
          </li>
        ))}
      </ul>
      {group.financialHistoryLocked ? (
        <p className="group-policy">
          Financial history permanently prevents removal or departure. Historical attribution must
          remain intact.
        </p>
      ) : group.membership.role === 'member' ? (
        <Button
          variant="ghost"
          disabled={disabled}
          onClick={(e) => select('leave', null, e.currentTarget)}
        >
          Leave group
        </Button>
      ) : (
        <p className="group-muted">
          The sole owner cannot leave or be removed. Ownership transfer is not supported.
        </p>
      )}
    </section>
  );
}
