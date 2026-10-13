import { formatMoney } from '../../../shared/money.js';
import { plotRatio, percentageText } from '../../../shared/dashboard.js';
export { percentageText };
export function cashFlowPlot(points) {
  const maximum = Math.max(
    0,
    ...points.flatMap((point) => [point.incomeMinor, point.expenseMinor]),
  );
  return {
    maximum,
    points: points.map((point) => ({
      ...point,
      incomePlot: plotRatio(point.incomeMinor, maximum),
      expensePlot: plotRatio(point.expenseMinor, maximum),
    })),
  };
}
export function axisMoney(maximum, tick) {
  const minor = (BigInt(maximum) * BigInt(tick) + 5000n) / 10000n;
  const rupees = minor / 100n;
  for (const [scale, suffix] of [
    [1000000000000n, 'T'],
    [1000000000n, 'B'],
    [10000000n, 'cr'],
    [100000n, 'L'],
    [1000n, 'k'],
  ]) {
    if (rupees >= scale)
      return `₹${rupees / scale}${((rupees % scale) * 10n) / scale ? '.' + ((rupees % scale) * 10n) / scale : ''}${suffix}`;
  }
  return formatMoney(Number(minor));
}
export function bucketLabel(value, grouping) {
  return new Intl.DateTimeFormat('en-IN', {
    ...(grouping === 'month' ? { month: 'short' } : { day: 'numeric', month: 'short' }),
    timeZone: 'UTC',
  }).format(new Date(value));
}
