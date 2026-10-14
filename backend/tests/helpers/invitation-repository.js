import { Group } from '../../src/models/group.model.js';
import { isolatedGroups } from './group-repository.js';
export function isolatedInvitations() {
  const groups = isolatedGroups();
  const clone = row => row ? Group.hydrate(row.toObject()) : null;
  async function write(groupId, expected, mutation) {
    const old = groups.records.get(groupId);
    if (!old || old.__v !== expected) return null;
    const next = clone(old); mutation(next); next.__v++;
    await next.validate();
    if (groups.records.get(groupId)?.__v !== expected) return null;
    groups.records.set(groupId, next); return clone(next);
  }
  return { groups,
    invitations: {
      async replaceInvitationsForOwner(user, groupId, expected, invitations) {
        if (String(groups.records.get(groupId)?.creator) !== user) return null;
        return write(groupId, expected, next => { next.invitations = invitations; });
      },
      async revokeForOwner(user, groupId, invitationId, expected) {
        if (String(groups.records.get(groupId)?.creator) !== user) return null;
        return write(groupId, expected, next => { next.invitations.find(row => String(row._id) === invitationId).revokedAt = new Date(); });
      },
      async findByHash(hash) { return clone([...groups.records.values()].find(row => row.invitations?.some(item => item.tokenHash === hash))); },
      async accept(user, groupId, invitation, expected) {
        const old = groups.records.get(groupId), current = old?.invitations?.find(row => String(row._id) === String(invitation._id));
        const now = new Date();
        if (!current || current.revokedAt || current.expiresAt <= now || current.accepted.length >= current.maxUses || current.accepted.some(row => String(row.user) === user) || old.members.length >= 100 || old.members.some(row => String(row.user) === user)) return null;
        return write(groupId, expected, next => { next.members.push({ user, role: 'member', createdAt: now }); next.invitations.find(row => String(row._id) === String(invitation._id)).accepted.push({ user, acceptedAt: now }); });
      },
    },
    memberships: {
      async publicProfiles(ids) { return ids.map(user => ({ _id: String(user), name: `Public ${String(user).slice(-2)}`, email: 'private@example.test', passwordHash: 'private hash' })); },
      async remove(user, groupId, target, expected, leaving = false) {
        const old = groups.records.get(groupId);
        if (!old || (leaving ? user !== target : String(old.creator) !== user) || !old.members.some(row => String(row.user) === target && row.role === 'member')) return null;
        return write(groupId, expected, next => { next.members = next.members.filter(row => String(row.user) !== target); });
      },
    },
  };
}
