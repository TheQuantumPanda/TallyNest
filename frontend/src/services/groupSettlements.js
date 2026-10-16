import { z } from 'zod';
import { api } from './api';
import {
  id,
  minor,
  count,
  timestamp,
  single,
  page,
  path,
  versionHeaders,
  querySchema,
} from './groups';
export const settlementSchema = z
  .object({
    id,
    groupId: id,
    sender: id,
    recipient: id,
    amountMinor: minor,
    currency: z.literal('INR'),
    status: z.enum(['pending', 'confirmed', 'rejected']),
    version: count.max(1),
    createdAt: timestamp,
    confirmedAt: timestamp.optional(),
    rejectedAt: timestamp.optional(),
    decisionBy: id.optional(),
  })
  .refine(
    (row) =>
      row.sender !== row.recipient &&
      (row.status === 'pending'
        ? row.version === 0 && !row.confirmedAt && !row.rejectedAt && !row.decisionBy
        : row.version === 1 &&
          row.decisionBy === row.recipient &&
          (row.status === 'confirmed'
            ? !!row.confirmedAt && !row.rejectedAt
            : !!row.rejectedAt && !row.confirmedAt)),
  );
const position = z.object({
  user: id,
  paidMinor: count,
  assignedMinor: count,
  confirmedSentMinor: count,
  confirmedReceivedMinor: count,
  netMinor: z.number().int().safe(),
  pendingSentMinor: count,
  pendingReceivedMinor: count,
});
export const balanceSchema = z.object({
  groupId: id,
  currency: z.literal('INR'),
  settlementMode: z.boolean(),
  members: z.array(position).min(1).max(100),
  suggestions: z
    .array(z.object({ sender: id, recipient: id, amountMinor: minor, currency: z.literal('INR') }))
    .max(99),
  netTotalMinor: z.literal(0),
});
function scoped(row, groupId, target) {
  if (row.groupId !== groupId || (target && row.id !== target))
    throw new Error('Invalid settlement scope');
  return row;
}
export const groupSettlementsService = {
  async balances(groupId, signal) {
    const row = balanceSchema.parse(
      z
        .object({ status: z.literal('ok'), data: z.object({ balances: balanceSchema }) })
        .parse((await api.get(path(groupId) + '/balances', { signal })).data).data.balances,
    );
    if (
      row.groupId !== groupId ||
      new Set(row.members.map((m) => m.user)).size !== row.members.length ||
      row.members.reduce((sum, m) => sum + BigInt(m.netMinor), 0n) !== 0n
    )
      throw new Error('Invalid balance response');
    return row;
  },
  async list(groupId, query = {}, signal) {
    const params = querySchema.parse(query);
    const result = page(
      await api.get(path(groupId) + '/settlements', { params, signal }),
      'settlements',
      settlementSchema,
      params,
    );
    result.rows.forEach((row) => scoped(row, groupId));
    return result;
  },
  async get(groupId, target, signal) {
    return scoped(
      single(
        await api.get(path(groupId) + `/settlements/${id.parse(target)}`, { signal }),
        'settlement',
        settlementSchema,
      ),
      groupId,
      target,
    );
  },
  async create(groupId, data, key) {
    z.uuid().parse(key);
    const response = await api.post(path(groupId) + '/settlements', data, {
      headers: { 'Idempotency-Key': key },
    });
    return {
      ...scoped(single(response, 'settlement', settlementSchema), groupId),
      replayed: z.boolean().parse(response.data.data.replayed),
    };
  },
  async decide(groupId, row, action) {
    z.enum(['confirm', 'reject']).parse(action);
    return scoped(
      single(
        await api.post(
          path(groupId) + `/settlements/${id.parse(row.id)}/${action}`,
          {},
          { headers: versionHeaders(row) },
        ),
        'settlement',
        settlementSchema,
      ),
      groupId,
      row.id,
    );
  },
};
