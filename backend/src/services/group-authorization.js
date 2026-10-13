import { HttpError } from '../utils/httpError.js';
export const groupNotFound = () => new HttpError(404, 'Group not found', 'GROUP_NOT_FOUND');
export function membershipFor(group, user) { return group.members.find(row => String(row.user) === user); }
export async function requireGroupMember(repository, user, id) {
  const group = await repository.findByIdForMember(user, id);
  if (!group || !membershipFor(group, user)) throw groupNotFound();
  return group;
}
export function requireGroupOwner(group, user) {
  if (String(group.creator) !== user || membershipFor(group, user)?.role !== 'owner') throw new HttpError(403, 'Group owner permission required', 'GROUP_OWNER_REQUIRED');
  return group;
}
