import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { MotionConfig } from 'motion/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { DashboardPage } from '../pages/DashboardPage';
import { dashboardService } from '../services/dashboard';
import { transactionService } from '../services/transactions';
import { dashboardFixture } from './fixtures/dashboard';
vi.mock('../services/dashboard', () => ({ dashboardService: { summary: vi.fn() } }));
vi.mock('../services/transactions', () => ({ transactionService: { create: vi.fn() } }));
let chartFails = false;
vi.mock('../components/dashboard/DashboardCharts', () => ({
  CashFlowChart: () => {
    if (chartFails) throw new Error('Visualization failed');
    return <div role="img" aria-label="Cash flow chart" />;
  },
  SpendingChart: () => <div role="img" aria-label="Spending chart" />,
}));
beforeEach(() => {
  vi.resetAllMocks();
  chartFails = false;
  dashboardService.summary.mockResolvedValue(dashboardFixture());
  transactionService.create.mockResolvedValue({});
});
function renderDashboard() {
  const router = createMemoryRouter([
    {
      path: '/',
      element: (
        <MotionConfig reducedMotion="always">
          <DashboardPage />
        </MotionConfig>
      ),
    },
    { path: '/app/transactions', element: <h1>Transaction ledger</h1> },
  ]);
  return render(<RouterProvider router={router} />);
}
it('renders actual summary, comparison, recent transactions and exact chart data', async () => {
  renderDashboard();
  expect(await screen.findByText('₹400.00')).toBeVisible();
  expect(screen.getByText('Net cash flow')).toBeVisible();
  expect(screen.getByText(/not a verified bank balance/)).toBeVisible();
  expect(screen.getByText(/20.00% of recorded income/)).toBeVisible();
  expect(screen.getByText('Lunch')).toBeVisible();
  await userEvent.click(screen.getByText('View exact chart data'));
  expect(screen.getByRole('table', { name: 'Exact cash flow values in INR' })).toBeVisible();
  expect(await screen.findByRole('img', { name: 'Cash flow chart' })).toBeInTheDocument();
});
it('empty accounts show real zero totals, guidance and an add action', async () => {
  dashboardService.summary.mockResolvedValue(dashboardFixture(true));
  renderDashboard();
  expect(
    await screen.findByRole('heading', { name: 'Make room for a clearer picture.' }),
  ).toBeVisible();
  expect(screen.getAllByText('₹0.00').length).toBeGreaterThan(0);
  expect(screen.queryByText('Lunch')).not.toBeInTheDocument();
  expect(screen.queryByRole('img', { name: 'Cash flow chart' })).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Add your first entry' }));
  expect(screen.getByRole('dialog')).toBeVisible();
});
it('shows loading and safe retry states without fake statistics', async () => {
  let fail;
  dashboardService.summary.mockReturnValueOnce(
    new Promise((_resolve, reject) => {
      fail = reject;
    }),
  );
  renderDashboard();
  expect(screen.getByRole('status', { name: 'Loading dashboard' })).toBeInTheDocument();
  expect(screen.queryByText('Net cash flow')).not.toBeInTheDocument();
  await act(() => fail(new Error('internal credentials')));
  expect(screen.getByRole('alert')).not.toHaveTextContent('internal credentials');
  await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
  expect(await screen.findByText('Net cash flow')).toBeVisible();
});
it('period changes use the server selector and ignore stale responses', async () => {
  let first;
  dashboardService.summary
    .mockReturnValueOnce(
      new Promise((resolve) => {
        first = resolve;
      }),
    )
    .mockResolvedValue({
      ...dashboardFixture(),
      totals: { ...dashboardFixture().totals, netMinor: 30000 },
    });
  renderDashboard();
  await userEvent.selectOptions(screen.getByLabelText('Reporting period'), 'last_month');
  expect(await screen.findByText('₹300.00')).toBeVisible();
  expect(dashboardService.summary).toHaveBeenLastCalledWith('last_month', expect.any(AbortSignal));
  await act(() => first(dashboardFixture()));
  expect(screen.queryByText('₹400.00')).not.toBeInTheDocument();
});
it('navigates to the existing ledger', async () => {
  renderDashboard();
  await screen.findByText('Lunch');
  await userEvent.click(screen.getByRole('link', { name: 'Open ledger' }));
  expect(screen.getByRole('heading', { name: 'Transaction ledger' })).toBeVisible();
});
it('reuses the exact add form and refreshes figures after creation', async () => {
  renderDashboard();
  await screen.findByText('Net cash flow');
  await userEvent.click(screen.getByRole('button', { name: 'Add transaction' }));
  const dialog = screen.getByRole('dialog');
  await userEvent.type(within(dialog).getByLabelText('Title'), 'New expense');
  await userEvent.type(within(dialog).getByLabelText('Amount (INR)'), '0.01');
  await userEvent.click(within(dialog).getByRole('button', { name: 'Add transaction' }));
  await waitFor(() => expect(dashboardService.summary).toHaveBeenCalledTimes(2));
  expect(transactionService.create).toHaveBeenCalledWith(
    expect.objectContaining({ amountMinor: 1 }),
  );
});
it('partial chart failures retain totals and exact data', async () => {
  chartFails = true;
  const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
  renderDashboard();
  expect(await screen.findByText(/chart is unavailable/)).toBeVisible();
  expect(screen.getByText('₹400.00')).toBeVisible();
  expect(screen.getByText('View exact chart data')).toBeVisible();
  consoleError.mockRestore();
});
it('unsafe aggregate errors show guidance instead of misleading totals', async () => {
  dashboardService.summary.mockRejectedValue({ response: { status: 422 } });
  renderDashboard();
  expect(await screen.findByRole('alert')).toHaveTextContent('cannot be safely displayed');
  expect(screen.queryByText('Net cash flow')).not.toBeInTheDocument();
});
