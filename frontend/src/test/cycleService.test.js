import { beforeEach, expect, it, vi } from 'vitest';
import { api } from '../services/api';
import { cyclesService, cycleSchema, lifecycleIntent } from '../services/cycles';
import { a, b, groupId, expense, pending, balances, date } from './fixtures/groups';

vi.mock('../services/api', () => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));
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
const response = (data, resource) => ({
  data: {
    status: 'ok',
    apiVersion: 2,
    data: { group: head, ...data },
    ...(Array.isArray(resource)
      ? { pagination: { limit: 20, hasMore: false, nextAfter: null } }
      : {}),
  },
  headers: { 'x-group-etag': head.etag, ...(resource?.etag ? { etag: resource.etag } : {}) },
});
beforeEach(() => vi.resetAllMocks());

it('accepts strict version-2 cycle identity and rejects malformed state or group heads', async () => {
  expect(cycleSchema.parse(cycle).sequence).toBe(1);
  expect(() => cycleSchema.parse({ ...cycle, memberIds: [a, a] })).toThrow();
  api.get.mockResolvedValue(response({ cycle }, cycle));
  expect((await cyclesService.get(groupId, cycleId)).value).toEqual(cycle);
  api.get.mockResolvedValue({
    ...response({ cycle }, cycle),
    headers: { etag: cycle.etag, 'x-group-etag': 'forged' },
  });
  await expect(cyclesService.get(groupId, cycleId)).rejects.toThrow('Invalid group head');
});

it('binds signed pagination to an explicit cycle and rejects cross-cycle rows', async () => {
  api.get.mockResolvedValue(response({ expenses: [{ ...expense, cycleId }] }, []));
  expect((await cyclesService.expenses.list(groupId, cycleId)).rows[0].amountMinor).toBe(10001);
  expect(api.get).toHaveBeenCalledWith(`/groups/${groupId}/expenses`, {
    params: { limit: 20, cycleId },
    signal: undefined,
  });
  api.get.mockResolvedValue(
    response({ expenses: [{ ...expense, cycleId: '507f1f77bcf86cd799439099' }] }, []),
  );
  await expect(cyclesService.expenses.list(groupId, cycleId)).rejects.toThrow(
    'Invalid cycle page scope',
  );
});

it('preserves exact original lifecycle headers and payload on replay', async () => {
  const intent = lifecycleIntent('freeze', head, cycle);
  api.post.mockResolvedValue(
    response(
      {
        cycle: {
          ...cycle,
          state: 'frozen',
          frozenAt: date,
          version: 1,
          etag: `"tn-${cycleId}-v1"`,
        },
        replayed: true,
        transition: { outcome: 'frozen', completedAt: date },
      },
      { etag: `"tn-${cycleId}-v1"` },
    ),
  );
  expect((await cyclesService.transition(groupId, intent)).replayed).toBe(true);
  expect(api.post).toHaveBeenCalledWith(
    `/groups/${groupId}/cycles/${cycleId}/freeze`,
    { epoch: 1 },
    { headers: intent.headers },
  );
  expect(intent.headers).toEqual({
    'Idempotency-Key': intent.key,
    'If-Match': cycle.etag,
    'If-Group-Match': head.etag,
  });
  expect(
    lifecycleIntent(
      'next',
      { ...head, currentCycleState: 'closed' },
      { ...cycle, state: 'closed', frozenAt: date, closedAt: date },
    ).headers['If-Cycle-Match'],
  ).toBe(cycle.etag);
});

it('sends explicit cycle IDs, exact paise, and resource ETags', async () => {
  api.post.mockResolvedValue(
    response({ expense: { ...expense, cycleId }, replayed: false }, expense),
  );
  await cyclesService.expenses.create(
    groupId,
    cycleId,
    { title: expense.title, amountMinor: 10001 },
    'e470e3cf-2d35-43de-b594-f07aad47de09',
  );
  expect(api.post.mock.calls[0][1]).toEqual({ title: expense.title, amountMinor: 10001, cycleId });
  expect(api.post.mock.calls[0][2].headers['Idempotency-Key']).toBeTruthy();
  api.patch.mockResolvedValue(response({ expense: { ...expense, cycleId } }, expense));
  await cyclesService.expenses.update(groupId, { ...expense, cycleId }, { title: 'Updated' });
  expect(api.patch.mock.calls[0][2].headers).toEqual({ 'If-Match': expense.etag });
  api.post.mockResolvedValue(
    response({ settlement: { ...pending, cycleId }, replayed: false }, pending),
  );
  await cyclesService.settlements.create(
    groupId,
    cycleId,
    { recipient: b, amountMinor: 1 },
    'e470e3cf-2d35-43de-b594-f07aad47de10',
  );
  expect(api.post.mock.calls.at(-1)[1]).toEqual({ recipient: b, amountMinor: 1, cycleId });
});

it('validates cycle-only balances with exact zero-sum', async () => {
  const row = { ...balances, cycleId };
  delete row.settlementMode;
  api.get.mockResolvedValue(response({ balances: row }));
  expect((await cyclesService.balances(groupId, cycleId)).netTotalMinor).toBe(0);
  api.get.mockResolvedValue(
    response({
      balances: {
        ...row,
        members: row.members.map((member, index) =>
          index === 0 ? { ...member, netMinor: 1 } : member,
        ),
      },
    }),
  );
  await expect(cyclesService.balances(groupId, cycleId)).rejects.toThrow('Invalid cycle balances');
});

it('uses the cycle workspace in the normal authenticated group route tree', async () => {
  const source = await import('../App');
  expect(source.default).toBeTypeOf('function');
  const fs = await import('node:fs/promises');
  const app = await fs.readFile('src/App.jsx', 'utf8');
  const main = await fs.readFile('src/main.jsx', 'utf8');
  expect(app).toContain('CycleWorkspace');
  expect(main).not.toContain('cycle-test');
});

it('requires resource-specific ETags and a fixed predecessor for opening the next cycle', () => {
  const first = lifecycleIntent(
    'first',
    { ...head, currentCycleId: null, currentCycleState: null, epoch: 0 },
    null,
  );
  expect(first.body).toEqual({});
  expect(first.headers).toMatchObject({ 'If-Match': head.etag, 'Idempotency-Key': first.key });
  const closed = { ...cycle, state: 'closed', frozenAt: date, closedAt: date };
  const next = lifecycleIntent('next', { ...head, currentCycleState: 'closed' }, closed);
  expect(next.body).toEqual({ previousCycleId: cycleId, epoch: 1 });
  expect(next.headers).toMatchObject({ 'If-Match': head.etag, 'If-Cycle-Match': cycle.etag });
  expect(next.key).not.toBe(first.key);
  expect(() =>
    lifecycleIntent('close', head, { ...closed, groupId: '507f1f77bcf86cd799439099' }),
  ).toThrow();
});

it('requires the original expense ETag for deletion and the recipient record ETag for decisions', async () => {
  api.delete.mockResolvedValue(response({ deleted: true }));
  await cyclesService.expenses.remove(groupId, { ...expense, cycleId });
  expect(api.delete).toHaveBeenCalledWith(`/groups/${groupId}/expenses/${expense.id}`, {
    headers: { 'If-Match': expense.etag },
  });
  api.post.mockResolvedValue(response({ settlement: { ...pending, cycleId } }, pending));
  await cyclesService.settlements.decide(groupId, { ...pending, cycleId }, 'confirm');
  expect(api.post).toHaveBeenCalledWith(
    `/groups/${groupId}/settlements/${pending.id}/confirm`,
    {},
    { headers: { 'If-Match': pending.etag } },
  );
});

it('recovery sends one explicit mutation and checks the authoritative group head', async () => {
  api.post.mockResolvedValue(response({ recovered: true }));
  expect((await cyclesService.recover(groupId)).recovered).toBe(true);
  expect(api.post).toHaveBeenCalledWith(`/groups/${groupId}/financial-recovery`, {});
  api.post.mockResolvedValue({
    ...response({ recovered: true }),
    headers: { 'x-group-etag': 'forged' },
  });
  await expect(cyclesService.recover(groupId)).rejects.toThrow('Invalid recovery response');
});
