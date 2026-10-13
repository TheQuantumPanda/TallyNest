import { Component, lazy, Suspense } from 'react';
import { Link } from 'react-router-dom';
import { ArrowDownLeft, ArrowUpRight, ArrowRight, NotebookPen } from 'lucide-react';
import { formatINR, categoryLabel, displayDate } from '../../utils/transactions';
import { bucketLabel } from '../../utils/dashboard';
import { shareText } from '../../../../shared/dashboard.js';
import { Button } from '../ui/Button';
const CashFlowChart = lazy(() =>
  import('./DashboardCharts').then((module) => ({ default: module.CashFlowChart })),
);
const SpendingChart = lazy(() =>
  import('./DashboardCharts').then((module) => ({ default: module.SpendingChart })),
);
class ChartBoundary extends Component {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <p className="chart-fallback" role="status">
        The chart is unavailable. Your exact figures are still available below.
      </p>
    ) : (
      this.props.children
    );
  }
}
export function SummaryCard({ label, value, note, tone }) {
  return (
    <article className={`dashboard-summary-card ${tone || ''}`}>
      <span>{label}</span>
      <strong>{formatINR(value)}</strong>
      <p>{note}</p>
    </article>
  );
}
export function CashFlowPanel({ summary }) {
  return (
    <section className="dashboard-panel surface cash-flow-panel">
      <div className="dashboard-section-heading">
        <div>
          <h2>Cash flow over time</h2>
          <p>
            {summary.period.grouping === 'week'
              ? 'Weekly · Monday starts'
              : summary.period.grouping === 'month'
                ? 'Monthly'
                : 'Daily'}{' '}
            · UTC · approximate axis labels
          </p>
        </div>
        <div className="chart-key">
          <span>Income</span>
          <span>Expenses</span>
        </div>
      </div>
      {summary.totals.transactionCount ? (
        <ChartBoundary key={summary.period.id}>
          <Suspense
            fallback={
              <p className="chart-fallback" role="status">
                Drawing your cash flow…
              </p>
            }
          >
            <CashFlowChart summary={summary} />
          </Suspense>
        </ChartBoundary>
      ) : (
        <p className="chart-fallback">
          Your chart will take shape as you record transactions in this period.
        </p>
      )}
      <details className="cash-data">
        <summary>View exact chart data</summary>
        <table>
          <caption className="sr-only">Exact cash flow values in INR</caption>
          <thead>
            <tr>
              <th>Bucket</th>
              <th>Income</th>
              <th>Expenses</th>
            </tr>
          </thead>
          <tbody>
            {summary.cashFlow.map((point) => (
              <tr key={point.date}>
                <th scope="row">{bucketLabel(point.date, summary.period.grouping)}</th>
                <td>{formatINR(point.incomeMinor)}</td>
                <td>{formatINR(point.expenseMinor)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </section>
  );
}
export function SpendingBreakdown({ summary }) {
  return (
    <section className="dashboard-panel surface spending-panel">
      <div className="dashboard-section-heading">
        <div>
          <h2>Where spending went</h2>
          <p>Expense categories · approximate shares</p>
        </div>
      </div>
      {summary.spending.length ? (
        <>
          <div className="spending-visual">
            <ChartBoundary key={summary.period.id}>
              <Suspense
                fallback={
                  <p className="chart-fallback" role="status">
                    Drawing category shares…
                  </p>
                }
              >
                <SpendingChart spending={summary.spending} />
              </Suspense>
            </ChartBoundary>
            <div className="spending-center">
              <span>Recorded expenses</span>
              <strong>{formatINR(summary.totals.expenseMinor)}</strong>
            </div>
          </div>
          <ul className="spending-legend">
            {summary.spending.map((row, index) => (
              <li key={row.category}>
                <span className={`category-swatch swatch-${index}`} />
                <span>{categoryLabel(row.category)}</span>
                <div>
                  <strong>{formatINR(row.amountMinor)}</strong>
                  <small>≈ {shareText(row.shareBasisPoints)}</small>
                </div>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <div className="dashboard-panel-empty">
          <NotebookPen size={28} aria-hidden="true" />
          <p>No recorded expenses in this period.</p>
        </div>
      )}
    </section>
  );
}
export function RecentTransactions({ rows }) {
  return (
    <section className="dashboard-panel surface recent-panel">
      <div className="dashboard-section-heading">
        <div>
          <h2>Recent entries</h2>
          <p>Latest in the selected period</p>
        </div>
        <Link to="/app/transactions">
          Open ledger <ArrowRight size={15} aria-hidden="true" />
        </Link>
      </div>
      {rows.length ? (
        <ul>
          {rows.map((row) => (
            <li key={row.id}>
              <span className={`recent-symbol ${row.type}`} aria-hidden="true">
                {row.type === 'income' ? <ArrowDownLeft size={18} /> : <ArrowUpRight size={18} />}
              </span>
              <div>
                <strong>{row.title}</strong>
                <span>
                  {row.type === 'income' ? 'Income' : 'Expense'} · {categoryLabel(row.category)} ·{' '}
                  {displayDate(row.transactionDate)}
                </span>
              </div>
              <b className={row.type}>
                {row.type === 'income' ? '+' : '−'}
                {formatINR(row.amountMinor)}
              </b>
            </li>
          ))}
        </ul>
      ) : (
        <p className="dashboard-panel-empty">Your latest records will appear here.</p>
      )}
    </section>
  );
}
export function DashboardEmptyState({ onAdd }) {
  return (
    <section className="dashboard-empty">
      <span className="empty-mark">
        <NotebookPen size={26} aria-hidden="true" />
      </span>
      <div>
        <h2>Make room for a clearer picture.</h2>
        <p>
          No transactions are recorded in this period. Add an income or expense to see your cash
          flow take shape.
        </p>
      </div>
      <Button onClick={onAdd}>Add your first entry</Button>
      <Link to="/app/transactions" className="empty-ledger-link">
        Open ledger <ArrowRight size={15} aria-hidden="true" />
      </Link>
    </section>
  );
}
export function DashboardSkeleton() {
  return (
    <div className="dashboard-skeleton" role="status" aria-label="Loading dashboard">
      <span className="sr-only">Loading dashboard…</span>
      <div />
      <div />
      <div />
      <section />
    </div>
  );
}
