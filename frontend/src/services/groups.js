import { z } from 'zod';
import { api } from './api';
export const id = z.string().regex(/^[a-f0-9]{24}$/);
export const minor = z.number().int().positive().safe();
export const count = z.number().int().nonnegative().safe();
export const timestamp = z.iso
  .datetime({ precision: 3 })
  .refine((value) => new Date(value).toISOString() === value);
export const groupSchema = z.object({
  id,
  name: z.string().trim().min(1).max(100),
  description: z.string().max(2000).optional(),
  currency: z.literal('INR'),
  version: count,
  membership: z.object({ role: z.enum(['owner', 'member']), createdAt: timestamp }),
  createdAt: timestamp,
  updatedAt: timestamp,
  financialHistoryLocked: z.literal(true).optional(),
  settlementMode: z.literal(true).optional(),
  financialBusy: z.literal(true).optional(),
});
export const pageSchema = z
  .object({ limit: count.min(1).max(100), hasMore: z.boolean(), nextAfter: z.string().nullable() })
  .refine((page) => page.hasMore === (page.nextAfter !== null));
export function path(groupId) {
  return `/groups/${id.parse(groupId)}`;
}
export function versionHeaders(row) {
  if (row.etag !== `"tn-${id.parse(row.id)}-v${count.parse(row.version)}"`)
    throw new Error('Fetch the current record version');
  return { 'If-Match': row.etag };
}
export function single(response, field, schema) {
  const data = z
    .object({ status: z.literal('ok'), data: z.object({ [field]: schema }) })
    .parse(response.data).data[field];
  const etag = `"tn-${data.id}-v${data.version}"`;
  if (response.headers?.etag !== etag) throw new Error('Invalid record ETag');
  return { ...data, etag };
}
export function page(response, field, schema, query) {
  const data = z
    .object({
      status: z.literal('ok'),
      data: z.object({ [field]: z.array(schema).max(query.limit) }),
      pagination: pageSchema,
    })
    .parse(response.data);
  if (
    data.pagination.limit !== query.limit ||
    new Set(data.data[field].map((row) => row.id)).size !== data.data[field].length
  )
    throw new Error('Invalid page');
  return { rows: data.data[field], pagination: data.pagination };
}
export const querySchema = z
  .object({ limit: count.min(1).max(100).default(20), after: id.optional() })
  .strict();
export function success(response, message) {
  z.object({ status: z.literal('ok'), message: z.literal(message) }).parse(response.data);
}
export const groupsService = {
  async list(query = {}, signal) {
    const params = querySchema.parse(query);
    return page(await api.get('/groups', { params, signal }), 'groups', groupSchema, params);
  },
  async get(groupId, signal) {
    const row = single(await api.get(path(groupId), { signal }), 'group', groupSchema);
    if (row.id !== groupId) throw new Error('Invalid group scope');
    return row;
  },
  async create(data) {
    return single(await api.post('/groups', data), 'group', groupSchema);
  },
  async update(row, data) {
    return single(
      await api.patch(path(row.id), data, { headers: versionHeaders(row) }),
      'group',
      groupSchema,
    );
  },
  async remove(groupId) {
    success(await api.delete(path(groupId)), 'Group deleted');
  },
  async members(groupId, signal) {
    const response = await api.get(path(groupId) + '/members', { signal });
    const group = single(response, 'group', groupSchema);
    if (group.id !== groupId) throw new Error('Invalid roster scope');
    const members = z
      .array(
        z.object({ id, name: z.string(), role: z.enum(['owner', 'member']), joinedAt: timestamp }),
      )
      .min(1)
      .max(100)
      .parse(response.data.data.members);
    if (
      new Set(members.map((row) => row.id)).size !== members.length ||
      members.filter((row) => row.role === 'owner').length !== 1
    )
      throw new Error('Invalid roster');
    return { group, members };
  },
  async removeMember(row, memberId) {
    return single(
      await api.delete(path(row.id) + `/members/${id.parse(memberId)}`, {
        headers: versionHeaders(row),
      }),
      'group',
      groupSchema,
    );
  },
  async leave(row) {
    success(
      await api.post(path(row.id) + '/leave', {}, { headers: versionHeaders(row) }),
      'Group left',
    );
  },
  async recover(groupId) {
    return z
      .object({ status: z.literal('ok'), data: z.object({ recovered: z.boolean() }) })
      .parse((await api.post(path(groupId) + '/financial-recovery', {})).data).data;
  },
};
