import { createWithIntent } from '../utils/creation-intent.js';
import { recurringRepository } from '../repositories/recurring.repository.js';
import {
  recurringInputSchema,
  recurringPatchSchema,
  recurringQuerySchema,
} from '../validators/recurring.validator.js';
import { ownerIdSchema } from '../validators/transaction.validator.js';
import { ifMatchSchema } from '../validators/transaction-query.validator.js';
import { scheduleValues } from '../utils/recurrence.js';
import { HttpError } from '../utils/httpError.js';
const missing = () => new HttpError(404, 'Recurring schedule not found', 'RECURRING_NOT_FOUND');
const busy = () =>
  new HttpError(
    409,
    'An occurrence is being completed; process due schedules and reload before retrying',
    'RECURRING_BUSY',
  );
function id(value) {
  if (!ownerIdSchema.safeParse(value).success)
    throw new HttpError(400, 'Invalid recurring schedule ID', 'INVALID_RECURRING_ID');
  return value;
}
function parse(schema, input, code = 'INVALID_RECURRING') {
  const result = schema.safeParse(input);
  if (!result.success) throw new HttpError(400, 'Invalid recurring request', code);
  return result.data;
}
export function toPublicSchedule(document) {
  return {
    id: String(document._id),
    version: document.__v,
    ...scheduleValues(document),
    nextOccurrenceDate: document.nextOccurrenceDate?.toISOString() ?? null,
    exhausted: document.nextOccurrenceDate == null,
    processing: !!document.pending,
    createdAt: document.createdAt.toISOString(),
    updatedAt: document.updatedAt.toISOString(),
  };
}
export function createRecurringService({ repository = recurringRepository } = {}) {
  return {
    async create(owner, input, idempotencyKey) {
      const data = parse(recurringInputSchema, input);
      const result = await createWithIntent(repository, owner, data, idempotencyKey);
      return { schedule: toPublicSchedule(result.document), replayed: result.replayed };
    },
    async list(owner, input) {
      const query = parse(recurringQuerySchema, input, 'INVALID_QUERY');
      const rows = await repository.listForOwner(owner, query),
        hasMore = rows.length > query.limit;
      const page = rows.slice(0, query.limit);
      return {
        schedules: page.map(toPublicSchedule),
        pagination: {
          limit: query.limit,
          hasMore,
          nextAfter: hasMore ? String(page.at(-1)._id) : null,
        },
      };
    },
    async get(owner, scheduleId) {
      const document = await repository.findByIdForOwner(owner, id(scheduleId));
      if (!document) throw missing();
      return toPublicSchedule(document);
    },
    async update(owner, scheduleId, input, ifMatch) {
      id(scheduleId);
      const patch = parse(recurringPatchSchema, input);
      const existing = await repository.findByIdForOwner(owner, scheduleId);
      if (!existing) throw missing();
      if (ifMatch === undefined)
        throw new HttpError(428, 'If-Match is required', 'PRECONDITION_REQUIRED');
      const expected = ifMatchSchema.safeParse(ifMatch);
      if (!expected.success || expected.data.id !== scheduleId.toLowerCase())
        throw new HttpError(400, 'Invalid If-Match schedule version', 'INVALID_VERSION');
      if (expected.data.version !== existing.__v)
        throw new HttpError(
          412,
          'Schedule version is stale; reload before updating',
          'VERSION_MISMATCH',
        );
      if (existing.pending) throw busy();
      if (existing.__v >= Number.MAX_SAFE_INTEGER - 2)
        throw new HttpError(409, 'Schedule version exhausted', 'RECURRING_CONFLICT');
      const merged = { ...scheduleValues(existing), ...patch };
      for (const key of ['notes', 'endDate']) if (merged[key] === null) delete merged[key];
      const updated = await repository.replaceForOwner(
        owner,
        scheduleId,
        existing.__v,
        parse(recurringInputSchema, merged),
        existing.lastOccurrenceDate,
      );
      if (!updated) {
        const current = await repository.findByIdForOwner(owner, scheduleId);
        if (!current) throw missing();
        if (current.pending) throw busy();
        throw new HttpError(409, 'Schedule changed; reload and retry', 'RECURRING_CONFLICT');
      }
      return toPublicSchedule(updated);
    },
    async remove(owner, scheduleId) {
      if (!(await repository.deleteForOwner(owner, id(scheduleId)))) {
        if (await repository.findByIdForOwner(owner, scheduleId)) throw busy();
        throw missing();
      }
    },
  };
}
