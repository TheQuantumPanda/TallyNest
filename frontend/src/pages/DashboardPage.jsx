import { useState } from 'react';
import { Plus, RefreshCw, ArrowDownLeft, ArrowUpRight } from 'lucide-react';
import { PageTransition } from '../components/ui/PageTransition';
import { Notice } from '../components/ui/Notice';
import { Button } from '../components/ui/Button';
import { TransactionForm } from '../components/transactions/TransactionForm';
import {
  SummaryCard,
  CashFlowPanel,
  SpendingBreakdown,
  RecentTransactions,
  DashboardEmptyState,
  DashboardSkeleton,
} from '../components/dashboard/DashboardPanels';
import { useDashboard } from '../hooks/useDashboard';
import { DASHBOARD_PERIODS, plotRatio } from '../../../shared/dashboard.js';
import { percentageText } from '../utils/dashboard';
import { displayDate, formatINR } from '../utils/transactions';

export function DashboardPage() {
  const [period, setPeriod] = useState('this_month');
  const [adding, setAdding] = useState(false);
  const [message, setMessage] = useState('');
  const { summary, loading, error, reload } = useDashboard(period);
  const totals = summary?.totals;
  const largest = totals ? Math.max(totals.incomeMinor, totals.expenseMinor) : 0;
  const share = totals ? percentageText(totals.expenseMinor, totals.incomeMinor) : null;
  function saved() {
    setAdding(false);
    setMessage('Transaction added. Your overview is refreshing.');
    reload();
  }
  return (
    <PageTransition className="dashboard-page">
      <div className="page-heading dashboard-heading">
        <div>
          <span className="eyebrow">
            <span className="status-dot" />
            YOUR MONEY, IN PERSPECTIVE
          </span>
          <h1>
            Your financial overview<span className="heading-dot">.</span>
          </h1>
          <p>A grounded view of what came in and what went out.</p>
        </div>
        <Button onClick={() => setAdding(true)}>
          <Plus size={18} aria-hidden="true" />
          Add transaction
        </Button>
      </div>
      <div className="dashboard-toolbar">
        <div className="period-control">
          <label htmlFor="dashboard-period">Reporting period</label>
          <select
            id="dashboard-period"
            value={period}
            onChange={(event) => {
              setPeriod(event.target.value);
              setMessage('');
            }}
          >
            {DASHBOARD_PERIODS.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </div>
        <span className="reporting-note">UTC calendar periods · INR</span>
        <button
          className="icon-button"
          aria-label="Refresh dashboard"
          onClick={reload}
          disabled={loading}
        >
          <RefreshCw size={16} />
        </button>
      </div>
      {message && <Notice tone="success">{message}</Notice>}
      {loading ? (
        <DashboardSkeleton />
      ) : error ? (
        <div className="dashboard-error surface">
          <Notice>
            {error.response?.status === 422
              ? 'These totals cannot be safely displayed. Review your records or select another period.'
              : 'Your overview could not be loaded. Please try again.'}
          </Notice>
          <Button variant="ghost" onClick={reload}>
            Try again
          </Button>
        </div>
      ) : (
        summary && (
          <>
            <div className="dashboard-period-label">
              {displayDate(summary.period.from)} —{' '}
              {displayDate(new Date(new Date(summary.period.to).getTime() - 1).toISOString())}
              <span>
                {totals.transactionCount} recorded{' '}
                {totals.transactionCount === 1 ? 'entry' : 'entries'}
              </span>
            </div>
            <div className="dashboard-summary">
              <SummaryCard
                label="Net cash flow"
                value={totals.netMinor}
                note="Recorded income minus recorded expenses"
                tone="net"
              />
              <SummaryCard
                label="Total income"
                value={totals.incomeMinor}
                note="Personal income in this period"
                tone="income"
              />
              <SummaryCard
                label="Total expenses"
                value={totals.expenseMinor}
                note="Personal spending in this period"
                tone="expense"
              />
            </div>
            <p className="balance-clarification">
              Based on your transaction records. This is cash flow, not a verified bank balance.
            </p>
            {!totals.transactionCount && <DashboardEmptyState onAdd={() => setAdding(true)} />}
            {totals.transactionCount > 0 && (
              <>
                <section className="income-comparison surface" aria-label="Income versus spending">
                  <div>
                    <h2>Income & spending</h2>
                    <p>
                      {share
                        ? `Expenses were approximately ${share} of recorded income.`
                        : 'Record income to compare spending against it.'}
                    </p>
                  </div>
                  <div className="comparison-bars">
                    <div>
                      <span>
                        <ArrowDownLeft size={13} />
                        Income
                      </span>
                      <i>
                        <b style={{ width: `${plotRatio(totals.incomeMinor, largest) / 100}%` }} />
                      </i>
                      <strong>{formatINR(totals.incomeMinor)}</strong>
                    </div>
                    <div>
                      <span>
                        <ArrowUpRight size={13} />
                        Expenses
                      </span>
                      <i>
                        <b style={{ width: `${plotRatio(totals.expenseMinor, largest) / 100}%` }} />
                      </i>
                      <strong>{formatINR(totals.expenseMinor)}</strong>
                    </div>
                  </div>
                </section>
                <div className="dashboard-charts-grid">
                  <CashFlowPanel summary={summary} />
                  <SpendingBreakdown summary={summary} />
                </div>
                <RecentTransactions rows={summary.recentTransactions} />
              </>
            )}
          </>
        )
      )}
      {adding && (
        <TransactionForm
          onClose={() => setAdding(false)}
          onReview={() => {
            setAdding(false);
            reload();
          }}
          onSaved={saved}
        />
      )}
    </PageTransition>
  );
}
