import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, expect, it, vi } from 'vitest';
import { AuthContext } from '../context/AuthContext';
import { CycleWorkspace } from '../pages/CycleWorkspace';
import { cyclesService } from '../services/cycles';
import { groupsService } from '../services/groups';
import { a, b, group, groupId, members, expense, balances, date } from './fixtures/groups';

vi.mock('../services/groups', async (importOriginal) => ({
  ...(await importOriginal()),
  groupsService: { get: vi.fn(), members: vi.fn() },
}));
vi.mock('../services/cycles', async (importOriginal) => {
  const original = await importOriginal();
  return {
    ...original,
    cyclesService: {
      list: vi.fn(),
      get: vi.fn(),
      transition: vi.fn(),
      recover: vi.fn(),
      balances: vi.fn(),
      expenses: { list: vi.fn(), get: vi.fn(), create: vi.fn(), update: vi.fn(), remove: vi.fn() },
      settlements: { list: vi.fn(), get: vi.fn(), create: vi.fn(), decide: vi.fn() },
    },
  };
});
const cycleId = '507f1f77bcf86cd799439080';
const head = {
  id: groupId,
  version: 2,
  etag: `"tn-${groupId}-v2"`,
  currentCycleId: cycleId,
  currentCycleState: 'open',
  epoch: 1,
  busy: false,
};
const cycle = {
  id: cycleId,
  groupId,
  sequence: 1,
  currency: 'INR',
  state: 'open',
  memberIds: [a, b],
  openedAt: date,
  version: 0,
  etag: `"tn-${cycleId}-v0"`,
};
const paged = (rows, groupHead = head) => ({
  rows,
  group: groupHead,
  pagination: { limit: 20, hasMore: false, nextAfter: null },
});
function show(path = `/app/groups/${groupId}`, memberId = a) {
  return render(
    <AuthContext.Provider value={{ status: 'authenticated', user: { id: memberId, name: 'Asha' } }}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/app/groups/:groupId" element={<CycleWorkspace />} />
          <Route path="/app/groups/:groupId/cycles/:cycleId" element={<CycleWorkspace />} />
        </Routes>
      </MemoryRouter>
    </AuthContext.Provider>,
  );
}
beforeEach(() => {
  vi.resetAllMocks();
  groupsService.get.mockResolvedValue(group);
  groupsService.members.mockResolvedValue({ group, members });
  cyclesService.list.mockResolvedValue(paged([cycle]));
  cyclesService.get.mockResolvedValue({ value: cycle, group: head });
  cyclesService.balances.mockResolvedValue({ ...balances, cycleId });
  cyclesService.expenses.list.mockResolvedValue(paged([]));
  cyclesService.settlements.list.mockResolvedValue(paged([]));
});

it('selects current and historical cycles without changing the group pointer', async () => {
  const oldId = '507f1f77bcf86cd799439081';
  cyclesService.list.mockResolvedValue(
    paged([
      {
        ...cycle,
        id: oldId,
        sequence: 1,
        state: 'closed',
        frozenAt: date,
        closedAt: date,
        etag: `"tn-${oldId}-v2"`,
      },
      { ...cycle, sequence: 2 },
    ]),
  );
  cyclesService.get.mockImplementation(async (_group, target) => ({
    value:
      target === oldId
        ? { ...cycle, id: oldId, state: 'closed', frozenAt: date, closedAt: date }
        : cycle,
    group: head,
  }));
  const user = userEvent.setup();
  show();
  await user.click((await screen.findAllByRole('button', { name: /Cycle 1/i }))[0]);
  expect(await screen.findByText(/This is read-only history/)).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Open next cycle' })).not.toBeInTheDocument();
  expect(cyclesService.transition).not.toHaveBeenCalled();
});

it('shows lifecycle actions only to the owner and keeps original mutation headers', async () => {
  const user = userEvent.setup();
  const view = show();
  await user.click(await screen.findByRole('button', { name: 'Freeze cycle' }));
  const dialog = screen.getByRole('dialog');
  expect(within(dialog).getByText(/permanently makes this cycle/)).toBeVisible();
  cyclesService.transition.mockResolvedValue({
    value: { ...cycle, state: 'frozen' },
    replayed: false,
  });
  await user.click(within(dialog).getByRole('button', { name: 'Freeze cycle' }));
  expect(cyclesService.transition).toHaveBeenCalledWith(
    groupId,
    expect.objectContaining({
      body: { epoch: 1 },
      headers: expect.objectContaining({ 'If-Match': cycle.etag, 'If-Group-Match': head.etag }),
    }),
  );
  view.unmount();
  groupsService.get.mockResolvedValue({
    ...group,
    membership: { ...group.membership, role: 'member' },
  });
  show(`/app/groups/${groupId}`, b);
  await screen.findAllByRole('heading', { name: 'Cycle 1' });
  expect(screen.queryByRole('button', { name: 'Freeze cycle' })).not.toBeInTheDocument();
});

it('creates an exact-paise expense in the selected cycle with the shared split preview', async () => {
  const user = userEvent.setup();
  cyclesService.expenses.create.mockResolvedValue({ ...expense, cycleId, replayed: false });
  show();
  await user.click(await screen.findByRole('button', { name: 'expenses', exact: true }));
  await user.click(await screen.findByRole('button', { name: 'Add shared expense' }));
  const dialog = screen.getByRole('dialog');
  await user.type(within(dialog).getByRole('textbox', { name: 'Expense title' }), 'Cycle dinner');
  await user.type(within(dialog).getByRole('textbox', { name: 'Total amount (INR)' }), '100.01');
  expect(within(dialog).getByRole('region', { name: 'Exact split preview' })).toHaveTextContent(
    '₹50.01',
  );
  await user.click(within(dialog).getByRole('button', { name: 'Save' }));
  await waitFor(() =>
    expect(cyclesService.expenses.create).toHaveBeenCalledWith(
      groupId,
      cycleId,
      expect.objectContaining({ amountMinor: 10001, cycleId }),
      expect.any(String),
    ),
  );
});

it('keeps historic expenses read-only and blocks current-cycle creation controls', async () => {
  const closed = {
    ...cycle,
    state: 'closed',
    frozenAt: date,
    closedAt: date,
    version: 2,
    etag: `"tn-${cycleId}-v2"`,
  };
  cyclesService.list.mockResolvedValue(paged([closed], { ...head, currentCycleState: 'closed' }));
  cyclesService.get.mockResolvedValue({
    value: closed,
    group: { ...head, currentCycleState: 'closed' },
  });
  show();
  await userEvent
    .setup()
    .click(await screen.findByRole('button', { name: 'expenses', exact: true }));
  expect(screen.getByRole('button', { name: 'Add shared expense' })).toBeDisabled();
  expect(screen.getByText(/permanently read-only/)).toBeVisible();
});

it('rejects stale responses after group or cycle navigation', async () => {
  let resolveOld;
  cyclesService.get
    .mockReturnValueOnce(
      new Promise((resolve) => {
        resolveOld = resolve;
      }),
    )
    .mockResolvedValue({ value: cycle, group: head });
  const view = show();
  await act(async () => {
    view.rerender(
      <AuthContext.Provider value={{ status: 'authenticated', user: { id: a } }}>
        <MemoryRouter initialEntries={[`/app/groups/${groupId}/cycles/${cycleId}`]}>
          <Routes>
            <Route path="/app/groups/:groupId/cycles/:cycleId" element={<CycleWorkspace />} />
          </Routes>
        </MemoryRouter>
      </AuthContext.Provider>,
    );
  });
  await act(async () => resolveOld({ value: { ...cycle, sequence: 99 }, group: head }));
  expect(screen.queryByRole('heading', { name: 'Cycle 99' })).not.toBeInTheDocument();
});

it('offers explicit first opening only to the owner of a cycle-less version-2 group', async () => {
  const emptyHead = { ...head, currentCycleId: null, currentCycleState: null, epoch: 0 };
  cyclesService.list.mockResolvedValue(paged([], emptyHead));
  const user = userEvent.setup();
  show();
  await user.click(await screen.findByRole('button', { name: 'Open first cycle' }));
  expect(screen.getByRole('dialog')).toHaveTextContent(/zero recorded positions/i);
  expect(cyclesService.transition).not.toHaveBeenCalled();
});

it('offers one explicit recovery attempt for an active durable reservation', async () => {
  cyclesService.list.mockResolvedValue(paged([cycle], { ...head, busy: true }));
  cyclesService.recover.mockResolvedValue({ recovered: true });
  const user = userEvent.setup();
  show();
  await user.click(await screen.findByRole('button', { name: 'Recover pending operation' }));
  expect(cyclesService.recover).toHaveBeenCalledTimes(1);
  expect(await screen.findByText(/original operation was reconciled/i)).toBeVisible();
});
