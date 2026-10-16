import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import { beforeEach, it, expect, vi } from 'vitest';
import { MotionConfig } from 'motion/react';
import App from '../App';
import { AuthContext } from '../context/AuthContext';
import { GroupsPage } from '../pages/GroupsPage';
import { GroupWorkspace } from '../pages/GroupWorkspace';
import { InvitationLanding } from '../pages/InvitationLanding';
import { groupsService } from '../services/groups';
import { groupExpensesService } from '../services/groupExpenses';
import { groupSettlementsService } from '../services/groupSettlements';
import { groupInvitationsService } from '../services/groupInvitations';
import {
  group,
  groupId,
  expense,
  members,
  balances,
  pending,
  confirmed,
  page,
  token,
  invitation,
  a,
  b,
  c,
  failure,
} from './fixtures/groups';
vi.mock('../services/groups', () => ({
  groupsService: {
    list: vi.fn(),
    get: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
    members: vi.fn(),
    removeMember: vi.fn(),
    leave: vi.fn(),
    recover: vi.fn(),
  },
}));
vi.mock('../services/groupExpenses', () => ({
  groupExpensesService: {
    list: vi.fn(),
    get: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
  },
}));
vi.mock('../services/groupSettlements', () => ({
  groupSettlementsService: {
    list: vi.fn(),
    get: vi.fn(),
    create: vi.fn(),
    decide: vi.fn(),
    balances: vi.fn(),
  },
}));
vi.mock('../services/groupInvitations', () => ({
  groupInvitationsService: {
    list: vi.fn(),
    create: vi.fn(),
    revoke: vi.fn(),
    inspect: vi.fn(),
    accept: vi.fn(),
  },
}));
beforeEach(() => {
  vi.resetAllMocks();
  groupsService.get.mockResolvedValue(group);
  groupsService.members.mockResolvedValue({ group, members });
  groupsService.list.mockResolvedValue(page([group]));
  groupsService.create.mockResolvedValue(group);
  groupsService.update.mockResolvedValue(group);
  groupsService.recover.mockResolvedValue({ recovered: true });
  groupExpensesService.list.mockResolvedValue(page([]));
  groupExpensesService.get.mockResolvedValue(expense);
  groupExpensesService.create.mockResolvedValue({ ...expense, replayed: false });
  groupExpensesService.update.mockResolvedValue(expense);
  groupSettlementsService.balances.mockResolvedValue(balances);
  groupSettlementsService.list.mockResolvedValue(page([]));
  groupSettlementsService.get.mockResolvedValue(pending);
  groupSettlementsService.create.mockResolvedValue({ ...pending, replayed: false });
  groupSettlementsService.decide.mockResolvedValue(confirmed);
  groupInvitationsService.list.mockResolvedValue({ group, invitations: [] });
  groupInvitationsService.create.mockResolvedValue({ group, invitation, token });
  groupInvitationsService.inspect.mockResolvedValue({
    group: { id: groupId, name: group.name, currency: 'INR' },
    expiresAt: invitation.expiresAt,
  });
  groupInvitationsService.accept.mockResolvedValue(group);
});
function Location() {
  const location = useLocation();
  return <output aria-label="Current route">{location.pathname + location.hash}</output>;
}
function show(path = '/app/groups/' + groupId, userId = a, full = false, status = 'authenticated') {
  const auth = {
    status,
    user: { id: userId, name: 'Account', email: 'self@example.test' },
    logout: vi.fn(),
    restore: vi.fn(),
  };
  return render(
    <MotionConfig reducedMotion="always">
      <AuthContext.Provider value={auth}>
        <MemoryRouter initialEntries={[path]}>
          {full ? (
            <App />
          ) : (
            <Routes>
              <Route path="/app/groups" element={<GroupsPage />} />
              <Route path="/app/groups/:groupId" element={<GroupWorkspace />} />
              <Route path="/app/join/:token?" element={<InvitationLanding />} />
            </Routes>
          )}
          <Location />
        </MemoryRouter>
      </AuthContext.Provider>
    </MotionConfig>,
  );
}
async function click(name) {
  await userEvent.click(await screen.findByRole('button', { name, exact: true }));
}
async function tab(name) {
  await click(name);
}
async function fill(label, value) {
  const input = await screen.findByLabelText(label, { exact: true });
  await userEvent.clear(input);
  await userEvent.type(input, value);
}
async function add() {
  await tab('expenses');
  await click('Add shared expense');
  await fill('Expense title', 'Trip lunch');
  await fill('Total amount (INR)', '100.01');
}
it('lists real groups and creates a new group with sanitized metadata', async () => {
  groupsService.list.mockResolvedValue(page([]));
  show('/app/groups');
  await click('Create group');
  await fill('Group name', ' New group ');
  await fill('Description (optional)', ' Notes ');
  await click('Save');
  await waitFor(() =>
    expect(groupsService.create).toHaveBeenCalledWith({
      name: 'New group',
      description: 'Notes',
      currency: 'INR',
    }),
  );
  expect(await screen.findByRole('heading', { name: group.name })).toBeInTheDocument();
});
it('shows genuine empty and loading states and retryable errors', async () => {
  let resolve;
  groupsService.list.mockReturnValue(new Promise((r) => (resolve = r)));
  show('/app/groups');
  expect(screen.getAllByRole('status').some((node) => node.textContent.includes('Loading'))).toBe(
    true,
  );
  await act(async () => resolve(page([])));
  expect(await screen.findByText('Your first group starts here')).toBeInTheDocument();
  groupsService.list.mockRejectedValue(failure(401, 'AUTH_REQUIRED'));
  await click('Create your first group');
  await click('Cancel');
});
it('loads bounded group pages without duplicate rows or simultaneous requests', async () => {
  groupsService.list
    .mockResolvedValueOnce({
      rows: [group],
      pagination: { limit: 20, hasMore: true, nextAfter: groupId },
    })
    .mockResolvedValueOnce(page([group, { ...group, id: c, name: 'Second group' }]));
  show('/app/groups');
  await click('Load more');
  expect(await screen.findByRole('link', { name: /Second group/ })).toBeInTheDocument();
  expect(screen.getAllByRole('link', { name: /Weekend house/ })).toHaveLength(1);
  expect(groupsService.list.mock.calls[1][0]).toEqual({ after: groupId });
});
it('keeps metadata drafts during stale versions and requires explicit latest-record review', async () => {
  show();
  await click('Edit group');
  await fill('Group name', 'My retained draft');
  groupsService.update
    .mockRejectedValueOnce(failure(412, 'VERSION_MISMATCH'))
    .mockResolvedValue(group);
  await click('Save');
  expect(screen.getByLabelText('Group name')).toHaveValue('My retained draft');
  groupsService.get.mockResolvedValue({
    ...group,
    version: 4,
    etag: `"tn-${groupId}-v4"`,
    name: 'Concurrent update',
  });
  await click('Reload latest for review');
  expect(await screen.findByText(/Concurrent update/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  await click('Reviewed latest; keep my draft');
  await click('Save');
  expect(groupsService.update.mock.calls[1][0].etag).toBe(`"tn-${groupId}-v4"`);
  expect(groupsService.update.mock.calls[1][1].name).toBe('My retained draft');
});
it('never implies an ordinary member can edit metadata or leave a locked group', async () => {
  const member = { ...group, membership: { ...group.membership, role: 'member' } };
  groupsService.get.mockResolvedValue(member);
  groupsService.members.mockResolvedValue({ group: member, members });
  show(undefined, b);
  await screen.findByRole('heading', { name: group.name });
  expect(screen.queryByRole('button', { name: 'Edit group' })).not.toBeInTheDocument();
  await tab('members');
  expect(screen.queryByRole('button', { name: 'Leave group' })).not.toBeInTheDocument();
  expect(screen.getByText(/permanently prevents removal/)).toBeInTheDocument();
});
it('blocks financially locked group deletion and member removal without touching personal records', async () => {
  show();
  expect(await screen.findByRole('button', { name: 'Delete group' })).toBeDisabled();
  await tab('members');
  expect(
    screen.getAllByRole('button', { name: 'Remove member' }).every((button) => button.disabled),
  ).toBe(true);
  expect(screen.getByText(/Private email addresses are not shared/)).toBeInTheDocument();
  expect(screen.queryByText(/private@example/)).not.toBeInTheDocument();
});
it('permits explicitly confirmed removal and voluntary leaving only before financial history', async () => {
  const unlocked = { ...group, financialHistoryLocked: undefined };
  groupsService.get.mockResolvedValue(unlocked);
  groupsService.members.mockResolvedValue({ group: unlocked, members });
  show();
  await tab('members');
  await userEvent.click(screen.getAllByRole('button', { name: 'Remove member' })[0]);
  const dialog = await screen.findByRole('dialog', { name: 'Remove member' });
  expect(groupsService.removeMember).not.toHaveBeenCalled();
  await userEvent.click(within(dialog).getByRole('button', { name: 'Remove member' }));
  expect(groupsService.removeMember).toHaveBeenCalledWith(unlocked, b);
});
it('generates and copies a one-time frontend invitation link and clears it on section exit', async () => {
  const user = userEvent.setup();
  show();
  await tab('invitations');
  await click('Generate invitation');
  await fill('Maximum uses', '2');
  await user.selectOptions(screen.getByLabelText('Expires after'), '3600');
  await click('Save');
  const input = await screen.findByLabelText('One-time invitation link');
  expect(input.value).toBe(window.location.origin + '/app/join/' + token);
  const copy = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue();
  await click('Copy invitation link');
  expect(copy).toHaveBeenCalledWith(input.value);
  expect(groupInvitationsService.create.mock.calls[0][1]).toEqual({
    maxUses: 2,
    expiresInSeconds: 3600,
  });
  await tab('members');
  await tab('invitations');
  expect(screen.queryByLabelText('One-time invitation link')).not.toBeInTheDocument();
});
it('revokes invitation metadata with a freshly fetched group ETag', async () => {
  groupInvitationsService.list.mockResolvedValue({ group, invitations: [invitation] });
  show();
  await tab('invitations');
  await click('Revoke invitation');
  const dialog = await screen.findByRole('dialog', { name: 'Revoke invitation' });
  await userEvent.click(within(dialog).getByRole('button', { name: 'Revoke invitation' }));
  expect(groupInvitationsService.revoke).toHaveBeenCalledWith(group, invitation.id);
});
it('inspects safe invitation information and never accepts before an explicit action', async () => {
  show('/app/join/' + token);
  await screen.findByRole('heading', { name: group.name });
  expect(groupInvitationsService.accept).not.toHaveBeenCalled();
  expect(screen.queryByText(group.description)).not.toBeInTheDocument();
  await click('Join group');
  await waitFor(() =>
    expect(screen.getByLabelText('Current route')).toHaveTextContent('/app/groups/' + groupId),
  );
  expect(screen.getByLabelText('Current route')).not.toHaveTextContent(token);
});
it.each(['expired', 'revoked', 'invalid'])(
  'handles %s invitation links and removes the capability route',
  async () => {
    groupInvitationsService.inspect.mockRejectedValue(failure(404, 'INVITATION_UNAVAILABLE'));
    show('/app/join/' + token);
    await waitFor(() =>
      expect(screen.getByLabelText('Current route').textContent).toBe('/app/join'),
    );
    expect(screen.getByRole('heading', { name: 'Invitation unavailable' })).toBeInTheDocument();
    expect(screen.getByLabelText('Current route')).not.toHaveTextContent(token);
  },
);
it('preserves an invitation through anonymous auth redirects without storing it in history state', async () => {
  show('/app/join/' + token, a, true, 'anonymous');
  await screen.findByRole('heading', { name: 'Welcome back.' });
  expect(screen.getByLabelText('Current route')).toHaveTextContent('/login#join=' + token);
  await userEvent.click(screen.getByRole('link', { name: 'Create an account' }));
  expect(screen.getByLabelText('Current route')).toHaveTextContent('/register#join=' + token);
});
it('restores a full-page auth-fragment return path for an already authenticated session', async () => {
  show('/login#join=' + token, a, true);
  expect(await screen.findByRole('button', { name: 'Join group' })).toBeInTheDocument();
  expect(groupInvitationsService.accept).not.toHaveBeenCalled();
});
it('creates shared expenses using the exact shared equal-split algorithm and a UUID key', async () => {
  show();
  await add();
  expect(await screen.findByRole('region', { name: 'Exact split preview' })).toBeInTheDocument();
  await click('Save');
  expect(groupExpensesService.create).toHaveBeenCalledTimes(1);
  const [id, data, key] = groupExpensesService.create.mock.calls[0];
  expect(id).toBe(groupId);
  expect(data.amountMinor).toBe(10001);
  expect(data.split.participants).toEqual([a, b, c]);
  expect(key).toMatch(/^[a-f0-9-]{36}$/);
});
it('creates exact-amount and percentage splits with faithful positive allocation previews', async () => {
  show();
  await add();
  await userEvent.selectOptions(screen.getByLabelText('Split method'), 'exact');
  for (const [name, value] of [
    ['Asha', '50.01'],
    ['Bala', '25'],
    ['Charu', '25'],
  ])
    await fill(name + ' amount (INR)', value);
  expect(await screen.findByRole('region', { name: 'Exact split preview' })).toHaveTextContent(
    '₹50.01',
  );
  await userEvent.selectOptions(screen.getByLabelText('Split method'), 'percentage');
  for (const [name, value] of [
    ['Asha', '50'],
    ['Bala', '25'],
    ['Charu', '25'],
  ])
    await fill(name + ' percentage', value);
  await click('Save');
  expect(groupExpensesService.create.mock.calls[0][1].split).toEqual({
    method: 'percentage',
    participants: [
      { user: a, basisPoints: 5000 },
      { user: b, basisPoints: 2500 },
      { user: c, basisPoints: 2500 },
    ],
  });
});
it('rejects invalid split states, tiny zero-paisa beneficiaries and overprecision without an API call', async () => {
  show();
  await add();
  await fill('Total amount (INR)', '0.01');
  await click('Save');
  expect(await screen.findByRole('alert')).toHaveTextContent('zero-paisa');
  expect(groupExpensesService.create).not.toHaveBeenCalled();
  await fill('Total amount (INR)', '100.001');
  await click('Save');
  expect(screen.getByText(/positive exact amount/)).toBeInTheDocument();
  expect(groupExpensesService.create).not.toHaveBeenCalled();
});
it('retries uncertain expense creation with the same immutable payload and key, displaying replay', async () => {
  groupExpensesService.create
    .mockRejectedValueOnce(new Error('unknown'))
    .mockResolvedValueOnce({ ...expense, replayed: true });
  show();
  await add();
  await click('Save');
  expect(await screen.findByRole('button', { name: 'Retry same submission' })).toBeInTheDocument();
  expect(screen.getByLabelText('Total amount (INR)')).toBeDisabled();
  await click('Retry same submission');
  expect(groupExpensesService.create.mock.calls[0][2]).toBe(
    groupExpensesService.create.mock.calls[1][2],
  );
  expect(await screen.findByText(/Submission recovered by idempotent replay/)).toBeInTheDocument();
});
it('preserves an edit draft and sends the latest fetched expense ETag after explicit conflict review', async () => {
  groupExpensesService.list.mockResolvedValue(page([expense]));
  show();
  await tab('expenses');
  await click('Edit expense');
  await fill('Expense title', 'Kept draft');
  groupExpensesService.update
    .mockRejectedValueOnce(failure(409, 'GROUP_EXPENSE_CONFLICT'))
    .mockResolvedValueOnce(expense);
  await click('Save');
  expect(screen.getByLabelText('Expense title')).toHaveValue('Kept draft');
  groupExpensesService.get.mockResolvedValue({
    ...expense,
    version: 2,
    etag: `"tn-${expense.id}-v2"`,
    title: 'Newer title',
  });
  await click('Reload latest for review');
  await screen.findByText(/Newer title/);
  await click('Reviewed latest; keep my draft');
  await click('Save');
  expect(groupExpensesService.update.mock.calls[1][1].etag).toBe(`"tn-${expense.id}-v2"`);
});
it('deletes expenses only after confirmation and refreshes the visible ledger', async () => {
  groupExpensesService.list.mockResolvedValue(page([expense]));
  show();
  await tab('expenses');
  await click('Delete expense');
  expect(groupExpensesService.remove).not.toHaveBeenCalled();
  const dialog = await screen.findByRole('dialog', { name: 'Delete expense' });
  groupExpensesService.list.mockResolvedValue(page([]));
  await userEvent.click(within(dialog).getByRole('button', { name: 'Delete expense' }));
  expect(groupExpensesService.remove).toHaveBeenCalledWith(groupId, expense);
  expect(await screen.findByText('No shared expenses yet')).toBeInTheDocument();
});
it('protects unsaved drafts on Escape and restores focus after confirmed discard', async () => {
  show();
  await add();
  const dialog = screen.getByRole('dialog', { name: 'Add shared expense' });
  fireEvent(dialog, new Event('cancel', { cancelable: true }));
  expect(await screen.findByText('Discard this draft?')).toBeInTheDocument();
  await click('Keep editing');
  expect(screen.getByLabelText('Expense title')).toHaveValue('Trip lunch');
  await click('Cancel');
  await click('Discard and close');
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(screen.getByRole('button', { name: 'Add shared expense' })).toHaveFocus();
});
it('communicates permanent settlement mode and removes all expense mutation controls', async () => {
  const frozen = { ...group, settlementMode: true };
  groupsService.get.mockResolvedValue(frozen);
  groupsService.members.mockResolvedValue({ group: frozen, members });
  groupExpensesService.list.mockResolvedValue(page([expense]));
  show();
  await tab('expenses');
  expect(await screen.findByRole('button', { name: 'Add shared expense' })).toBeDisabled();
  expect(screen.queryByRole('button', { name: 'Edit expense' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Delete expense' })).not.toBeInTheDocument();
  expect(screen.getByText(/creation, editing and deletion are frozen/)).toBeInTheDocument();
});
it('renders signed positions, member identities, exact paise and suggestions separately from payment records', async () => {
  show();
  expect(await screen.findByText('Where everyone stands')).toBeInTheDocument();
  expect(screen.getByText('₹66.67')).toBeInTheDocument();
  expect(screen.getByText('−₹33.34')).toBeInTheDocument();
  expect(screen.getByText('Suggested transfers')).toBeInTheDocument();
  expect(screen.getByText(/do not necessarily minimize/)).toBeInTheDocument();
  expect(screen.getByText(/never a bank balance/)).toBeInTheDocument();
});
it('requires explicit first-settlement freeze acknowledgement and proposes as authenticated sender', async () => {
  const member = { ...group, membership: { ...group.membership, role: 'member' } };
  groupsService.get.mockResolvedValue(member);
  groupsService.members.mockResolvedValue({ group: member, members });
  show(undefined, b);
  await click('Propose settlement');
  await fill('Settlement amount (INR)', '10');
  await click('Save');
  expect(groupSettlementsService.create).not.toHaveBeenCalled();
  expect(screen.getByText(/Acknowledge the permanent expense freeze/)).toBeInTheDocument();
  await userEvent.click(screen.getByRole('checkbox'));
  await click('Save');
  expect(groupSettlementsService.create.mock.calls[0][1]).toEqual({
    recipient: a,
    amountMinor: 1000,
    currency: 'INR',
  });
  expect(groupSettlementsService.create.mock.calls[0][2]).toMatch(/^[a-f0-9-]{36}$/);
});
it('shows pending reservations and refuses excessive proposals on the client', async () => {
  const member = {
    ...group,
    settlementMode: true,
    membership: { ...group.membership, role: 'member' },
  };
  groupsService.get.mockResolvedValue(member);
  groupsService.members.mockResolvedValue({ group: member, members });
  groupSettlementsService.balances.mockResolvedValue({
    ...balances,
    members: balances.members.map((m) => ({
      ...m,
      pendingSentMinor: m.user === b ? 3000 : 0,
      pendingReceivedMinor: m.user === a ? 3000 : 0,
    })),
  });
  show(undefined, b);
  await click('Propose settlement');
  expect(screen.getByText(/Available debt: ₹3.34/)).toBeInTheDocument();
  await fill('Settlement amount (INR)', '4');
  await click('Save');
  expect(screen.getByText(/exceeds available debt or credit/)).toBeInTheDocument();
  expect(groupSettlementsService.create).not.toHaveBeenCalled();
});
it('only the recipient can confirm or reject and confirmation explains payment acknowledgement', async () => {
  groupSettlementsService.list.mockResolvedValue(page([pending]));
  show();
  await tab('settlements');
  await click('Confirm settlement');
  expect(await screen.findByText(/does not verify an external bank payment/)).toBeInTheDocument();
  const dialog = screen.getByRole('dialog', { name: 'Confirm settlement' });
  await userEvent.click(within(dialog).getByRole('button', { name: 'Confirm settlement' }));
  expect(groupSettlementsService.decide).toHaveBeenCalledWith(groupId, pending, 'confirm');
});
it('does not offer recipient decision controls to the sender or unrelated members', async () => {
  const member = { ...group, membership: { ...group.membership, role: 'member' } };
  groupsService.get.mockResolvedValue(member);
  groupsService.members.mockResolvedValue({ group: member, members });
  groupSettlementsService.list.mockResolvedValue(page([pending]));
  show(undefined, b);
  await tab('settlements');
  await screen.findByText(/pending ·/);
  expect(screen.queryByRole('button', { name: 'Confirm settlement' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Reject settlement' })).not.toBeInTheDocument();
});
it('unknown confirmation outcome is resolved by reading the terminal record, never automatic reconfirmation', async () => {
  groupSettlementsService.list.mockResolvedValue(page([pending]));
  groupSettlementsService.decide.mockRejectedValueOnce(new Error('unknown'));
  show();
  await tab('settlements');
  await click('Confirm settlement');
  const dialog = await screen.findByRole('dialog', { name: 'Confirm settlement' });
  await userEvent.click(within(dialog).getByRole('button', { name: 'Confirm settlement' }));
  groupSettlementsService.get.mockResolvedValue(confirmed);
  await click('Reload latest and review');
  expect(await screen.findByText(/already confirmed/)).toBeInTheDocument();
  expect(within(dialog).getByRole('button', { name: 'Confirm settlement' })).toBeDisabled();
  expect(groupSettlementsService.decide).toHaveBeenCalledTimes(1);
});
it('runs one explicit financial recovery attempt and refreshes authoritative records', async () => {
  const busy = { ...group, financialBusy: true };
  groupsService.get.mockResolvedValue(busy);
  groupsService.members.mockResolvedValue({ group: busy, members });
  groupSettlementsService.balances.mockRejectedValue(failure(409, 'FINANCIAL_BUSY'));
  show();
  groupsService.recover.mockImplementation(async () => {
    groupsService.get.mockResolvedValue(group);
    groupsService.members.mockResolvedValue({ group, members });
    groupSettlementsService.balances.mockResolvedValue(balances);
    return { recovered: true };
  });
  await click('Recover pending operation');
  expect(groupsService.recover).toHaveBeenCalledTimes(1);
  expect(groupsService.recover).toHaveBeenCalledWith(groupId);
  expect(await screen.findByText(/Recovery checked/)).toBeInTheDocument();
});
it('shares accessible Groups navigation through the existing mobile dialog', async () => {
  show('/app/groups', a, true);
  await screen.findByRole('link', { name: /Weekend house/ });
  await click('Open navigation');
  const nav = screen.getByRole('dialog', { name: 'Mobile navigation' });
  await userEvent.click(within(nav).getByRole('link', { name: 'Groups' }));
  await waitFor(() => expect(nav).not.toHaveAttribute('open'));
});
it('preserves an uncertain settlement payload and key even when its own pending reservation consumes capacity', async () => {
  const member = {
    ...group,
    settlementMode: true,
    membership: { ...group.membership, role: 'member' },
  };
  groupsService.get.mockResolvedValue(member);
  groupsService.members.mockResolvedValue({ group: member, members });
  groupSettlementsService.create
    .mockImplementationOnce(async () => {
      groupSettlementsService.balances.mockResolvedValue({
        ...balances,
        members: balances.members.map((row) => ({
          ...row,
          pendingSentMinor: row.user === b ? 3334 : 0,
          pendingReceivedMinor: row.user === a ? 3334 : 0,
        })),
      });
      throw new Error('unknown outcome');
    })
    .mockResolvedValueOnce({ ...pending, amountMinor: 3334, replayed: true });
  show(undefined, b);
  await click('Propose settlement');
  await fill('Settlement amount (INR)', '33.34');
  await click('Save');
  await screen.findByRole('button', { name: 'Retry same submission' });
  await waitFor(() => expect(screen.getByText(/Available debt: ₹0.00/)).toBeInTheDocument());
  await click('Retry same submission');
  expect(groupSettlementsService.create).toHaveBeenCalledTimes(2);
  expect(groupSettlementsService.create.mock.calls[1][1]).toEqual(
    groupSettlementsService.create.mock.calls[0][1],
  );
  expect(groupSettlementsService.create.mock.calls[1][2]).toBe(
    groupSettlementsService.create.mock.calls[0][2],
  );
  expect(await screen.findByText(/Submission recovered by idempotent replay/)).toBeInTheDocument();
});
it('uses a new intent key for a changed payload after a known rejected create', async () => {
  groupExpensesService.create
    .mockRejectedValueOnce(failure(400, 'INVALID_GROUP_EXPENSE'))
    .mockResolvedValueOnce({ ...expense, replayed: false });
  show();
  await add();
  await click('Save');
  await waitFor(() => expect(groupExpensesService.create).toHaveBeenCalledTimes(1));
  await fill('Total amount (INR)', '100.02');
  await click('Save');
  expect(groupExpensesService.create.mock.calls[1][2]).not.toBe(
    groupExpensesService.create.mock.calls[0][2],
  );
});
it('creates exact shares for selected beneficiaries while excluding the payer', async () => {
  show();
  await add();
  await userEvent.selectOptions(screen.getByLabelText('Split method'), 'exact');
  await userEvent.click(screen.getByRole('checkbox', { name: 'Asha', exact: true }));
  await fill('Bala amount (INR)', '60');
  await fill('Charu amount (INR)', '40.01');
  await click('Save');
  expect(groupExpensesService.create.mock.calls[0][1].split).toEqual({
    method: 'exact',
    participants: [
      { user: b, amountMinor: 6000 },
      { user: c, amountMinor: 4001 },
    ],
  });
  expect(groupExpensesService.create.mock.calls[0][1].payer).toBe(a);
});
it('rejects settlements only through an explicit recipient action', async () => {
  groupSettlementsService.list.mockResolvedValue(page([pending]));
  show();
  await tab('settlements');
  await click('Reject settlement');
  expect(groupSettlementsService.decide).not.toHaveBeenCalled();
  const dialog = await screen.findByRole('dialog', { name: 'Reject settlement' });
  await userEvent.click(within(dialog).getByRole('button', { name: 'Reject settlement' }));
  expect(groupSettlementsService.decide).toHaveBeenCalledWith(groupId, pending, 'reject');
});
it('shows recovery authorization failures without a forced-unlock control or retry loop', async () => {
  const busy = {
    ...group,
    financialBusy: true,
    membership: { ...group.membership, role: 'member' },
  };
  groupsService.get.mockResolvedValue(busy);
  groupsService.members.mockResolvedValue({ group: busy, members });
  groupsService.recover.mockRejectedValue(failure(403, 'RECOVERY_FORBIDDEN'));
  show(undefined, b);
  await click('Recover my interrupted operation');
  expect(
    await screen.findByText('Only the original operation actor or group owner may recover it.'),
  ).toBeInTheDocument();
  expect(groupsService.recover).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole('button', { name: /force|unlock/i })).not.toBeInTheDocument();
});
it('renders and retries a failed group listing without leaking internal messages', async () => {
  groupsService.list
    .mockRejectedValueOnce(failure(503, 'INTERNAL_ERROR'))
    .mockResolvedValueOnce(page([group]));
  show('/app/groups');
  await screen.findByRole('alert');
  expect(screen.queryByText('Do not display private errors')).not.toBeInTheDocument();
  await click('Reload records');
  expect(await screen.findByRole('link', { name: /Weekend house/ })).toBeInTheDocument();
});
