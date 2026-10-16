import { categoryLabel, decimalAmount, displayDate, formatINR } from '../../utils/transactions';
export function RecordReview({ record, members = [] }) {
  const name = (id) => members.find((member) => member.id === id)?.name || id;
  const fields =
    record.amountMinor !== undefined
      ? [
          ['Title', record.title],
          ['Amount', formatINR(record.amountMinor)],
          ['Payer', name(record.payer)],
          ['Category', categoryLabel(record.category)],
          ['Date (UTC)', displayDate(record.expenseDate)],
          ['Split method', record.split.method],
          ['Notes', record.notes || 'None'],
        ]
      : [
          ['Group name', record.name],
          ['Description', record.description || 'None'],
          ['Currency', record.currency],
        ];
  return (
    <div className="group-record-review">
      <dl>
        {fields.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      {record.shares && (
        <>
          <h4>Current allocation</h4>
          <ul>
            {record.shares.map((share) => (
              <li key={share.user}>
                {name(share.user)} · {formatINR(share.amountMinor)}
                {record.split.method === 'percentage'
                  ? ` · ${decimalAmount(record.split.participants.find((p) => p.user === share.user).basisPoints)}%`
                  : ''}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
