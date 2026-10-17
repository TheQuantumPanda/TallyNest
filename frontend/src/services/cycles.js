import { z } from 'zod';
import { api } from './api';
import { id, count, minor, timestamp, pageSchema, path, versionHeaders } from './groups';
import { expenseSchema } from './groupExpenses';
import { settlementSchema } from './groupSettlements';

const etag = (row) => `"tn-${row.id}-v${row.version}"`;
export const headSchema = z
  .object({
    id,
    version: count,
    etag: z.string(),
    currentCycleId: id.nullable(),
    currentCycleState: z.enum(['open', 'frozen', 'closed']).nullable(),
    epoch: count,
    busy: z.boolean(),
  })
  .strict()
  .refine(
    (row) =>
      row.etag === etag(row) && (row.currentCycleId === null) === (row.currentCycleState === null),
  );
export const cycleSchema = z
  .object({
    id,
    groupId: id,
    sequence: count.positive(),
    previousCycleId: id.optional(),
    currency: z.literal('INR'),
    state: z.enum(['open', 'frozen', 'closed']),
    memberIds: z.array(id).min(1).max(100),
    openedAt: timestamp,
    frozenAt: timestamp.optional(),
    closedAt: timestamp.optional(),
    version: count,
    etag: z.string(),
  })
  .strict()
  .refine(
    (row) =>
      row.etag === etag(row) &&
      new Set(row.memberIds).size === row.memberIds.length &&
      row.memberIds.every((value, i, all) => i === 0 || all[i - 1] < value) &&
      (row.state === 'open'
        ? !row.frozenAt && !row.closedAt
        : row.state === 'frozen'
          ? !!row.frozenAt && !row.closedAt
          : !!row.frozenAt && !!row.closedAt),
  );
export const cycleExpenseSchema = expenseSchema.safeExtend({ cycleId: id });
export const cycleSettlementSchema = settlementSchema.safeExtend({ cycleId: id });
export const cycleBalanceSchema = z
  .object({
    groupId: id,
    cycleId: id,
    currency: z.literal('INR'),
    netTotalMinor: z.literal(0),
    members: z
      .array(
        z
          .object({
            user: id,
            paidMinor: count,
            assignedMinor: count,
            confirmedSentMinor: count,
            confirmedReceivedMinor: count,
            netMinor: z.number().int().safe(),
            pendingSentMinor: count,
            pendingReceivedMinor: count,
          })
          .strict(),
      )
      .min(1)
      .max(100),
    suggestions: z
      .array(
        z
          .object({ sender: id, recipient: id, amountMinor: minor, currency: z.literal('INR') })
          .strict(),
      )
      .max(99),
  })
  .strict();
const envelope = z.object({
  status: z.literal('ok'),
  apiVersion: z.literal(2),
  data: z.object({ group: headSchema }).passthrough(),
});
function parseResponse(response, groupId, field, schema, target) {
  const parsed = envelope.parse(response.data);
  if (
    parsed.data.group.id !== groupId ||
    response.headers?.['x-group-etag'] !== parsed.data.group.etag
  )
    throw new Error('Invalid group head');
  const value = schema.parse(parsed.data[field]);
  if (target && value.id !== target) throw new Error('Invalid resource identity');
  if (value.groupId && value.groupId !== groupId) throw new Error('Invalid group scope');
  if (value.id && response.headers?.etag !== etag(value)) throw new Error('Invalid resource ETag');
  return {
    value: value.id ? { ...value, etag: etag(value) } : value,
    group: parsed.data.group,
    raw: parsed.data,
  };
}
function page(response, groupId, kind, schema, cycleId, limit) {
  const parsed = envelope.parse(response.data);
  if (
    parsed.data.group.id !== groupId ||
    response.headers?.['x-group-etag'] !== parsed.data.group.etag
  )
    throw new Error('Invalid group head');
  const rows = z.array(schema).max(limit).parse(parsed.data[kind]);
  const pagination = pageSchema.parse(response.data.pagination);
  if (
    pagination.limit !== limit ||
    new Set(rows.map((row) => row.id)).size !== rows.length ||
    rows.some((row) => row.groupId !== groupId || (cycleId && row.cycleId !== cycleId))
  )
    throw new Error('Invalid cycle page scope');
  return { rows, pagination, group: parsed.data.group };
}
const query = z
  .object({
    limit: count.min(1).max(100).default(20),
    after: z.string().min(1).max(1200).optional(),
  })
  .strict();
function list(kind, schema, groupId, cycleId, options = {}, signal) {
  const params = { ...query.parse(options), ...(cycleId ? { cycleId: id.parse(cycleId) } : {}) };
  return api
    .get(path(groupId) + `/${kind}`, { params, signal })
    .then((response) => page(response, groupId, kind, schema, cycleId, params.limit));
}
function detail(kind, schema, groupId, target, signal) {
  return api
    .get(path(groupId) + `/${kind}/${id.parse(target)}`, { signal })
    .then((response) => parseResponse(response, groupId, kind.slice(0, -1), schema, target));
}
export function lifecycleIntent(action, group, cycle) {
  const key = crypto.randomUUID();
  if (action === 'first')
    return {
      key,
      body: {},
      headers: { 'Idempotency-Key': key, 'If-Match': headSchema.parse(group).etag },
      path: path(group.id) + '/cycles',
    };
  if (!cycle || cycle.groupId !== group.id) throw new Error('Cycle and group must match');
  const head = headSchema.parse(group),
    record = cycleSchema.parse(cycle);
  if (action === 'next')
    return {
      key,
      path: path(group.id) + '/cycles',
      body: { previousCycleId: record.id, epoch: head.epoch },
      headers: { 'Idempotency-Key': key, 'If-Match': head.etag, 'If-Cycle-Match': record.etag },
    };
  if (!['freeze', 'close'].includes(action)) throw new Error('Invalid transition');
  return {
    key,
    path: path(group.id) + `/cycles/${record.id}/${action}`,
    body: { epoch: head.epoch },
    headers: { 'Idempotency-Key': key, 'If-Match': record.etag, 'If-Group-Match': head.etag },
  };
}
export const cyclesService = {
  list: (groupId, options = {}, signal) =>
    list('cycles', cycleSchema, groupId, null, options, signal),
  get: (groupId, target, signal) => detail('cycles', cycleSchema, groupId, target, signal),
  async transition(groupId, intent) {
    const response = await api.post(intent.path, intent.body, { headers: intent.headers });
    const parsed = parseResponse(response, groupId, 'cycle', cycleSchema);
    return {
      ...parsed,
      replayed: z.boolean().parse(parsed.raw.replayed),
      transition: z
        .object({ outcome: z.string(), completedAt: timestamp })
        .parse(parsed.raw.transition),
    };
  },
  expenses: {
    list: (groupId, cycleId, options = {}, signal) =>
      list('expenses', cycleExpenseSchema, groupId, cycleId, options, signal),
    get: (groupId, target, signal) =>
      detail('expenses', cycleExpenseSchema, groupId, target, signal),
    async create(groupId, cycleId, data, key) {
      z.uuid().parse(key);
      const response = await api.post(
        path(groupId) + '/expenses',
        { ...data, cycleId: id.parse(cycleId) },
        { headers: { 'Idempotency-Key': key } },
      );
      const parsed = parseResponse(response, groupId, 'expense', cycleExpenseSchema);
      if (parsed.value.cycleId !== cycleId) throw new Error('Wrong expense cycle');
      return { ...parsed.value, replayed: z.boolean().parse(parsed.raw.replayed) };
    },
    async update(groupId, row, data) {
      const response = await api.patch(path(groupId) + `/expenses/${id.parse(row.id)}`, data, {
        headers: versionHeaders(row),
      });
      const parsed = parseResponse(response, groupId, 'expense', cycleExpenseSchema, row.id);
      if (parsed.value.cycleId !== row.cycleId) throw new Error('Expense changed cycles');
      return parsed.value;
    },
    async remove(groupId, row) {
      const response = await api.delete(path(groupId) + `/expenses/${id.parse(row.id)}`, {
        headers: versionHeaders(row),
      });
      const parsed = envelope.parse(response.data);
      if (parsed.data.group.id !== groupId || parsed.data.deleted !== true)
        throw new Error('Invalid deletion response');
    },
  },
  settlements: {
    list: (groupId, cycleId, options = {}, signal) =>
      list('settlements', cycleSettlementSchema, groupId, cycleId, options, signal),
    get: (groupId, target, signal) =>
      detail('settlements', cycleSettlementSchema, groupId, target, signal),
    async create(groupId, cycleId, data, key) {
      z.uuid().parse(key);
      const response = await api.post(
        path(groupId) + '/settlements',
        { ...data, cycleId: id.parse(cycleId) },
        { headers: { 'Idempotency-Key': key } },
      );
      const parsed = parseResponse(response, groupId, 'settlement', cycleSettlementSchema);
      if (parsed.value.cycleId !== cycleId) throw new Error('Wrong settlement cycle');
      return { ...parsed.value, replayed: z.boolean().parse(parsed.raw.replayed) };
    },
    async decide(groupId, row, action) {
      z.enum(['confirm', 'reject']).parse(action);
      const response = await api.post(
        path(groupId) + `/settlements/${id.parse(row.id)}/${action}`,
        {},
        { headers: versionHeaders(row) },
      );
      const parsed = parseResponse(response, groupId, 'settlement', cycleSettlementSchema, row.id);
      if (parsed.value.cycleId !== row.cycleId) throw new Error('Settlement changed cycles');
      return parsed.value;
    },
  },
  async balances(groupId, cycleId, signal) {
    const response = await api.get(path(groupId) + '/balances', {
      params: { cycleId: id.parse(cycleId) },
      signal,
    });
    const parsed = parseResponse(response, groupId, 'balances', cycleBalanceSchema);
    const row = parsed.value;
    if (
      row.cycleId !== cycleId ||
      row.members.reduce((sum, member) => sum + BigInt(member.netMinor), 0n) !== 0n
    )
      throw new Error('Invalid cycle balances');
    return row;
  },
  async recover(groupId) {
    const response = await api.post(path(groupId) + '/financial-recovery', {});
    const parsed = envelope.parse(response.data);
    if (
      parsed.data.group.id !== groupId ||
      response.headers?.['x-group-etag'] !== parsed.data.group.etag
    )
      throw new Error('Invalid recovery response');
    return { group: parsed.data.group, recovered: z.boolean().parse(parsed.data.recovered) };
  },
};
