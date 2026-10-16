import { createHash, randomBytes } from 'node:crypto';
import mongoose from 'mongoose';
import { invitationRepository } from '../repositories/invitation.repository.js';
import { groupRepository } from '../repositories/group.repository.js';
import {
  invitationInputSchema,
  invitationTokenSchema,
  emptyInputSchema,
  GROUP_INVITATION_LIMIT,
} from '../validators/invitation.validator.js';
import { ownerIdSchema } from '../validators/transaction.validator.js';
import { GROUP_MEMBER_LIMIT } from '../validators/group.validator.js';
import {
  requireGroupMember,
  requireGroupOwner,
  requireGroupVersion,
  membershipFor,
} from './group-authorization.js';
import { toPublicGroup } from './group.service.js';
import { HttpError } from '../utils/httpError.js';
export const invitationUnavailable = () =>
  new HttpError(404, 'Invitation unavailable', 'INVITATION_UNAVAILABLE');
export function invitationHash(token) {
  if (!invitationTokenSchema.safeParse(token).success) throw invitationUnavailable();
  return createHash('sha256').update(token).digest('hex');
}
function parse(schema, input) {
  const result = schema.safeParse(input);
  if (!result.success) throw new HttpError(400, 'Invalid invitation request', 'INVALID_INVITATION');
  return result.data;
}
function metadata(invitation, now) {
  return {
    id: String(invitation._id),
    createdAt: invitation.createdAt.toISOString(),
    expiresAt: invitation.expiresAt.toISOString(),
    maxUses: invitation.maxUses,
    usedCount: invitation.accepted.length,
    status: invitation.revokedAt
      ? 'revoked'
      : invitation.expiresAt <= now
        ? 'expired'
        : invitation.accepted.length >= invitation.maxUses
          ? 'exhausted'
          : 'active',
  };
}
export function createInvitationService({
  repository = invitationRepository,
  groups = groupRepository,
  now = () => new Date(),
} = {}) {
  async function owned(user, groupId) {
    parse(ownerIdSchema, groupId);
    return requireGroupOwner(await requireGroupMember(groups, user, groupId), user);
  }
  async function available(token) {
    const hash = invitationHash(token),
      group = await repository.findByHash(hash);
    const invitation = group?.invitations?.find((row) => row.tokenHash === hash),
      instant = now();
    if (
      !invitation ||
      invitation.revokedAt ||
      invitation.expiresAt <= instant ||
      invitation.createdAt > instant
    )
      throw invitationUnavailable();
    return { group, invitation, instant };
  }
  return {
    async create(user, groupId, input, ifMatch) {
      const data = parse(invitationInputSchema, input),
        group = await owned(user, groupId);
      requireGroupVersion(group, groupId, ifMatch);
      const instant = now(),
        retained = (group.invitations ?? []).filter(
          (row) => !row.revokedAt && row.expiresAt > instant,
        );
      if (retained.length >= GROUP_INVITATION_LIMIT)
        throw new HttpError(
          409,
          'Invitation capacity reached; revoke unused invitations or wait for expiry',
          'INVITATION_LIMIT',
        );
      const token = randomBytes(32).toString('base64url');
      const invitation = {
        _id: new mongoose.Types.ObjectId(),
        tokenHash: invitationHash(token),
        createdAt: instant,
        expiresAt: new Date(instant.getTime() + data.expiresInSeconds * 1000),
        maxUses: data.maxUses,
        accepted: [],
      };
      const updated = await repository.replaceInvitationsForOwner(user, groupId, group.__v, [
        ...retained.map((row) => (row.toObject ? row.toObject() : row)),
        invitation,
      ]);
      if (!updated)
        throw new HttpError(
          409,
          'Group changed; reload before creating an invitation',
          'GROUP_CONFLICT',
        );
      return {
        invitation: metadata(invitation, instant),
        token,
        inspectionPath: `/api/invitations/${token}`,
        acceptancePath: `/api/invitations/${token}/accept`,
        group: toPublicGroup(updated, user),
      };
    },
    async list(user, groupId, query) {
      parse(emptyInputSchema, query);
      const group = await owned(user, groupId);
      return {
        invitations: (group.invitations ?? []).map((row) => metadata(row, now())),
        group: toPublicGroup(group, user),
      };
    },
    async revoke(user, groupId, invitationId, ifMatch) {
      parse(ownerIdSchema, invitationId);
      const group = await owned(user, groupId);
      requireGroupVersion(group, groupId, ifMatch);
      if (!group.invitations?.some((row) => String(row._id) === invitationId.toLowerCase()))
        throw invitationUnavailable();
      const updated = await repository.revokeForOwner(user, groupId, invitationId, group.__v);
      if (!updated)
        throw new HttpError(409, 'Group changed; reload before revoking', 'GROUP_CONFLICT');
      return toPublicGroup(updated, user);
    },
    async inspect(token, query) {
      parse(emptyInputSchema, query);
      const { group, invitation } = await available(token);
      if (invitation.accepted.length >= invitation.maxUses) throw invitationUnavailable();
      return {
        group: { id: String(group._id), name: group.name, currency: group.currency },
        expiresAt: invitation.expiresAt.toISOString(),
      };
    },
    async accept(user, token, input) {
      parse(emptyInputSchema, input);
      const { group, invitation } = await available(token);
      if (membershipFor(group, user))
        throw new HttpError(409, 'You are already a group member', 'ALREADY_MEMBER');
      if (invitation.accepted.some((row) => String(row.user) === user))
        throw new HttpError(
          409,
          'This invitation was already accepted by this account',
          'ALREADY_ACCEPTED',
        );
      if (invitation.accepted.length >= invitation.maxUses) throw invitationUnavailable();
      if (group.members.length >= GROUP_MEMBER_LIMIT)
        throw new HttpError(409, 'Group member limit reached', 'GROUP_FULL');
      if (group.__v >= Number.MAX_SAFE_INTEGER)
        throw new HttpError(409, 'Group version exhausted', 'GROUP_CONFLICT');
      const updated = await repository.accept(user, String(group._id), invitation, group.__v);
      if (!updated) {
        const latest = await available(token);
        if (membershipFor(latest.group, user))
          throw new HttpError(409, 'You are already a group member', 'ALREADY_MEMBER');
        if (latest.invitation.accepted.some((row) => String(row.user) === user))
          throw new HttpError(
            409,
            'This invitation was already accepted by this account',
            'ALREADY_ACCEPTED',
          );
        if (latest.invitation.accepted.length >= latest.invitation.maxUses)
          throw invitationUnavailable();
        if (latest.group.members.length >= GROUP_MEMBER_LIMIT)
          throw new HttpError(409, 'Group member limit reached', 'GROUP_FULL');
        throw new HttpError(
          409,
          'Group changed; review the invitation and retry',
          'GROUP_CONFLICT',
        );
      }
      return toPublicGroup(updated, user);
    },
  };
}
