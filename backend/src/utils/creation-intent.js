import { createHash } from 'node:crypto';
import { idempotencyKeySchema } from '../validators/group-expense.validator.js';
import { HttpError } from './httpError.js';
const hash = (value) => createHash('sha256').update(value).digest('hex');
export const creationReceiptFields = {
  creationKey: { type: String, match: /^[a-f0-9]{64}$/, immutable: true },
  creationHash: { type: String, match: /^[a-f0-9]{64}$/, immutable: true },
};
export function validCreationReceipt(document) {
  return !!document.creationKey === !!document.creationHash;
}
// Zod has already normalized defaults, text and UTC timestamps. Sort field names
// explicitly so property insertion order cannot change an intent fingerprint.
export async function createWithIntent(repository, owner, data, rawKey) {
  const parsed = idempotencyKeySchema.safeParse(rawKey);
  if (!parsed.success)
    throw new HttpError(400, 'A UUID Idempotency-Key is required', 'IDEMPOTENCY_KEY_REQUIRED');
  const creationKey = hash(parsed.data.toLowerCase());
  const creationHash = hash(
    JSON.stringify(
      Object.fromEntries(
        Object.keys(data)
          .sort()
          .map((key) => [key, data[key]]),
      ),
    ),
  );
  function replay(row) {
    if (row.creationHash !== creationHash)
      throw new HttpError(409, 'Creation key was used for different data', 'IDEMPOTENCY_CONFLICT');
    if (row.deletedAt)
      throw new HttpError(
        409,
        'The original record was deleted; this intent cannot recreate it',
        'CREATION_DELETED',
      );
    return { document: row, replayed: true };
  }
  const previous = await repository.findCreationReceipt(owner, creationKey);
  if (previous) return replay(previous);
  try {
    return {
      document: await repository.createForOwner(owner, data, { creationKey, creationHash }),
      replayed: false,
    };
  } catch (error) {
    // Do not blindly retry unknown writes. Only reconcile an actual unique clash.
    if (error.code !== 11000) throw error;
    const receipt = await repository.findCreationReceipt(owner, creationKey);
    if (!receipt) throw error;
    return replay(receipt);
  }
}
