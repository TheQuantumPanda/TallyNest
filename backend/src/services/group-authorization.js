import { ifMatchSchema } from '../validators/transaction-query.validator.js';
import { HttpError } from '../utils/httpError.js';
export const groupNotFound = () => new HttpError(404, 'Group not found', 'GROUP_NOT_FOUND');
export function membershipFor(group, user) {
  return group.members.find((row) => String(row.user) === user);
}
export async function requireGroupMember(repository, user, id) {
  const group = await repository.findByIdForMember(user, id);
  if (!group || !membershipFor(group, user)) throw groupNotFound();
  return group;
}
export function requireGroupOwner(group, user) {
  if (String(group.creator) !== user || membershipFor(group, user)?.role !== 'owner')
    throw new HttpError(403, 'Group owner permission required', 'GROUP_OWNER_REQUIRED');
  return group;
}

export function requireGroupVersion(group, id, ifMatch) {
  if (ifMatch === undefined)
    throw new HttpError(428, 'If-Match is required', 'PRECONDITION_REQUIRED');
  const expected = ifMatchSchema.safeParse(ifMatch);
  if (!expected.success || expected.data.id !== id.toLowerCase())
    throw new HttpError(400, 'Invalid If-Match group version', 'INVALID_VERSION');
  if (expected.data.version !== group.__v)
    throw new HttpError(412, 'Group version is stale; reload before updating', 'VERSION_MISMATCH');
  if (group.__v >= Number.MAX_SAFE_INTEGER)
    throw new HttpError(409, 'Group version exhausted', 'GROUP_CONFLICT');
  return group.__v;
}

export function requireNoFinancialHistory(group) {
  if (group.financialHistoryAt)
    throw new HttpError(
      409,
      'Group financial history permanently protects deletion and membership departure',
      'FINANCIAL_HISTORY_LOCKED',
    );
  return group;
}
