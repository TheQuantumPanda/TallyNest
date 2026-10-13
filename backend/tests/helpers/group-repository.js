import { Group } from '../../src/models/group.model.js';
import { groupInputSchema } from '../../src/validators/group.validator.js';
export function isolatedGroups() {
  const records = new Map();
  const copy = row => row ? Group.hydrate(row.toObject()) : null;
  const member = (row, user) => row?.members.some(item => String(item.user) === user);
  const owner = (row, user) => String(row?.creator) === user && row?.members.some(item => String(item.user) === user && item.role === 'owner');
  return {
    records,
    async createForOwner(user, input) {
      const date = new Date('2026-10-13T00:00:00.000Z');
      const row = new Group({ ...groupInputSchema.parse(input), creator: user, __v: 0,
        members: [{ user, role: 'owner', createdAt: date }], createdAt: date, updatedAt: date });
      await row.validate(); records.set(String(row._id), row); return copy(row);
    },
    async findByIdForMember(user, id) { const row = records.get(id); return member(row, user) ? copy(row) : null; },
    async findPageForMember(user, { limit, after }) { return [...records.values()].filter(row => member(row, user) && (!after || String(row._id) < after)).sort((a, b) => String(b._id).localeCompare(String(a._id))).slice(0, limit + 1).map(copy); },
    async replaceForOwner(user, id, version, data) {
      const row = records.get(id);
      if (!owner(row, user) || row.__v !== version) return null;
      const updated = new Group({ ...row.toObject(), ...groupInputSchema.parse(data), description: data.description, __v: version + 1 });
      await updated.validate(); if (records.get(id)?.__v !== version) return null;
      records.set(id, updated); return copy(updated);
    },
    async deleteForOwner(user, id) { const row = records.get(id); if (!owner(row, user)) return null; records.delete(id); return copy(row); },
    async seedMember(id, user) { const row = records.get(id); row.members.push({ user, role: 'member', createdAt: new Date() }); await row.validate(); },
  };
}
