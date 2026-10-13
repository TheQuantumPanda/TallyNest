export const DASHBOARD_PERIODS = Object.freeze(
  [
    { id: 'this_month', label: 'This month', grouping: 'day' },
    { id: 'last_month', label: 'Last month', grouping: 'day' },
    { id: 'last_3_months', label: 'Last 3 months', grouping: 'week' },
    { id: 'this_year', label: 'This year', grouping: 'month' },
  ].map(Object.freeze),
);

// Geometry and approximate shares only. Monetary sums never pass through floats.
export function plotRatio(value, maximum) {
  if (
    !Number.isSafeInteger(value) ||
    value < 0 ||
    !Number.isSafeInteger(maximum) ||
    maximum < value
  )
    throw new RangeError('Invalid ratio');
  return maximum === 0
    ? 0
    : Number((BigInt(value) * 10000n + BigInt(maximum) / 2n) / BigInt(maximum));
}
export function shareText(basisPoints) {
  if (!Number.isSafeInteger(basisPoints) || basisPoints < 0 || basisPoints > 10000)
    throw new RangeError('Invalid share');
  return basisPoints === 0
    ? '<0.01%'
    : `${Math.floor(basisPoints / 100)}.${String(basisPoints % 100).padStart(2, '0')}%`;
}
export function percentageText(numerator, denominator) {
  if (
    !Number.isSafeInteger(numerator) ||
    numerator < 0 ||
    !Number.isSafeInteger(denominator) ||
    denominator < 0
  )
    throw new RangeError('Invalid ratio');
  if (denominator === 0) return null;
  const points = (BigInt(numerator) * 10000n + BigInt(denominator) / 2n) / BigInt(denominator);
  return `${points / 100n}.${String(points % 100n).padStart(2, '0')}%`;
}
export function allocateShares(rows, total) {
  if (
    !Number.isSafeInteger(total) ||
    total < 0 ||
    rows.some((row) => !Number.isSafeInteger(row.amountMinor) || row.amountMinor <= 0) ||
    rows.reduce((sum, row) => sum + BigInt(row.amountMinor), 0n) !== BigInt(total)
  )
    throw new RangeError('Shares must reconcile with a safe total');
  const denominator = BigInt(total);
  if (denominator === 0n) return [];
  const shares = rows.map((row) => ({
    ...row,
    shareBasisPoints: Number((BigInt(row.amountMinor) * 10000n) / denominator),
    remainder: (BigInt(row.amountMinor) * 10000n) % denominator,
  }));
  let remaining = 10000 - shares.reduce((sum, row) => sum + row.shareBasisPoints, 0);
  const ranked = [...shares].sort((a, b) =>
    a.remainder === b.remainder
      ? a.category.localeCompare(b.category)
      : a.remainder > b.remainder
        ? -1
        : 1,
  );
  for (const row of ranked) {
    if (remaining-- <= 0) break;
    row.shareBasisPoints += 1;
  }
  return shares.map(({ remainder: _remainder, ...row }) => row);
}
