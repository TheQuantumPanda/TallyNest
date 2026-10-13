import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { MotionConfig } from 'motion/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { TransactionsPage } from '../pages/TransactionsPage';
import { transactionService } from '../services/transactions';
import { AuthProvider } from '../context/AuthProvider';
import App from '../App';
import { api } from '../services/api';
import { authService } from '../services/auth';

vi.mock('../services/transactions', () => ({
  transactionService: {
    list: vi.fn(),
    get: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
  },
}));
vi.mock('../services/api', () => ({ api: { onUnauthorized: vi.fn() } }));
vi.mock('../services/auth', () => ({
  authService: { me: vi.fn(), login: vi.fn(), register: vi.fn(), logout: vi.fn() },
}));
const row = {
  id: '507f1f77bcf86cd799439033',
  version: 0,
  etag: '"tn-507f1f77bcf86cd799439033-v0"',
  type: 'expense',
  title: 'Lunch',
  amountMinor: 125050,
  currency: 'INR',
  category: 'food_dining',
  transactionDate: '2026-10-13T07:00:00.000Z',
  notes: 'A useful note',
  createdAt: '2026-10-13T07:01:00.000Z',
  updatedAt: '2026-10-13T07:01:00.000Z',
};
const page = (rows = [row], cursor = null) => ({
  transactions: rows,
  pagination: { limit: 20, hasMore: !!cursor, nextCursor: cursor },
});
let unauthorized;
beforeEach(() => {
  vi.resetAllMocks();
  transactionService.list.mockResolvedValue(page());
  transactionService.get.mockResolvedValue(row);
  transactionService.create.mockResolvedValue(row);
  transactionService.update.mockResolvedValue({ ...row, version: 1 });
  transactionService.remove.mockResolvedValue(undefined);
  api.onUnauthorized.mockImplementation((listener) => {
    unauthorized = listener;
    return vi.fn();
  });
  authService.me.mockResolvedValue({
    id: '507f1f77bcf86cd799439011',
    name: 'Alex Rivera',
    email: 'alex@example.test',
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
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
              <TransactionsPage />
            )}
          </MotionConfig>
        ),
      },
    ],
    { initialEntries: ['/app/transactions'] },
  );
  const result = render(<RouterProvider router={router} />);
  return { ...result, router };
}
const editButton = () => screen.getAllByRole('button', { name: 'Edit Lunch' })[0];
async function openAdd() {
  await userEvent.click(screen.getByRole('button', { name: 'Add transaction' }));
  return screen.getByRole('dialog');
}
async function fillForm(
  dialog,
  { type = 'expense', amount = '100.50', title = 'Test record' } = {},
) {
  if (type === 'income')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Income' }));
  await userEvent.type(within(dialog).getByLabelText('Title'), title);
  await userEvent.type(within(dialog).getByLabelText('Amount (INR)'), amount);
}
it('fetches and displays actual ledger data, type, currency and notes detail', async () => {
  renderPage();
  expect(await screen.findByRole('table')).toBeInTheDocument();
  expect(screen.getAllByText('₹1,250.50', { exact: false }).length).toBeGreaterThan(0);
  expect(transactionService.list).toHaveBeenCalledWith(
    expect.objectContaining({
      limit: 20,
      currency: 'INR',
      sortBy: 'transactionDate',
      sortOrder: 'desc',
    }),
    expect.any(AbortSignal),
  );
  await userEvent.click(screen.getAllByRole('button', { name: 'Lunch' })[0]);
  expect(await screen.findByText('A useful note')).toBeVisible();
});
it('shows a helpful empty state without fabricated totals', async () => {
  transactionService.list.mockResolvedValue(page([]));
  renderPage();
  expect(await screen.findByRole('heading', { name: 'Your ledger starts here.' })).toBeVisible();
});
it('shows loading state until initial request resolves', async () => {
  let done;
  transactionService.list.mockReturnValue(
    new Promise((resolve) => {
      done = resolve;
    }),
  );
  renderPage();
  expect(screen.getByRole('status', { name: 'Loading transactions' })).toBeInTheDocument();
  await act(() => done(page()));
  expect(await screen.findByRole('table')).toBeInTheDocument();
});
for (const type of ['income', 'expense'])
  it(`creates ${type} with exact minor amount and compatible category`, async () => {
    renderPage();
    await screen.findByRole('table');
    const dialog = await openAdd();
    await fillForm(dialog, { type });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add transaction' }));
    await waitFor(() =>
      expect(transactionService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          type,
          amountMinor: 10050,
          category: type === 'income' ? 'salary' : 'food_dining',
          currency: 'INR',
        }),
      ),
    );
    expect(await screen.findByText('Transaction added.')).toBeVisible();
    expect(transactionService.list).toHaveBeenCalledTimes(2);
  });
it('validates fields, focuses first error and updates available categories', async () => {
  renderPage();
  const dialog = await openAdd();
  await userEvent.click(within(dialog).getByRole('button', { name: 'Add transaction' }));
  expect(within(dialog).getByLabelText('Title')).toHaveFocus();
  expect(within(dialog).getByLabelText('Title')).toHaveAttribute('aria-invalid', 'true');
  expect(transactionService.create).not.toHaveBeenCalled();
  await fillForm(dialog, { amount: '1.001', type: 'income' });
  expect(within(dialog).queryByRole('option', { name: 'Food & Dining' })).not.toBeInTheDocument();
  await userEvent.click(within(dialog).getByRole('button', { name: 'Add transaction' }));
  expect(within(dialog).getByLabelText('Amount (INR)')).toHaveAttribute('aria-invalid', 'true');
});
it('blocks duplicate saves while creating and presents failures safely', async () => {
  let fail;
  transactionService.create.mockReturnValue(
    new Promise((_resolve, reject) => {
      fail = reject;
    }),
  );
  renderPage();
  const dialog = await openAdd();
  await fillForm(dialog);
  await userEvent.click(within(dialog).getByRole('button', { name: 'Add transaction' }));
  expect(within(dialog).getByRole('button', { name: 'Saving…' })).toBeDisabled();
  expect(within(dialog).getByLabelText('Title')).toBeDisabled();
  await act(() => fail(new Error('secret internals')));
  expect(within(dialog).getByRole('alert')).not.toHaveTextContent('secret internals');
  expect(transactionService.create).toHaveBeenCalledTimes(1);
});
it('prefills edit values exactly and retains the retrieved server version and timestamp', async () => {
  renderPage();
  await screen.findByRole('table');
  await userEvent.click(editButton());
  await screen.findByDisplayValue('1250.50');
  const dialog = screen.getByRole('dialog');
  await userEvent.clear(within(dialog).getByLabelText('Title'));
  await userEvent.type(within(dialog).getByLabelText('Title'), 'Edited');
  await userEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }));
  expect(transactionService.update).toHaveBeenCalledWith(
    row,
    expect.objectContaining({
      title: 'Edited',
      amountMinor: 125050,
      transactionDate: row.transactionDate,
    }),
  );
});
for (const status of [409, 412, 428])
  it(`preserves a draft and offers explicit reload after ${status}`, async () => {
    transactionService.update.mockRejectedValueOnce({ response: { status } });
    renderPage();
    await screen.findByRole('table');
    await userEvent.click(editButton());
    await screen.findByDisplayValue('1250.50');
    const dialog = screen.getByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText('Title'), ' draft');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Your changes are still here');
    expect(screen.getByDisplayValue('Lunch draft')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Save changes' })).toBeDisabled();
    transactionService.get.mockResolvedValue({
      ...row,
      title: 'Server update',
      version: status === 428 ? 0 : 1,
      etag: 'fresh-tag',
    });
    await userEvent.click(
      within(dialog).getByRole('button', { name: 'Reload latest transaction' }),
    );
    expect(screen.getByText('Discard unsaved changes?')).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Discard changes' }));
    expect(await screen.findByDisplayValue('Server update')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeEnabled();
  });
it('confirms deletion, allows cancellation, and removes deleted records after success', async () => {
  renderPage();
  await screen.findByRole('table');
  await userEvent.click(screen.getAllByRole('button', { name: 'Delete Lunch' })[0]);
  expect(screen.getByRole('dialog')).toHaveTextContent('permanently');
  expect(transactionService.remove).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole('button', { name: 'Keep transaction' }));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  await userEvent.click(screen.getAllByRole('button', { name: 'Delete Lunch' })[0]);
  transactionService.list.mockResolvedValue(page([]));
  await userEvent.click(screen.getByRole('button', { name: 'Delete transaction' }));
  expect(await screen.findByText('Transaction deleted.')).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Lunch' })).not.toBeInTheDocument();
});
it('handles missing transaction deletion without claiming success', async () => {
  transactionService.remove.mockRejectedValue({ response: { status: 404 } });
  renderPage();
  await screen.findByRole('table');
  await userEvent.click(screen.getAllByRole('button', { name: 'Delete Lunch' })[0]);
  await userEvent.click(screen.getByRole('button', { name: 'Delete transaction' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('no longer available');
  expect(screen.queryByText('Transaction deleted.')).not.toBeInTheDocument();
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});
it('debounces search, sends server filters/sorting, validates ranges, and resets filters', async () => {
  renderPage();
  await screen.findByRole('table');
  await userEvent.type(screen.getByLabelText('Search title'), 'lunch');
  await waitFor(() =>
    expect(transactionService.list).toHaveBeenLastCalledWith(
      expect.objectContaining({ search: 'lunch' }),
      expect.any(AbortSignal),
    ),
  );
  expect(transactionService.list).toHaveBeenCalledTimes(2);
  await userEvent.selectOptions(screen.getByLabelText('Type'), 'income');
  await userEvent.selectOptions(screen.getByLabelText('Sort by'), 'amountMinor:asc');
  await waitFor(() =>
    expect(transactionService.list).toHaveBeenLastCalledWith(
      expect.objectContaining({ type: 'income', sortBy: 'amountMinor', sortOrder: 'asc' }),
      expect.any(AbortSignal),
    ),
  );
  fireEvent.change(screen.getByLabelText('From date'), { target: { value: '2026-10-15' } });
  fireEvent.change(screen.getByLabelText('To date'), { target: { value: '2026-10-14' } });
  expect(screen.getByText('End date must be on or after start date.')).toBeVisible();
  await userEvent.click(screen.getByRole('button', { name: 'Reset filters' }));
  await waitFor(() =>
    expect(transactionService.list).toHaveBeenLastCalledWith(
      expect.not.objectContaining({ type: 'income' }),
      expect.any(AbortSignal),
    ),
  );
});
it('loads cursor pages once, deduplicates IDs, and resets cursors on filter changes', async () => {
  let resolve;
  transactionService.list
    .mockResolvedValueOnce(page([row], 'cursor-1'))
    .mockReturnValueOnce(
      new Promise((done) => {
        resolve = done;
      }),
    )
    .mockResolvedValue(page([]));
  renderPage();
  const button = await screen.findByRole('button', { name: 'Load more' });
  await userEvent.click(button);
  expect(screen.getByRole('button', { name: 'Loading…' })).toBeDisabled();
  await act(() =>
    resolve(page([row, { ...row, id: '507f1f77bcf86cd799439034', title: 'Second' }])),
  );
  expect(transactionService.list.mock.calls[1][0].cursor).toBe('cursor-1');
  expect(screen.getByText('2 loaded · INR')).toBeVisible();
  await userEvent.selectOptions(screen.getByLabelText('Type'), 'income');
  await waitFor(() => expect(transactionService.list.mock.calls.at(-1)[0].cursor).toBeUndefined());
});
it('offers list reload when a cursor expires', async () => {
  transactionService.list
    .mockResolvedValueOnce(page([row], 'expired'))
    .mockRejectedValueOnce({ response: { status: 400, data: { code: 'INVALID_CURSOR' } } })
    .mockResolvedValue(page());
  renderPage();
  await userEvent.click(await screen.findByRole('button', { name: 'Load more' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('page link has expired');
  await userEvent.click(screen.getByRole('button', { name: 'Reload list' }));
  await waitFor(() => expect(transactionService.list).toHaveBeenCalledTimes(3));
  expect(transactionService.list.mock.calls[2][0].cursor).toBeUndefined();
});
it('ignores stale responses that arrive after filters change', async () => {
  let old;
  transactionService.list
    .mockReturnValueOnce(
      new Promise((resolve) => {
        old = resolve;
      }),
    )
    .mockResolvedValue(page([{ ...row, title: 'Newest filter' }]));
  renderPage();
  await userEvent.selectOptions(screen.getByLabelText('Type'), 'income');
  await screen.findAllByText('Newest filter');
  await act(() => old(page([{ ...row, title: 'Stale result' }])));
  expect(screen.queryByText('Stale result')).not.toBeInTheDocument();
});
it('reports API failures with safe retry controls', async () => {
  transactionService.list
    .mockRejectedValueOnce(new Error('secret stack'))
    .mockResolvedValue(page());
  renderPage();
  expect(await screen.findByRole('alert')).not.toHaveTextContent('secret stack');
  await userEvent.click(screen.getByRole('button', { name: 'Reload list' }));
  expect(await screen.findByRole('table')).toBeInTheDocument();
});
it('warns on closing a dirty form, restores focus, and blocks route navigation until confirmed', async () => {
  const { router } = renderPage();
  const trigger = screen.getByRole('button', { name: 'Add transaction' });
  trigger.focus();
  const dialog = await openAdd();
  await userEvent.type(within(dialog).getByLabelText('Title'), 'Draft');
  await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
  expect(screen.getByText('Discard unsaved changes?')).toBeVisible();
  await userEvent.click(screen.getByRole('button', { name: 'Keep editing' }));
  await act(() => {
    void router.navigate('/elsewhere');
  });
  expect(screen.getByText('Leave this draft?')).toBeVisible();
  await userEvent.click(screen.getByRole('button', { name: 'Stay here' }));
  fireEvent(screen.getByRole('dialog'), new Event('cancel', { bubbles: true, cancelable: true }));
  await userEvent.click(screen.getByRole('button', { name: 'Discard changes' }));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(trigger).toHaveFocus();
});
it('integrates responsive navigation and handles transaction session loss through existing auth context', async () => {
  renderPage(true);
  await screen.findByRole('table');
  await userEvent.click(screen.getByRole('button', { name: 'Open navigation' }));
  expect(screen.getByRole('dialog')).toHaveAttribute('open');
  await userEvent.click(
    within(screen.getByRole('dialog')).getByRole('link', { name: 'Transactions' }),
  );
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  act(() => unauthorized());
  expect(await screen.findByRole('heading', { name: 'Welcome back.' })).toBeVisible();
  expect(screen.getByRole('status')).toHaveTextContent('Your session has ended.');
});

it('ignores an in-flight next page after filters reset the ledger', async () => {
  let oldPage;
  transactionService.list
    .mockResolvedValueOnce(page([row], 'old-cursor'))
    .mockReturnValueOnce(
      new Promise((resolve) => {
        oldPage = resolve;
      }),
    )
    .mockResolvedValue(page([{ ...row, title: 'Filtered record' }]));
  renderPage();
  await userEvent.click(await screen.findByRole('button', { name: 'Load more' }));
  await userEvent.selectOptions(screen.getByLabelText('Type'), 'income');
  await screen.findAllByText('Filtered record');
  await act(() =>
    oldPage(page([{ ...row, id: '507f1f77bcf86cd799439035', title: 'Stale next page' }])),
  );
  expect(screen.queryByText('Stale next page')).not.toBeInTheDocument();
  expect(screen.getByText('1 loaded · INR')).toBeVisible();
});
