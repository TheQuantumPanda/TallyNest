import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { MotionConfig } from 'motion/react';
import { RecurringPage } from '../pages/RecurringPage';
import { recurringService } from '../services/recurring';
import { scheduleRecord, schedulePage, processingResult } from './fixtures/recurring';
import { AuthProvider } from '../context/AuthProvider';
import { authService } from '../services/auth';
import { api } from '../services/api';
import App from '../App';
vi.mock('../services/recurring', () => ({
  recurringService: {
    list: vi.fn(),
    get: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
    lifecycle: vi.fn(),
    process: vi.fn(),
  },
}));
vi.mock('../services/api', () => ({ api: { onUnauthorized: vi.fn() } }));
vi.mock('../services/auth', () => ({
  authService: { me: vi.fn(), logout: vi.fn(), login: vi.fn(), register: vi.fn() },
}));
let unauthorized;
beforeEach(() => {
  vi.resetAllMocks();
  recurringService.list.mockResolvedValue(schedulePage());
  recurringService.get.mockResolvedValue(scheduleRecord);
  recurringService.create.mockResolvedValue(scheduleRecord);
  recurringService.update.mockResolvedValue({ ...scheduleRecord, version: 1 });
  recurringService.remove.mockResolvedValue(undefined);
  recurringService.lifecycle.mockResolvedValue({ ...scheduleRecord, status: 'paused' });
  recurringService.process.mockResolvedValue(processingResult);
  api.onUnauthorized.mockImplementation((listener) => {
    unauthorized = listener;
    return vi.fn();
  });
  authService.me.mockResolvedValue({
    id: '507f1f77bcf86cd799439011',
    name: 'Recurring QA',
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
              <RecurringPage />
            )}
          </MotionConfig>
        ),
      },
    ],
    { initialEntries: ['/app/recurring'] },
  );
  return { ...render(<RouterProvider router={router} />), router };
}
async function loaded() {
  return screen.findByRole('article', { name: 'Monthly workspace schedule' });
}
async function add() {
  await userEvent.click(screen.getByRole('button', { name: 'Add schedule' }));
  return screen.getByRole('dialog');
}
async function fill(dialog, type = 'expense', frequency = 'monthly') {
  await userEvent.selectOptions(within(dialog).getByLabelText('Transaction type'), type);
  await userEvent.type(within(dialog).getByLabelText('Title'), 'Regular entry');
  await userEvent.type(within(dialog).getByLabelText('Amount (INR)'), '100.50');
  await userEvent.selectOptions(within(dialog).getByLabelText('Frequency'), frequency);
  fireEvent.change(within(dialog).getByLabelText('Start date and time (UTC)'), {
    target: { value: '2030-01-31T09:15:20.123' },
  });
}
async function edit() {
  await loaded();
  await userEvent.click(screen.getByRole('button', { name: 'Edit Monthly workspace' }));
  await screen.findByDisplayValue('1250.50');
  return screen.getByRole('dialog');
}
it('shows exact amounts, UTC dates, categories and independent active/paused/exhausted states', async () => {
  recurringService.list.mockResolvedValue(
    schedulePage([
      scheduleRecord,
      {
        ...scheduleRecord,
        id: '507f1f77bcf86cd799439022',
        title: 'Paused entry',
        status: 'paused',
      },
      {
        ...scheduleRecord,
        id: '507f1f77bcf86cd799439023',
        title: 'Finished entry',
        exhausted: true,
        nextOccurrenceDate: null,
      },
      {
        ...scheduleRecord,
        id: '507f1f77bcf86cd799439024',
        title: 'Overdue entry',
        nextOccurrenceDate: '2026-02-01T00:00:00.000Z',
        processing: true,
      },
    ]),
  );
  renderPage();
  await loaded();
  expect(
    within(screen.getByRole('article', { name: 'Monthly workspace schedule' })).getByText(
      '₹1,250.50',
    ),
  ).toBeVisible();
  expect(screen.getByText('Active · Exhausted')).toBeVisible();
  expect(
    within(screen.getByRole('article', { name: 'Paused entry schedule' })).getByText('Paused'),
  ).toBeVisible();
  expect(screen.getByText('No further eligible dates')).toBeVisible();
  expect(screen.getByText('Overdue · next scheduled')).toBeVisible();
  expect(screen.getByText(/Processing reserved entry/)).toBeVisible();
  expect(screen.getAllByText('2026-10-31 · 09:30:15.123 UTC').length).toBe(2);
  expect(screen.getByRole('link', { name: 'Open transaction ledger' })).toHaveAttribute(
    'href',
    '/app/transactions',
  );
  expect(
    screen.getByText(/Schedule-specific history filtering is not available yet/),
  ).toBeVisible();
});
it('shows an empty useful account and a filtered empty state without fabricated totals', async () => {
  recurringService.list.mockResolvedValue(schedulePage([]));
  renderPage();
  expect(await screen.findByText('Make room for a steady rhythm.')).toBeVisible();
  await userEvent.selectOptions(screen.getByLabelText('Schedule status'), 'paused');
  expect(await screen.findByText('No schedules with this status.')).toBeVisible();
  expect(recurringService.list).toHaveBeenLastCalledWith(
    { limit: 20, status: 'paused' },
    expect.any(AbortSignal),
  );
});
it('handles loading, safe failures and a successful retry', async () => {
  let reject;
  recurringService.list.mockReturnValueOnce(new Promise((_done, fail) => (reject = fail)));
  renderPage();
  expect(screen.getByRole('status', { name: 'Loading schedules' })).toBeVisible();
  await act(() => reject(new Error('internal password secret')));
  expect(screen.getByRole('alert')).not.toHaveTextContent('secret');
  await userEvent.click(screen.getByRole('button', { name: 'Reload list' }));
  await loaded();
});
for (const [type, frequency] of [
  ['expense', 'daily'],
  ['income', 'weekly'],
  ['expense', 'monthly'],
  ['income', 'yearly'],
])
  it(`creates ${type} ${frequency} entries with exact money and UTC timestamps`, async () => {
    renderPage();
    const dialog = await add();
    await fill(dialog, type, frequency);
    expect(
      within(dialog).queryByRole('option', {
        name: type === 'income' ? 'Food & Dining' : 'Salary',
      }),
    ).not.toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create schedule' }));
    expect(recurringService.create).toHaveBeenCalledWith(
      expect.objectContaining({
        type,
        frequency,
        amountMinor: 10050,
        currency: 'INR',
        startDate: '2030-01-31T09:15:20.123Z',
        category: type === 'income' ? 'salary' : 'food_dining',
      }),
    );
    expect(await screen.findByText(/Schedule created/)).toBeVisible();
    expect(recurringService.list).toHaveBeenCalledTimes(2);
  });
it('focuses invalid fields and rejects zero/overprecision, empty titles and invalid UTC ranges', async () => {
  renderPage();
  const dialog = await add();
  await userEvent.click(within(dialog).getByRole('button', { name: 'Create schedule' }));
  expect(within(dialog).getByLabelText('Title')).toHaveFocus();
  await fill(dialog);
  const amount = within(dialog).getByLabelText('Amount (INR)');
  for (const value of ['0', '1.001']) {
    fireEvent.change(amount, { target: { value } });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create schedule' }));
    expect(amount).toHaveAttribute('aria-invalid', 'true');
    expect(amount).toHaveFocus();
  }
  fireEvent.change(amount, { target: { value: '1' } });
  fireEvent.change(within(dialog).getByLabelText('End date and time (UTC, optional)'), {
    target: { value: '2029-01-01T00:00' },
  });
  await userEvent.click(within(dialog).getByRole('button', { name: 'Create schedule' }));
  expect(within(dialog).getByText('End must be on or after the start (UTC).')).toBeVisible();
  fireEvent.change(within(dialog).getByLabelText('Start date and time (UTC)'), {
    target: { value: '' },
  });
  await userEvent.click(within(dialog).getByRole('button', { name: 'Create schedule' }));
  expect(within(dialog).getByLabelText('Start date and time (UTC)')).toHaveAttribute(
    'aria-invalid',
    'true',
  );
  expect(recurringService.create).not.toHaveBeenCalled();
});
it('prevents double creation and preserves a draft after a temporary server failure', async () => {
  let reject;
  recurringService.create.mockReturnValue(new Promise((_done, fail) => (reject = fail)));
  renderPage();
  const dialog = await add();
  await fill(dialog);
  await userEvent.click(within(dialog).getByRole('button', { name: 'Create schedule' }));
  expect(screen.getByRole('button', { name: 'Saving…' })).toBeDisabled();
  await act(() => reject(new Error('offline')));
  expect(screen.getByDisplayValue('100.50')).toBeVisible();
  expect(recurringService.create).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('alert')).toHaveTextContent('Please try again');
});
it('fetches fresh edit values, preserves precise anchor dates, clears optional fields and retains its ETag', async () => {
  renderPage();
  const dialog = await edit();
  expect(within(dialog).getByLabelText('Start date and time (UTC)')).toHaveValue(
    '2026-01-31T09:30:15.123',
  );
  fireEvent.change(within(dialog).getByLabelText('Amount (INR)'), { target: { value: '1250.51' } });
  await userEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }));
  expect(recurringService.get).toHaveBeenCalledWith(scheduleRecord.id, expect.any(AbortSignal));
  expect(recurringService.update).toHaveBeenCalledWith(
    scheduleRecord,
    expect.objectContaining({
      amountMinor: 125051,
      startDate: scheduleRecord.startDate,
      notes: null,
      endDate: null,
    }),
  );
  expect(
    await screen.findByText('Schedule updated. Historical entries are unchanged.'),
  ).toBeVisible();
});
for (const [status, code] of [
  [409, undefined],
  [412, undefined],
  [428, undefined],
  [409, 'RECURRING_BUSY'],
])
  it(`preserves and reviews edit drafts after ${status} ${code ?? ''}`, async () => {
    recurringService.update.mockRejectedValueOnce({ response: { status, data: { code } } });
    renderPage();
    const dialog = await edit();
    fireEvent.change(within(dialog).getByLabelText('Amount (INR)'), {
      target: { value: '150.01' },
    });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      code ? 'occurrence is being completed' : 'fresh version',
    );
    expect(screen.getByDisplayValue('150.01')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled();
    recurringService.get.mockResolvedValue({
      ...scheduleRecord,
      amountMinor: 20000,
      version: 2,
      etag: `"tn-${scheduleRecord.id}-v2"`,
    });
    await userEvent.click(screen.getByRole('button', { name: 'Reload latest schedule' }));
    expect(screen.getByText('Discard unsaved changes?')).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Discard changes' }));
    expect(await screen.findByDisplayValue('200.00')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeEnabled();
  });
it('preserves the draft if fetching its replacement fails', async () => {
  recurringService.update.mockRejectedValueOnce({ response: { status: 412 } });
  renderPage();
  const dialog = await edit();
  fireEvent.change(within(dialog).getByLabelText('Amount (INR)'), { target: { value: '333.33' } });
  await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
  await screen.findByRole('alert');
  recurringService.get.mockRejectedValue(new Error('offline'));
  await userEvent.click(screen.getByRole('button', { name: 'Reload latest schedule' }));
  await userEvent.click(screen.getByRole('button', { name: 'Discard changes' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Please try again');
  expect(screen.getByDisplayValue('333.33')).toBeVisible();
});
it('guards draft closure, Escape, page navigation, unload and restores trigger focus', async () => {
  const { router } = renderPage();
  const trigger = screen.getByRole('button', { name: 'Add schedule' });
  trigger.focus();
  const dialog = await add();
  await userEvent.type(within(dialog).getByLabelText('Title'), 'Unsaved');
  const unload = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(unload);
  expect(unload.defaultPrevented).toBe(true);
  fireEvent(dialog, new Event('cancel', { bubbles: true, cancelable: true }));
  expect(screen.getByText('Discard unsaved changes?')).toBeVisible();
  await userEvent.click(screen.getByRole('button', { name: 'Keep editing' }));
  await act(() => {
    void router.navigate('/elsewhere');
  });
  expect(screen.getByText('Leave this draft?')).toBeVisible();
  await userEvent.click(screen.getByRole('button', { name: 'Stay here' }));
  await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  await userEvent.click(screen.getByRole('button', { name: 'Discard changes' }));
  expect(trigger).toHaveFocus();
});
for (const mode of ['pause', 'resume'])
  it(`confirms ${mode} with freshly fetched ETag and explains cursor catch-up`, async () => {
    const row = { ...scheduleRecord, status: mode === 'pause' ? 'active' : 'paused' };
    recurringService.list.mockResolvedValue(schedulePage([row]));
    recurringService.get.mockResolvedValue({ ...row, version: 4, etag: `"tn-${row.id}-v4"` });
    renderPage();
    await loaded();
    await userEvent.click(
      screen.getByRole('button', {
        name: `${mode === 'pause' ? 'Pause' : 'Resume'} Monthly workspace`,
      }),
    );
    await screen.findByRole('button', {
      name: `${mode === 'pause' ? 'Pause' : 'Resume'} schedule`,
    });
    expect(screen.getByRole('dialog')).toHaveTextContent(
      mode === 'pause' ? 'not permanently skipped' : 'during the pause',
    );
    expect(recurringService.lifecycle).not.toHaveBeenCalled();
    await userEvent.click(
      screen.getByRole('button', { name: `${mode === 'pause' ? 'Pause' : 'Resume'} schedule` }),
    );
    expect(recurringService.lifecycle).toHaveBeenCalledWith(
      expect.objectContaining({ version: 4, etag: `"tn-${row.id}-v4"` }),
      mode,
    );
    await screen.findByText(
      mode === 'pause'
        ? 'Schedule paused. Its next date is retained.'
        : 'Schedule resumed. Missed eligible entries may catch up.',
    );
  });
it('requires explicit fresh review after a busy lifecycle conflict', async () => {
  recurringService.lifecycle.mockRejectedValueOnce({
    response: { status: 409, data: { code: 'RECURRING_BUSY' } },
  });
  renderPage();
  await loaded();
  await userEvent.click(screen.getByRole('button', { name: 'Pause Monthly workspace' }));
  await screen.findByRole('button', { name: 'Pause schedule' });
  await userEvent.click(screen.getByRole('button', { name: 'Pause schedule' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('occurrence is being completed');
  expect(screen.getByRole('button', { name: 'Pause schedule' })).toBeDisabled();
  await userEvent.click(screen.getByRole('button', { name: 'Reload latest schedule' }));
  expect(await screen.findByRole('button', { name: 'Pause schedule' })).toBeEnabled();
  expect(recurringService.lifecycle).toHaveBeenCalledTimes(1);
});
it('confirms schedule deletion, retains history semantics and refreshes only after success', async () => {
  renderPage();
  await loaded();
  await userEvent.click(screen.getByRole('button', { name: 'Delete Monthly workspace' }));
  expect(screen.getByRole('dialog')).toHaveTextContent('Historical generated transactions remain');
  expect(recurringService.remove).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  await userEvent.click(screen.getByRole('button', { name: 'Delete Monthly workspace' }));
  recurringService.list.mockResolvedValue(schedulePage([]));
  await userEvent.click(screen.getByRole('button', { name: 'Delete schedule' }));
  expect(
    await screen.findByText('Schedule deleted. Historical transactions remain.'),
  ).toBeVisible();
  expect(screen.queryByRole('article')).not.toBeInTheDocument();
});
for (const [status, code] of [
  [404, undefined],
  [409, 'RECURRING_BUSY'],
  [500, undefined],
])
  it(`handles delete ${status} without claiming success`, async () => {
    recurringService.remove.mockRejectedValueOnce({ response: { status, data: { code } } });
    renderPage();
    await loaded();
    await userEvent.click(screen.getByRole('button', { name: 'Delete Monthly workspace' }));
    await userEvent.click(screen.getByRole('button', { name: 'Delete schedule' }));
    await screen.findByRole('alert');
    expect(
      screen.queryByText('Schedule deleted. Historical transactions remain.'),
    ).not.toBeInTheDocument();
    if (status === 404) expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    else expect(screen.getByRole('dialog')).toBeVisible();
  });
it('appends paginated schedules without duplicate rows and resets after status changes', async () => {
  recurringService.list.mockResolvedValueOnce(schedulePage([scheduleRecord], scheduleRecord.id));
  renderPage();
  await loaded();
  const next = { ...scheduleRecord, id: '507f1f77bcf86cd799439022', title: 'Second entry' };
  recurringService.list.mockResolvedValueOnce(schedulePage([scheduleRecord, next]));
  await userEvent.click(screen.getByRole('button', { name: 'Load more schedules' }));
  await screen.findByRole('article', { name: 'Second entry schedule' });
  expect(screen.getAllByRole('article')).toHaveLength(2);
  expect(recurringService.list.mock.calls[1][0]).toEqual({ limit: 20, after: scheduleRecord.id });
  expect(screen.queryByRole('button', { name: 'Load more schedules' })).not.toBeInTheDocument();
  recurringService.list.mockResolvedValueOnce(schedulePage([]));
  await userEvent.selectOptions(screen.getByLabelText('Schedule status'), 'paused');
  await screen.findByText('No schedules with this status.');
  expect(recurringService.list.mock.calls.at(-1)[0]).toEqual({ limit: 20, status: 'paused' });
});
it('blocks simultaneous pagination and rejects stale appended responses after filter switches', async () => {
  recurringService.list.mockResolvedValueOnce(schedulePage([scheduleRecord], scheduleRecord.id));
  renderPage();
  await loaded();
  let stale;
  recurringService.list.mockReturnValueOnce(new Promise((done) => (stale = done)));
  await userEvent.click(screen.getByRole('button', { name: 'Load more schedules' }));
  expect(screen.getByRole('button', { name: 'Loading more…' })).toBeDisabled();
  recurringService.list.mockResolvedValueOnce(schedulePage([]));
  await userEvent.selectOptions(screen.getByLabelText('Schedule status'), 'paused');
  await screen.findByText('No schedules with this status.');
  expect(recurringService.list.mock.calls[1][1].aborted).toBe(true);
  await act(() => stale(schedulePage([{ ...scheduleRecord, title: 'Stale entry' }])));
  expect(screen.queryByRole('article')).not.toBeInTheDocument();
  expect(recurringService.list).toHaveBeenCalledTimes(3);
});
it('cancels and ignores stale initial responses and preserves rows on load-more failures', async () => {
  let stale;
  recurringService.list.mockReturnValueOnce(new Promise((done) => (stale = done)));
  renderPage();
  await userEvent.selectOptions(screen.getByLabelText('Schedule status'), 'active');
  await loaded();
  expect(recurringService.list.mock.calls[0][1].aborted).toBe(true);
  await act(() => stale(schedulePage([{ ...scheduleRecord, title: 'Stale entry' }])));
  expect(screen.queryByText('Stale entry')).not.toBeInTheDocument();
  recurringService.list.mockResolvedValueOnce(schedulePage([scheduleRecord], scheduleRecord.id));
  await userEvent.click(screen.getByRole('button', { name: 'Reload schedules' }));
  await loaded();
  recurringService.list.mockRejectedValueOnce({ response: { status: 400 } });
  await userEvent.click(screen.getByRole('button', { name: 'Load more schedules' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('reload the list');
  await loaded();
});
it('runs one bounded manual process, reports every result and never loops for more due work', async () => {
  let finish;
  recurringService.process.mockReturnValueOnce(new Promise((done) => (finish = done)));
  renderPage();
  await loaded();
  expect(recurringService.process).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole('button', { name: 'Check due entries' }));
  expect(screen.getByRole('button', { name: 'Checking…' })).toBeDisabled();
  await act(() => finish({ ...processingResult, errors: 1, hasMoreDue: true }));
  const section = screen.getByRole('region', { name: 'Due entry processing' });
  for (const label of ['Generated', 'Recovered', 'Advanced', 'Errors', 'Conflicts'])
    expect(within(section).getByText(label)).toBeVisible();
  expect(section).toHaveTextContent('More work remains');
  expect(section).toHaveTextContent('persistent failures need server review');
  expect(recurringService.process).toHaveBeenCalledTimes(1);
  expect(recurringService.list).toHaveBeenCalledTimes(2);
});
it('handles process rate limiting and temporary failures without leaking raw errors', async () => {
  recurringService.process.mockRejectedValueOnce({ response: { status: 429 } });
  renderPage();
  await loaded();
  await userEvent.click(screen.getByRole('button', { name: 'Check due entries' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Please wait');
  recurringService.process.mockRejectedValueOnce(new Error('secret'));
  await userEvent.click(screen.getByRole('button', { name: 'Check due entries' }));
  expect(await screen.findByRole('alert')).not.toHaveTextContent('secret');
});
it('uses mobile navigation, preserves authentication protection and handles session loss', async () => {
  renderPage(true);
  await loaded();
  expect(document.title).toBe('Recurring · TallyNest');
  await userEvent.click(screen.getByRole('button', { name: 'Open navigation' }));
  await userEvent.click(
    within(screen.getByRole('dialog')).getByRole('link', { name: 'Recurring' }),
  );
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  act(() => unauthorized());
  expect(await screen.findByRole('heading', { name: 'Welcome back.' })).toBeVisible();
});
it('prevents unauthenticated recurring content from flashing', async () => {
  authService.me.mockRejectedValue({ response: { status: 401 } });
  renderPage(true);
  expect(await screen.findByRole('heading', { name: 'Welcome back.' })).toBeVisible();
  expect(recurringService.list).not.toHaveBeenCalled();
});
