import { groupRepository } from '../repositories/group.repository.js';
import { membershipRepository } from '../repositories/membership.repository.js';
import { emptyInputSchema } from '../validators/invitation.validator.js';
import { ownerIdSchema } from '../validators/transaction.validator.js';
import {
  requireGroupMember,
  requireGroupOwner,
  requireGroupVersion,
  membershipFor,
  requireNoFinancialHistory,
} from './group-authorization.js';
import { toPublicGroup } from './group.service.js';
import { HttpError } from '../utils/httpError.js';
const parse = (schema, input) => {
  const result = schema.safeParse(input);
  if (!result.success) throw new HttpError(400, 'Invalid membership request', 'INVALID_MEMBERSHIP');
  return result.data;
};
export function createMembershipService({
  repository = membershipRepository,
  groups = groupRepository,
} = {}) {
  return {
    async list(user, groupId, query) {
      parse(ownerIdSchema, groupId);
      parse(emptyInputSchema, query);
      const group = await requireGroupMember(groups, user, groupId);
      const profiles = await repository.publicProfiles(group.members.map((row) => row.user));
      const current = await requireGroupMember(groups, user, groupId);
      if (current.__v !== group.__v)
        throw new HttpError(409, 'Group changed; reload the member list', 'GROUP_CONFLICT');
      const names = new Map(profiles.map((row) => [String(row._id), row.name]));
      return {
        group: toPublicGroup(group, user),
        members: group.members.map((row) => ({
          id: String(row.user),
          name: names.get(String(row.user)) ?? 'Unavailable account',
          role: row.role,
          joinedAt: row.createdAt.toISOString(),
        })),
      };
    },
    async remove(user, groupId, target, ifMatch, leaving = false) {
      parse(ownerIdSchema, groupId);
      parse(ownerIdSchema, target);
      const group = await requireGroupMember(groups, user, groupId);
      if (!leaving) requireGroupOwner(group, user);
      const member = membershipFor(group, target.toLowerCase());
      if (!member) throw new HttpError(404, 'Member not found', 'MEMBER_NOT_FOUND');
      if (member.role === 'owner')
        throw new HttpError(409, 'The sole owner cannot leave or be removed', 'OWNER_PROTECTED');
      requireNoFinancialHistory(group);
      requireGroupVersion(group, groupId, ifMatch);
      const updated = await repository.remove(user, groupId, target, group.__v, leaving);
      if (!updated) {
        const latest = await requireGroupMember(groups, user, groupId);
        if (!leaving) requireGroupOwner(latest, user);
        requireNoFinancialHistory(latest);
        throw new HttpError(
          409,
          'Group changed; reload before changing membership',
          'GROUP_CONFLICT',
        );
      }
      return leaving ? null : toPublicGroup(updated, user);
    },
  };
}
