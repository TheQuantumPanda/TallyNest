import { amountMinorSchema } from '../validators/transaction.validator.js';
import { splitSchema } from '../validators/group-expense.validator.js';
const compareIds = (a, b) => a < b ? -1 : a > b ? 1 : 0;
export function allocateSplit(amountMinor, input) {
  amountMinorSchema.parse(amountMinor);
  const split = splitSchema.parse(input), total = BigInt(amountMinor);
  const rows = split.participants.map(row => typeof row === 'string' ? { user: row } : { ...row }).sort((a, b) => compareIds(a.user, b.user));
  if (split.method === 'exact') {
    if (rows.reduce((sum, row) => sum + BigInt(row.amountMinor), 0n) !== total) throw new RangeError('Exact shares must total the expense amount');
  } else if (split.method === 'equal') {
    const count = BigInt(rows.length), quotient = total / count, remainder = total % count;
    for (let i = 0; i < rows.length; i++) rows[i].amountMinor = Number(quotient + (BigInt(i) < remainder ? 1n : 0n));
  } else {
    let allocated = 0n;
    const weighted = rows.map(row => {
      const numerator = total * BigInt(row.basisPoints), floor = numerator / 10000n;
      row.amountMinor = Number(floor); allocated += floor;
      return { row, remainder: numerator % 10000n };
    }).sort((a, b) => a.remainder === b.remainder ? compareIds(a.row.user, b.row.user) : a.remainder > b.remainder ? -1 : 1);
    const leftover = total - allocated;
    for (let i = 0; BigInt(i) < leftover; i++) weighted[i].row.amountMinor++;
  }
  for (const row of rows) amountMinorSchema.parse(row.amountMinor);
  const canonicalSplit = { method: split.method, participants: rows.map(row => split.method === 'equal' ? row.user : split.method === 'exact' ? { user: row.user, amountMinor: row.amountMinor } : { user: row.user, basisPoints: row.basisPoints }) };
  return { split: canonicalSplit, shares: rows.map(({ user, amountMinor }) => ({ user, amountMinor })) };
}
