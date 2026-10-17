import { z } from 'zod';
import { ownerIdSchema } from '../validators/transaction.validator.js';
import { ifMatchSchema } from '../validators/transaction-query.validator.js';
import { HttpError } from '../utils/httpError.js';
export const id = ownerIdSchema.transform((value) => value.toLowerCase());
export const empty = z.object({}).strict();
export const epoch = z
  .number()
  .int()
  .positive()
  .max(Number.MAX_SAFE_INTEGER - 1);
export const pageQuery = z
  .object({
    limit: z
      .string()
      .regex(/^[1-9]\d{0,2}$/)
      .transform(Number)
      .pipe(z.number().int().max(100))
      .default(20),
    after: z.string().min(1).max(1200).optional(),
    cycleId: id.optional(),
  })
  .strict();
export function parse(schema, value, code = 'INVALID_REQUEST') {
  const result = schema.safeParse(value);
  if (!result.success) throw new HttpError(400, 'Invalid staged cycle request', code);
  return result.data;
}
export const etag = (row) => `"tn-${row._id}-v${row.__v}"`;
export function expected(value, resource) {
  if (value === undefined)
    throw new HttpError(428, 'Resource precondition is required', 'PRECONDITION_REQUIRED');
  const parsed = parse(ifMatchSchema, value, 'INVALID_VERSION');
  if (parsed.id !== resource)
    throw new HttpError(400, 'Wrong precondition resource', 'INVALID_VERSION');
  return parsed.version;
}
export function currentVersion(value, row) {
  const version = expected(value, String(row._id));
  if (version !== row.__v)
    throw new HttpError(412, 'Resource version is stale', 'VERSION_MISMATCH');
  if (version >= Number.MAX_SAFE_INTEGER)
    throw new HttpError(409, 'Resource version exhausted', 'FINANCIAL_VERSION_EXHAUSTED');
  return version;
}
export const missing = () => new HttpError(404, 'Financial resource not found', 'NOT_FOUND');
export function publicCycle(row) {
  return {
    id: String(row._id),
    groupId: String(row.group),
    sequence: row.sequence,
    ...(row.previousCycleId ? { previousCycleId: String(row.previousCycleId) } : {}),
    currency: row.currency,
    state: row.status,
    memberIds: row.memberIds.map(String),
    openedAt: row.openedAt.toISOString(),
    ...(row.frozenAt ? { frozenAt: row.frozenAt.toISOString() } : {}),
    ...(row.closedAt ? { closedAt: row.closedAt.toISOString() } : {}),
    version: row.__v,
    etag: etag(row),
  };
}
export function publicHead(group) {
  return {
    id: String(group._id),
    version: group.__v,
    etag: etag(group),
    currentCycleId: group.currentCycleId ? String(group.currentCycleId) : null,
    currentCycleState: group.currentCycleState ?? null,
    epoch: group.cycleEpoch ?? 0,
    busy: !!group.financialOperation,
  };
}
