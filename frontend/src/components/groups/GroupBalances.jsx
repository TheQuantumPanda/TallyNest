import { Button } from '../ui/Button';
import { formatINR } from '../../utils/transactions';
import { capacity } from '../../utils/groups';
export function GroupBalances({ balances, members, userId, propose, disabled }) {
  const name = (id) => members.find((m) => m.id === id)?.name || id;
  return (
    <section className="group-panel">
      <div className="group-section-heading">
        <div>
          <h2>Where everyone stands</h2>
          <p>Recorded group history, never a bank balance</p>
        </div>
        <Button
          disabled={
            disabled ||
            !capacity(
              balances.members.find((m) => m.user === userId),
              true,
            )
          }
          onClick={propose}
        >
          Propose settlement
        </Button>
      </div>
      <div className="group-positions">
        {balances.members.map((row) => (
          <article key={row.user}>
            <div className="group-section-heading">
              <h3>{name(row.user)}</h3>
              <span className={`group-status ${row.netMinor < 0 ? 'owes' : 'owed'}`}>
                {row.netMinor < 0 ? 'Owes' : row.netMinor > 0 ? 'Is owed' : 'Settled'}
              </span>
            </div>
            <strong className="group-position-value">{formatINR(row.netMinor)}</strong>
            <small className="group-identity">{row.user}</small>
            <dl>
              {[
                ['Paid', row.paidMinor],
                ['Assigned share', row.assignedMinor],
                ['Confirmed sent', row.confirmedSentMinor],
                ['Confirmed received', row.confirmedReceivedMinor],
                ['Pending outgoing', row.pendingSentMinor],
                ['Pending incoming', row.pendingReceivedMinor],
              ].map(([label, value]) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd>{formatINR(value)}</dd>
                </div>
              ))}
            </dl>
          </article>
        ))}
      </div>
      <div className="group-suggestions">
        <h3>Suggested transfers</h3>
        <p className="group-muted">
          Deterministic suggestions do not necessarily minimize transfer count. Pending proposals
          already reserve capacity; these suggestions are not payments.
        </p>
        {balances.suggestions.length ? (
          <ul>
            {balances.suggestions.map((s, i) => (
              <li key={`${s.sender}:${s.recipient}:${i}`}>
                <span>
                  {name(s.sender)} → {name(s.recipient)}
                </span>
                <strong>{formatINR(s.amountMinor)}</strong>
                {s.sender === userId && (
                  <Button
                    variant="ghost"
                    disabled={
                      disabled ||
                      !capacity(
                        balances.members.find((m) => m.user === userId),
                        true,
                      ) ||
                      !capacity(
                        balances.members.find((m) => m.user === s.recipient),
                        false,
                      )
                    }
                    onClick={(e) => propose(e, s)}
                  >
                    Review proposal
                  </Button>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="group-empty">No outstanding transfers according to recorded history.</p>
        )}
      </div>
    </section>
  );
}
