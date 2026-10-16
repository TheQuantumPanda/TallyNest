import { beforeEach, describe, it, expect, vi } from 'vitest';
import { api } from '../services/api';
import { groupsService } from '../services/groups';
import { groupExpensesService } from '../services/groupExpenses';
import { groupSettlementsService } from '../services/groupSettlements';
import { groupInvitationsService } from '../services/groupInvitations';
import {
  group,
  groupId,
  expense,
  pending,
  confirmed,
  members,
  balances,
  invitation,
  token,
} from './fixtures/groups';
vi.mock('../services/api', () => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));
const single = (field, row, extra = {}) => ({
  data: { status: 'ok', data: { [field]: row, ...extra } },
  headers: { etag: row.etag },
});
beforeEach(() => vi.resetAllMocks());
describe('group API contracts', () => {
  it('decodes bounded group pages and forwards cursors and abort signals', async () => {
    const controller = new AbortController();
    api.get.mockResolvedValue({
      data: {
        status: 'ok',
        data: { groups: [group] },
        pagination: { limit: 20, hasMore: false, nextAfter: null },
      },
    });
    expect((await groupsService.list({}, controller.signal)).rows[0].id).toBe(groupId);
    expect(api.get).toHaveBeenCalledWith('/groups', {
      params: { limit: 20 },
      signal: controller.signal,
    });
  });
  it('requires a matching real ETag for metadata edits', async () => {
    api.patch.mockResolvedValue(single('group', group));
    await groupsService.update(group, { name: 'Changed' });
    expect(api.patch).toHaveBeenCalledWith(
      '/groups/' + groupId,
      { name: 'Changed' },
      { headers: { 'If-Match': group.etag } },
    );
    await expect(groupsService.update({ ...group, etag: 'bad' }, {})).rejects.toThrow();
  });
  it('strips private profile fields from the roster', async () => {
    api.get.mockResolvedValue({
      ...single('group', group),
      data: {
        status: 'ok',
        data: {
          group,
          members: members.map((m) => ({
            ...m,
            email: 'private@example.test',
            passwordHash: 'private',
          })),
        },
      },
    });
    expect((await groupsService.members(groupId)).members[0].email).toBeUndefined();
  });
  it('rejects malformed and inconsistent expense allocations instead of displaying partial finance data', async () => {
    api.get.mockResolvedValue(
      single('expense', { ...expense, shares: [{ user: members[0].id, amountMinor: 1 }] }),
    );
    await expect(groupExpensesService.get(groupId, expense.id)).rejects.toThrow();
  });
  it('sends UUID creation keys and retains replay metadata', async () => {
    const key = crypto.randomUUID();
    api.post.mockResolvedValue(single('expense', expense, { replayed: true }));
    expect((await groupExpensesService.create(groupId, {}, key)).replayed).toBe(true);
    expect(api.post.mock.calls[0][2].headers['Idempotency-Key']).toBe(key);
  });
  it('uses record If-Match for expense PATCH and DELETE', async () => {
    api.patch.mockResolvedValue(single('expense', expense));
    api.delete.mockResolvedValue({ data: { status: 'ok', message: 'Group expense deleted' } });
    await groupExpensesService.update(groupId, expense, { title: 'New' });
    await groupExpensesService.remove(groupId, expense);
    expect(api.patch.mock.calls[0][2].headers['If-Match']).toBe(expense.etag);
    expect(api.delete.mock.calls[0][1].headers['If-Match']).toBe(expense.etag);
  });
  it('refuses cross-group financial responses', async () => {
    api.get.mockResolvedValue(single('expense', { ...expense, groupId: members[0].id }));
    await expect(groupExpensesService.get(groupId, expense.id)).rejects.toThrow('scope');
    api.get.mockResolvedValue(single('settlement', { ...pending, groupId: members[0].id }));
    await expect(groupSettlementsService.get(groupId, pending.id)).rejects.toThrow('scope');
  });
  it('validates authoritative zero-sum balances and the response envelope', async () => {
    api.get.mockResolvedValue({ data: { status: 'ok', data: { balances } } });
    expect((await groupSettlementsService.balances(groupId)).members.length).toBe(3);
    api.get.mockResolvedValue({
      data: {
        status: 'ok',
        data: {
          balances: {
            ...balances,
            members: balances.members.map((m, i) => ({ ...m, netMinor: i === 0 ? 1 : m.netMinor })),
          },
        },
      },
    });
    await expect(groupSettlementsService.balances(groupId)).rejects.toThrow();
  });
  it('sends recipient decisions with an ETag and never accepts arbitrary action names', async () => {
    api.post.mockResolvedValue(single('settlement', confirmed));
    await groupSettlementsService.decide(groupId, pending, 'confirm');
    expect(api.post).toHaveBeenCalledWith(
      `/groups/${groupId}/settlements/${pending.id}/confirm`,
      {},
      { headers: { 'If-Match': pending.etag } },
    );
    await expect(groupSettlementsService.decide(groupId, pending, 'reverse')).rejects.toThrow();
  });
  it('validates secret-free invitation metadata and returns the one-time token only on creation', async () => {
    api.post.mockResolvedValue(single('group', group, { invitation, token }));
    expect((await groupInvitationsService.create(group, { maxUses: 2 })).token).toBe(token);
    expect(api.post.mock.calls[0][2].headers['If-Match']).toBe(group.etag);
    api.get.mockResolvedValue({
      data: {
        status: 'ok',
        data: {
          invitation: {
            group: { id: groupId, name: group.name, currency: 'INR', description: 'private' },
            expiresAt: invitation.expiresAt,
          },
        },
      },
    });
    expect((await groupInvitationsService.inspect(token)).group.description).toBeUndefined();
  });
  it('keeps financial recovery bounded to a single POST with an empty body', async () => {
    api.post.mockResolvedValue({ data: { status: 'ok', data: { recovered: true } } });
    expect(await groupsService.recover(groupId)).toEqual({ recovered: true });
    expect(api.post).toHaveBeenCalledTimes(1);
    expect(api.post).toHaveBeenCalledWith(`/groups/${groupId}/financial-recovery`, {});
  });
});
