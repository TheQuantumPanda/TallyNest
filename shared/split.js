// One browser-safe, exact allocation implementation for backend and previews.
function positive(value) {
  if (!Number.isSafeInteger(value) || value <= 0)
    throw new RangeError('Amounts must be positive safe integers');
}
function validateSplit(input) {
  if (
    !input ||
    !['equal', 'exact', 'percentage'].includes(input.method) ||
    !Array.isArray(input.participants) ||
    input.participants.length < 1 ||
    input.participants.length > 100
  )
    throw new RangeError('Invalid split');
  const participants = input.participants.map((row) => {
    const user = input.method === 'equal' ? row : row?.user;
    if (typeof user !== 'string' || !/^[a-f0-9]{24}$/i.test(user))
      throw new RangeError('Invalid participant');
    if (input.method === 'equal') return user.toLowerCase();
    if (input.method === 'exact') {
      positive(row.amountMinor);
      return { user: user.toLowerCase(), amountMinor: row.amountMinor };
    }
    if (!Number.isInteger(row.basisPoints) || row.basisPoints < 1 || row.basisPoints > 10000)
      throw new RangeError('Invalid percentage');
    return { user: user.toLowerCase(), basisPoints: row.basisPoints };
  });
  if (
    new Set(participants.map((row) => (typeof row === 'string' ? row : row.user))).size !==
    participants.length
  )
    throw new RangeError('Duplicate participant');
  if (
    input.method === 'percentage' &&
    participants.reduce((sum, row) => sum + BigInt(row.basisPoints), 0n) !== 10000n
  )
    throw new RangeError('Percentages must total 100%');
  return { method: input.method, participants };
}
const compareIds = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
export function allocateSplit(amountMinor, input) {
  positive(amountMinor);
  const split = validateSplit(input),
    total = BigInt(amountMinor);
  const rows = split.participants
    .map((row) => (typeof row === 'string' ? { user: row } : { ...row }))
    .sort((a, b) => compareIds(a.user, b.user));
  if (split.method === 'exact') {
    if (rows.reduce((sum, row) => sum + BigInt(row.amountMinor), 0n) !== total)
      throw new RangeError('Exact shares must total the expense amount');
  } else if (split.method === 'equal') {
    const count = BigInt(rows.length),
      quotient = total / count,
      remainder = total % count;
    for (let i = 0; i < rows.length; i++)
      rows[i].amountMinor = Number(quotient + (BigInt(i) < remainder ? 1n : 0n));
  } else {
    let allocated = 0n;
    const weighted = rows
      .map((row) => {
        const numerator = total * BigInt(row.basisPoints),
          floor = numerator / 10000n;
        row.amountMinor = Number(floor);
        allocated += floor;
        return { row, remainder: numerator % 10000n };
      })
      .sort((a, b) =>
        a.remainder === b.remainder
          ? compareIds(a.row.user, b.row.user)
          : a.remainder > b.remainder
            ? -1
            : 1,
      );
    const leftover = total - allocated;
    for (let i = 0; BigInt(i) < leftover; i++) weighted[i].row.amountMinor++;
  }
  for (const row of rows) positive(row.amountMinor);
  const canonicalSplit = {
    method: split.method,
    participants: rows.map((row) =>
      split.method === 'equal'
        ? row.user
        : split.method === 'exact'
          ? { user: row.user, amountMinor: row.amountMinor }
          : { user: row.user, basisPoints: row.basisPoints },
    ),
  };
  return {
    split: canonicalSplit,
    shares: rows.map(({ user, amountMinor }) => ({ user, amountMinor })),
  };
}
