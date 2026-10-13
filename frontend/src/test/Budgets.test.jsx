import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { MotionConfig } from 'motion/react';
import { BudgetsPage } from '../pages/BudgetsPage';
import { budgetService } from '../services/budgets';
import { budgetRecord, budgetSummary } from './fixtures/budgets';
import { currentUtcMonth, shiftMonth } from '../utils/budgets';
import { AuthProvider } from '../context/AuthProvider';
import { authService } from '../services/auth';
import { api } from '../services/api';
import App from '../App';
vi.mock('../services/budgets', () => ({
  budgetService: {
    summary: vi.fn(),
    list: vi.fn(),
    get: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
  },
}));
vi.mock('../services/api', () => ({ api: { onUnauthorized: vi.fn() } }));
vi.mock('../services/auth', () => ({
  authService: { me: vi.fn(), logout: vi.fn(), login: vi.fn(), register: vi.fn() },
}));
let unauthorized;
beforeEach(() => {
  vi.resetAllMocks();
  budgetService.summary.mockImplementation(async (month) => budgetSummary([{}], [], month));
  budgetService.list.mockResolvedValue([budgetRecord]);
  budgetService.get.mockResolvedValue(budgetRecord);
  budgetService.create.mockResolvedValue(budgetRecord);
  budgetService.update.mockResolvedValue({ ...budgetRecord, version: 1 });
  budgetService.remove.mockResolvedValue(undefined);
  api.onUnauthorized.mockImplementation((listener) => {
    unauthorized = listener;
    return vi.fn();
  });
  authService.me.mockResolvedValue({
    id: '507f1f77bcf86cd799439011',
    name: 'Budget QA',
    email: 'qa@example.test',
  });
});
function renderPage(full = false) {
  const router = createMemoryRouter(
    [
      {
        path: '*',
        element: (
          <MotionConfig reducedMotion="always">
            {full ? (
              <AuthProvider>
                <App />
              </AuthProvider>
            ) : (
              <BudgetsPage />
            )}
          </MotionConfig>
        ),
      },
    ],
    { initialEntries: ['/app/budgets'] },
  );
  return { ...render(<RouterProvider router={router} />), router };
}
const edit = () => screen.getByRole('button', { name: 'Edit Food & Dining budget' });
async function add() {
  await userEvent.click(screen.getByRole('button', { name: 'Add budget' }));
  return screen.getByRole('dialog');
}
async function openEdit() {
  await screen.findByRole('article', { name: 'Food & Dining budget' });
  await userEvent.click(edit());
  await screen.findByDisplayValue('100.00');
  return screen.getByRole('dialog');
}
it('renders real limits, statuses, uncapped utilization and distinct unbudgeted spending', async () => {
  budgetService.summary.mockResolvedValue(
    budgetSummary(
      [
        {
          category: 'food_dining',
          spentMinor: 5000,
          remainingMinor: 5000,
          utilizationBasisPoints: 5000,
          status: 'within_budget',
        },
        {
          category: 'other',
          spentMinor: 10000,
          remainingMinor: 0,
          utilizationBasisPoints: 10000,
          status: 'at_limit',
        },
        {
          category: 'shopping',
          spentMinor: 15000,
          remainingMinor: -5000,
          overspentMinor: 5000,
          utilizationBasisPoints: 15000,
          status: 'over_budget',
        },
      ],
      [{ category: 'travel', spentMinor: 2500 }],
    ),
  );
  renderPage();
  await screen.findByText('Over budget');
  expect(screen.getByText('Within budget')).toBeVisible();
  expect(screen.getByText('At limit')).toBeVisible();
  const progress = screen.getByRole('progressbar', { name: 'Shopping utilization' });
  expect(progress).toHaveAttribute('aria-valuenow', '100');
  expect(progress).toHaveAttribute('aria-valuetext', '150.00% of budget used');
  expect(screen.getByText('₹50.00 over limit')).toBeVisible();
  expect(screen.getByText('150.00% used')).toBeVisible();
  expect(screen.getByText(/Remaining allowance is not a bank balance/)).toBeVisible();
  await userEvent.click(screen.getByRole('button', { name: 'Create Travel budget' }));
  expect(within(screen.getByRole('dialog')).getByLabelText('Expense category')).toHaveValue(
    'travel',
  );
});
it('handles empty months without fake limits or records', async () => {
  budgetService.summary.mockResolvedValue(budgetSummary());
  renderPage();
  expect(
    await screen.findByRole('heading', { name: 'Give this month a little direction.' }),
  ).toBeVisible();
  expect(screen.getByText('No unbudgeted expenses recorded for this month.')).toBeVisible();
});
it('loads, retries safe errors and never shows internal error details', async () => {
  let reject;
  budgetService.summary.mockReturnValueOnce(new Promise((_done, fail) => (reject = fail)));
  renderPage();
  expect(screen.getByRole('status', { name: 'Loading budgets' })).toBeVisible();
  await act(() => reject(new Error('secret stack')));
  expect(screen.getByRole('alert')).not.toHaveTextContent('secret stack');
  await userEvent.click(screen.getByRole('button', { name: 'Retry summary' }));
  expect(await screen.findByText('Unused')).toBeVisible();
});
it('switches UTC months and years, cancels old requests and ignores stale responses', async () => {
  let stale;
  budgetService.summary.mockReturnValueOnce(new Promise((done) => (stale = done)));
  renderPage();
  const next = shiftMonth(currentUtcMonth(), 1);
  await userEvent.click(screen.getByRole('button', { name: 'Next month' }));
  await screen.findByText('Unused');
  expect(budgetService.summary.mock.calls[0][1].aborted).toBe(true);
  await act(() => stale(budgetSummary([{ category: 'travel' }])));
  expect(screen.queryByRole('article', { name: 'Travel budget' })).not.toBeInTheDocument();
  expect(screen.getByLabelText('Reporting month')).toHaveValue(next);
  fireEvent.change(screen.getByLabelText('Reporting month'), { target: { value: '2027-01' } });
  await waitFor(() =>
    expect(budgetService.summary).toHaveBeenLastCalledWith('2027-01', expect.any(AbortSignal)),
  );
});
it('creates an exact budget, refreshes summary and excludes income categories', async () => {
  budgetService.summary.mockResolvedValue(budgetSummary());
  renderPage();
  await screen.findByText('Give this month a little direction.');
  const dialog = await add();
  expect(within(dialog).queryByRole('option', { name: 'Salary' })).not.toBeInTheDocument();
  await userEvent.type(within(dialog).getByLabelText('Monthly limit (INR)'), '100.50');
  await userEvent.click(within(dialog).getByRole('button', { name: 'Create budget' }));
  expect(budgetService.create).toHaveBeenCalledWith({
    category: 'food_dining',
    month: currentUtcMonth(),
    currency: 'INR',
    amountMinor: 10050,
  });
  expect(await screen.findByText('Budget created.')).toBeVisible();
  expect(budgetService.summary).toHaveBeenCalledTimes(2);
});
it('validates amounts, focuses errors and marks already configured categories', async () => {
  renderPage();
  await screen.findByText('Unused');
  const dialog = await add();
  expect(
    within(dialog).getByRole('option', { name: 'Food & Dining · already budgeted' }),
  ).toBeDisabled();
  await userEvent.type(within(dialog).getByLabelText('Monthly limit (INR)'), '0');
  await userEvent.click(within(dialog).getByRole('button', { name: 'Create budget' }));
  expect(within(dialog).getByLabelText('Monthly limit (INR)')).toHaveFocus();
  expect(within(dialog).getByLabelText('Monthly limit (INR)')).toHaveAttribute(
    'aria-invalid',
    'true',
  );
  expect(budgetService.create).not.toHaveBeenCalled();
});
it('blocks duplicate submits and handles duplicate slot errors without losing the draft', async () => {
  budgetService.summary.mockResolvedValue(budgetSummary());
  let reject;
  budgetService.create.mockReturnValue(new Promise((_done, fail) => (reject = fail)));
  renderPage();
  const dialog = await add();
  await userEvent.type(within(dialog).getByLabelText('Monthly limit (INR)'), '200');
  await userEvent.click(within(dialog).getByRole('button', { name: 'Create budget' }));
  expect(screen.getByRole('button', { name: 'Saving…' })).toBeDisabled();
  await act(() => reject({ response: { status: 409, data: { code: 'BUDGET_EXISTS' } } }));
  expect(screen.getByRole('alert')).toHaveTextContent('already exists');
  expect(screen.getByDisplayValue('200')).toBeVisible();
  expect(budgetService.create).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole('button', { name: 'Reload latest budget' })).not.toBeInTheDocument();
});
it('edits the latest fetched version and preserves exact prefilling', async () => {
  renderPage();
  const dialog = await openEdit();
  await userEvent.clear(within(dialog).getByLabelText('Monthly limit (INR)'));
  await userEvent.type(within(dialog).getByLabelText('Monthly limit (INR)'), '150.01');
  await userEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }));
  expect(budgetService.update).toHaveBeenCalledWith(
    budgetRecord,
    expect.objectContaining({ amountMinor: 15001 }),
  );
  expect(await screen.findByText('Budget updated.')).toBeVisible();
});
for (const status of [409, 412, 428])
  it(`keeps a draft after ${status}, warns before reload and reviews fresh values`, async () => {
    budgetService.update.mockRejectedValueOnce({ response: { status } });
    renderPage();
    const dialog = await openEdit();
    await userEvent.clear(within(dialog).getByLabelText('Monthly limit (INR)'));
    await userEvent.type(within(dialog).getByLabelText('Monthly limit (INR)'), '150.01');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Your changes are still here');
    expect(screen.getByDisplayValue('150.01')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled();
    budgetService.get.mockResolvedValue({
      ...budgetRecord,
      amountMinor: 20000,
      version: 1,
      etag: `"tn-${budgetRecord.id}-v1"`,
    });
    await userEvent.click(screen.getByRole('button', { name: 'Reload latest budget' }));
    expect(screen.getByText('Discard unsaved changes?')).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Discard changes' }));
    expect(await screen.findByDisplayValue('200.00')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeEnabled();
  });
it('confirms deletion, preserves expenses, and refreshes after success', async () => {
  renderPage();
  await screen.findByText('Unused');
  await userEvent.click(screen.getByRole('button', { name: 'Delete Food & Dining budget' }));
  expect(screen.getByRole('dialog')).toHaveTextContent('Expense transactions will remain');
  expect(budgetService.remove).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole('button', { name: 'Keep budget' }));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Delete Food & Dining budget' }));
  budgetService.summary.mockResolvedValue(budgetSummary());
  await userEvent.click(screen.getByRole('button', { name: 'Delete budget' }));
  expect(await screen.findByText('Budget deleted. Your expenses are unchanged.')).toBeVisible();
  expect(screen.queryByText('Unused')).not.toBeInTheDocument();
});
it('reports missing deleted records without claiming deletion success', async () => {
  budgetService.remove.mockRejectedValue({ response: { status: 404 } });
  renderPage();
  await screen.findByText('Unused');
  await userEvent.click(screen.getByRole('button', { name: 'Delete Food & Dining budget' }));
  await userEvent.click(screen.getByRole('button', { name: 'Delete budget' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('no longer available');
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});
it('keeps the delete dialog open after a network failure for deliberate retry', async () => {
  budgetService.remove.mockRejectedValueOnce(new Error('network'));
  renderPage();
  await screen.findByText('Unused');
  await userEvent.click(screen.getByRole('button', { name: 'Delete Food & Dining budget' }));
  await userEvent.click(screen.getByRole('button', { name: 'Delete budget' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Please try again');
  expect(screen.getByRole('dialog')).toBeVisible();
});
it('warns before discarding, guards navigation and restores dialog focus', async () => {
  const { router } = renderPage();
  const trigger = screen.getByRole('button', { name: 'Add budget' });
  trigger.focus();
  const dialog = await add();
  await userEvent.type(within(dialog).getByLabelText('Monthly limit (INR)'), '1');
  await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(screen.getByText('Discard unsaved changes?')).toBeVisible();
  await userEvent.click(screen.getByRole('button', { name: 'Keep editing' }));
  await act(() => {
    void router.navigate('/elsewhere');
  });
  expect(screen.getByText('Leave this draft?')).toBeVisible();
  await userEvent.click(screen.getByRole('button', { name: 'Stay here' }));
  fireEvent(screen.getByRole('dialog'), new Event('cancel', { bubbles: true, cancelable: true }));
  await userEvent.click(screen.getByRole('button', { name: 'Discard changes' }));
  expect(trigger).toHaveFocus();
});
it('integrates mobile navigation and existing session expiration handling', async () => {
  renderPage(true);
  await screen.findByText('Unused');
  await userEvent.click(screen.getByRole('button', { name: 'Open navigation' }));
  await userEvent.click(within(screen.getByRole('dialog')).getByRole('link', { name: 'Budgets' }));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  act(() => unauthorized());
  expect(await screen.findByRole('heading', { name: 'Welcome back.' })).toBeVisible();
});

it('can review and edit saved limits when summary overflow prevents analytics', async () => {
  budgetService.summary.mockRejectedValue({
    response: { status: 422, data: { code: 'SUMMARY_OVERFLOW' } },
  });
  renderPage();
  await screen.findByRole('alert');
  await userEvent.click(screen.getByRole('button', { name: 'Review saved limits' }));
  const limits = await screen.findByRole('region', { name: 'Saved budget limits' });
  expect(limits).toHaveTextContent('Spending is unavailable');
  expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  await userEvent.click(within(limits).getByRole('button', { name: 'Edit Food & Dining budget' }));
  expect(await screen.findByDisplayValue('100.00')).toBeVisible();
});
