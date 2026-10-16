import { groupRepository } from '../repositories/group.repository.js';
import {
  groupInputSchema,
  groupPatchSchema,
  groupQuerySchema,
} from '../validators/group.validator.js';
import { ownerIdSchema } from '../validators/transaction.validator.js';
import { HttpError } from '../utils/httpError.js';
import {
  groupNotFound,
  membershipFor,
  requireGroupMember,
  requireGroupOwner,
  requireGroupVersion,
  requireNoFinancialHistory,
} from './group-authorization.js';
function parse(schema, input, code = 'INVALID_GROUP') {
  const result = schema.safeParse(input);
  if (!result.success) throw new HttpError(400, 'Invalid group request', code);
  return result.data;
}
function groupId(id) {
  return parse(ownerIdSchema, id, 'INVALID_GROUP_ID');
}
export function toPublicGroup(document, user) {
  const membership = membershipFor(document, user);
  if (!membership) throw groupNotFound();
  return {
    id: String(document._id),
    name: document.name,
    currency: document.currency,
    ...(document.description !== undefined ? { description: document.description } : {}),
    version: document.__v,
    ...(document.settlementStartedAt ? { settlementMode: true } : {}),
    ...(document.financialOperation ? { financialBusy: true } : {}),
    ...(document.financialHistoryAt ? { financialHistoryLocked: true } : {}),
    membership: { role: membership.role, createdAt: membership.createdAt.toISOString() },
    createdAt: document.createdAt.toISOString(),
    updatedAt: document.updatedAt.toISOString(),
  };
}
export function createGroupService({ repository = groupRepository } = {}) {
  return {
    async create(user, input) {
      return toPublicGroup(
        await repository.createForOwner(user, parse(groupInputSchema, input)),
        user,
      );
    },
    async list(user, input) {
      const query = parse(groupQuerySchema, input, 'INVALID_QUERY');
      const rows = await repository.findPageForMember(user, query),
        hasMore = rows.length > query.limit;
      const page = rows.slice(0, query.limit);
      return {
        groups: page.map((row) => toPublicGroup(row, user)),
        pagination: {
          limit: query.limit,
          hasMore,
          nextAfter: hasMore ? String(page.at(-1)._id) : null,
        },
      };
    },
    async get(user, id) {
      return toPublicGroup(await requireGroupMember(repository, user, groupId(id)), user);
    },
    async update(user, id, input, ifMatch) {
      groupId(id);
      const patch = parse(groupPatchSchema, input);
      const existing = requireGroupOwner(await requireGroupMember(repository, user, id), user);
      requireGroupVersion(existing, id, ifMatch);
      const merged = {
        name: existing.name,
        currency: existing.currency,
        ...(existing.description !== undefined ? { description: existing.description } : {}),
        ...patch,
      };
      if (merged.description === null) delete merged.description;
      const updated = await repository.replaceForOwner(
        user,
        id,
        existing.__v,
        parse(groupInputSchema, merged),
      );
      if (!updated) {
        requireGroupOwner(await requireGroupMember(repository, user, id), user);
        throw new HttpError(409, 'Group changed; reload and retry', 'GROUP_CONFLICT');
      }
      return toPublicGroup(updated, user);
    },
    async remove(user, id) {
      groupId(id);
      requireNoFinancialHistory(
        requireGroupOwner(await requireGroupMember(repository, user, id), user),
      );
      if (!(await repository.deleteForOwner(user, id))) {
        requireNoFinancialHistory(
          requireGroupOwner(await requireGroupMember(repository, user, id), user),
        );
        throw new HttpError(409, 'Group changed; reload and retry', 'GROUP_CONFLICT');
      }
    },
  };
}
