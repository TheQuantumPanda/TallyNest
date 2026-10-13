import { z } from 'zod';
import { api } from './api';
import { transactionSchema } from './transactions';
import { isCategoryForType } from '../../../shared/transaction.constants.js';
import { FREQUENCIES, utcTimestampSchema } from '../utils/recurring';

const idSchema = z.string().regex(/^[a-f0-9]{24}$/i);
const count = z.number().int().nonnegative().safe();
const fields = { ...transactionSchema.shape };
delete fields.transactionDate;
delete fields.recurrence;
export const scheduleSchema = z
  .object({
    ...fields,
    frequency: z.enum(FREQUENCIES),
    startDate: utcTimestampSchema,
    endDate: utcTimestampSchema.optional(),
    status: z.enum(['active', 'paused']),
    nextOccurrenceDate: utcTimestampSchema.nullable(),
    exhausted: z.boolean(),
    processing: z.boolean(),
  })
  .refine(
    (row) =>
      isCategoryForType(row.category, row.type) &&
      row.exhausted === (row.nextOccurrenceDate === null) &&
      (!row.endDate || row.endDate >= row.startDate) &&
      (!row.nextOccurrenceDate ||
        (row.nextOccurrenceDate >= row.startDate &&
          (!row.endDate || row.nextOccurrenceDate <= row.endDate))),
  );
const querySchema = z
  .object({
    status: z.enum(['active', 'paused']).optional(),
    limit: z.number().int().min(1).max(100).default(20),
    after: idSchema.optional(),
  })
  .strict();
const paginationSchema = z
  .object({
    limit: z.number().int().min(1).max(100),
    hasMore: z.boolean(),
    nextAfter: idSchema.nullable(),
  })
  .refine((page) => page.hasMore === (page.nextAfter !== null));
const processingSchema = z.object({
  attempted: count.max(20),
  generated: count,
  recovered: count,
  advanced: count,
  conflicts: count,
  errors: count,
  hasMoreDue: z.boolean(),
});
function single(response) {
  const row = z
    .object({ status: z.literal('ok'), data: z.object({ schedule: scheduleSchema }) })
    .parse(response.data).data.schedule;
  const expected = `"tn-${row.id}-v${row.version}"`;
  if (response.headers?.etag !== expected) throw new Error('Invalid schedule ETag response');
  return { ...row, etag: response.headers.etag };
}
const versionHeaders = (row) => {
  idSchema.parse(row.id);
  if (row.etag !== `"tn-${row.id}-v${count.parse(row.version)}"`)
    throw new Error('Fetch the current schedule version first');
  return { 'If-Match': row.etag };
};
export const recurringService = {
  async list(query, signal) {
    const params = querySchema.parse(query);
    const response = await api.get('/recurring', { params, signal });
    const result = z
      .object({
        status: z.literal('ok'),
        data: z.object({ schedules: z.array(scheduleSchema).max(params.limit) }),
        pagination: paginationSchema,
      })
      .parse(response.data);
    if (
      result.pagination.limit !== params.limit ||
      result.data.schedules.some((row) => params.status && row.status !== params.status)
    )
      throw new Error('Invalid schedule page');
    return { schedules: result.data.schedules, pagination: result.pagination };
  },
  async get(id, signal) {
    idSchema.parse(id);
    return single(await api.get(`/recurring/${id}`, { signal }));
  },
  async create(data) {
    return single(await api.post('/recurring', data));
  },
  async update(row, data) {
    return single(await api.patch(`/recurring/${row.id}`, data, { headers: versionHeaders(row) }));
  },
  async lifecycle(row, action) {
    z.enum(['pause', 'resume']).parse(action);
    return single(
      await api.post(`/recurring/${row.id}/${action}`, {}, { headers: versionHeaders(row) }),
    );
  },
  async remove(id) {
    idSchema.parse(id);
    z.object({ status: z.literal('ok'), message: z.literal('Recurring schedule deleted') }).parse(
      (await api.delete(`/recurring/${id}`)).data,
    );
  },
  async process() {
    const result = z
      .object({ status: z.literal('ok'), data: z.object({ processing: processingSchema }) })
      .parse((await api.post('/recurring/process', { limit: 20 })).data).data.processing;
    if (
      result.generated + result.recovered > result.attempted ||
      result.advanced > result.attempted ||
      result.errors > result.attempted ||
      result.conflicts > result.attempted
    )
      throw new Error('Invalid processing result');
    return result;
  },
};
