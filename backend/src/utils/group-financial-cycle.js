import { ownerIdSchema } from '../validators/transaction.validator.js';

export const CYCLE_STATUSES = Object.freeze(['open', 'frozen', 'closed']);

export function isCycleStatus(value) {
  return CYCLE_STATUSES.includes(value);
}

export function canTransitionCycle(from, to) {
  return (from === 'open' && to === 'frozen') || (from === 'frozen' && to === 'closed');
}

export function nextCycleSequence(sequence) {
  if (!Number.isSafeInteger(sequence) || sequence < 1 || sequence >= Number.MAX_SAFE_INTEGER)
    throw new RangeError('Invalid cycle sequence');
  return sequence + 1;
}

export function sortedCycleMembers(ids) {
  if (!Array.isArray(ids) || ids.length < 1 || ids.length > 100)
    throw new RangeError('Invalid cycle membership snapshot');
  const sorted = ids.map((id) => ownerIdSchema.parse(String(id)).toLowerCase()).sort();
  if (new Set(sorted).size !== sorted.length) throw new RangeError('Duplicate cycle member');
  return Object.freeze(sorted);
}

export function cycleBelongsToGroup(cycle, groupId) {
  return (
    !!cycle &&
    ownerIdSchema.safeParse(String(groupId)).success &&
    String(cycle.group).toLowerCase() === String(groupId).toLowerCase()
  );
}
