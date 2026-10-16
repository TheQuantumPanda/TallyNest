import { createHash } from 'node:crypto';
import { z } from 'zod';
import { ownerIdSchema } from '../validators/transaction.validator.js';
import { idempotencyKeySchema } from '../validators/group-expense.validator.js';
import { HttpError } from './httpError.js';

export const LIFECYCLE_KINDS = Object.freeze([
  'cycle_open_first',
  'cycle_freeze',
  'cycle_close',
  'cycle_open_next',
]);
const version = z
  .number()
  .int()
  .min(0)
  .max(Number.MAX_SAFE_INTEGER - 6);
const id = ownerIdSchema.transform((value) => value.toLowerCase());
export const firstCycleInput = z
  .object({ intent: idempotencyKeySchema, groupVersion: version })
  .strict();
export const cycleTransitionInput = firstCycleInput
  .extend({
    cycleId: id,
    epoch: z
      .number()
      .int()
      .min(1)
      .max(Number.MAX_SAFE_INTEGER - 1),
    cycleVersion: version,
  })
  .strict();
export const fingerprint = (value) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const sameId = (a, b) => String(a) === String(b);
export const lifecycleConflict = (code = 'CYCLE_LIFECYCLE_CONFLICT') =>
  new HttpError(409, 'Cycle transition cannot be reconciled; reload or recover', code);
export function lifecycleHash(op) {
  return fingerprint({
    id: String(op._id),
    actor: String(op.actor),
    kind: op.kind,
    groupId: String(op.groupId),
    cycleId: String(op.cycleId),
    cycleEpoch: op.cycleEpoch,
    expectedGroupVersion: op.expectedGroupVersion,
    expectedCycleVersion: op.expectedCycleVersion,
    targetId: String(op.targetId),
    startState: op.startState,
    payload: op.payload,
  });
}
export function assertClosable(rows) {
  if (rows.some((row) => row.reservedSent !== 0n || row.reservedReceived !== 0n))
    throw lifecycleConflict('CYCLE_PENDING_SETTLEMENTS');
  if (rows.some((row) => row.net !== 0n)) throw lifecycleConflict('CYCLE_NOT_SETTLED');
}

export function assertLifecycleReceipt(row) {
  const op = row?.operation;
  if (
    !op ||
    !LIFECYCLE_KINDS.includes(op.kind) ||
    lifecycleHash(op) !== row.operationHash ||
    op.payloadHash !== row.operationHash ||
    !sameId(row._id, op._id) ||
    !sameId(row.group, op.groupId) ||
    !sameId(row.actor, op.actor) ||
    !sameId(row.cycleId, op.targetId) ||
    row.kind !== op.kind ||
    row.intentKey !== op.payload.intentKey ||
    row.requestHash !== op.payload.requestHash ||
    row.outcome !== op.payload.outcome
  )
    throw lifecycleConflict('CYCLE_RECEIPT_INVALID');
  return row;
}
