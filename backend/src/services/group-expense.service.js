import { createHash } from 'node:crypto';
import { groupExpenseRepository } from '../repositories/group-expense.repository.js';
import { groupRepository } from '../repositories/group.repository.js';
import { membershipRepository } from '../repositories/membership.repository.js';
import { groupExpenseInputSchema, groupExpensePatchSchema, groupExpenseQuerySchema, expenseCursorSchema, idempotencyKeySchema } from '../validators/group-expense.validator.js';
import { ownerIdSchema } from '../validators/transaction.validator.js';
import { ifMatchSchema } from '../validators/transaction-query.validator.js';
import { requireGroupMember, membershipFor } from './group-authorization.js';
import { expenseInput } from '../models/group-expense.model.js';
import { allocateSplit } from '../utils/split.js';
import { HttpError } from '../utils/httpError.js';
const missing = () => new HttpError(404, 'Group expense not found', 'GROUP_EXPENSE_NOT_FOUND');
function parse(schema, input, code = 'INVALID_GROUP_EXPENSE') {
  const result = schema.safeParse(input); if (!result.success) throw new HttpError(400, 'Invalid group expense request', code); return result.data;
}
function complete(input) {
  const data = parse(groupExpenseInputSchema, input);
  try { data.split = allocateSplit(data.amountMinor, data.split).split; } catch { throw new HttpError(400, 'Split must allocate positive exact shares totaling the expense', 'INVALID_SPLIT'); }
  return data;
}
function digest(value) { return createHash('sha256').update(value).digest('hex'); }
export function publicExpense(row) {
  return { id: String(row._id), groupId: String(row.group), creatorId: String(row.creator), ...expenseInput(row),
    shares: row.shares.map(share => ({ user: String(share.user), amountMinor: share.amountMinor })),
    version: row.__v, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() };
}
function editable(group, row, user) {
  const owner = membershipFor(group, user)?.role === 'owner' && String(group.creator) === user;
  if (!owner && String(row.creator) !== user) throw new HttpError(403, 'Expense creator or group owner permission required', 'EXPENSE_EDIT_FORBIDDEN');
  return owner;
}
function precondition(row, expenseId, value) {
  if (value === undefined) throw new HttpError(428, 'If-Match is required', 'PRECONDITION_REQUIRED');
  const expected = parse(ifMatchSchema, value, 'INVALID_VERSION');
  if (expected.id !== expenseId.toLowerCase()) throw new HttpError(400, 'Wrong expense version resource', 'INVALID_VERSION');
  if (expected.version !== row.__v) throw new HttpError(412, 'Expense version is stale; reload before updating', 'VERSION_MISMATCH');
  if (row.__v >= Number.MAX_SAFE_INTEGER) throw new HttpError(409, 'Expense version exhausted', 'GROUP_EXPENSE_CONFLICT');
}
export function createGroupExpenseService({ repository = groupExpenseRepository, groups = groupRepository, profiles = membershipRepository } = {}) {
  async function groupFor(user, groupId) { parse(ownerIdSchema, groupId, 'INVALID_GROUP_ID'); return requireGroupMember(groups, user, groupId); }
  async function identities(group, user, data) {
    const ids = [...new Set([user, data.payer, ...data.split.participants.map(row => typeof row === 'string' ? row : row.user)])];
    if (group.currency !== data.currency || ids.some(id => !membershipFor(group, id))) throw new HttpError(400, 'Payer and participants must be group members in the group currency', 'INVALID_MEMBERSHIP');
    const registered = await profiles.publicProfiles(ids);
    if (ids.some(id => !registered.some(row => String(row._id) === id))) throw new HttpError(400, 'Financial identities must be registered group members', 'INVALID_MEMBERSHIP');
    return ids;
  }
  async function receipt(user, groupId, key, hash) {
    const row = await repository.findReceipt(groupId, user, key);
    if (!row) return null;
    if (row.creationHash !== hash) throw new HttpError(409, 'Idempotency key was used for a different expense', 'IDEMPOTENCY_CONFLICT');
    if (row.deletedAt) throw new HttpError(409, 'The expense created with this key was deleted; it cannot be recreated', 'EXPENSE_DELETED');
    return row;
  }
  return {
    async create(user, groupId, input, keyValue) {
      const group = await groupFor(user, groupId), data = complete(input);
      const key = digest(parse(idempotencyKeySchema, keyValue, 'IDEMPOTENCY_KEY_REQUIRED').toLowerCase()), hash = digest(JSON.stringify(data));
      const previous = await receipt(user, groupId, key, hash); if (previous) return { expense: publicExpense(previous), replayed: true };
      const required = await identities(group, user, data);
      if (!group.financialHistoryAt) {
        const locked = await groups.lockHistoryForMember(user, groupId, group.__v, required);
        if (!locked) { await groupFor(user, groupId); throw new HttpError(409, 'Group changed before history protection; reload and retry explicitly', 'GROUP_CONFLICT'); }
        if (!locked.financialHistoryAt) throw new Error('Financial history lock failed');
      }
      try { return { expense: publicExpense(await repository.create(groupId, user, data, key, hash)), replayed: false }; }
      catch (error) {
        if (error.code !== 11000) throw error;
        const previous = await receipt(user, groupId, key, hash); if (!previous) throw error;
        return { expense: publicExpense(previous), replayed: true };
      }
    },
    async list(user, groupId, input) {
      await groupFor(user, groupId); const query = parse(groupExpenseQuerySchema, input, 'INVALID_QUERY');
      let after;
      if (query.after) {
        try {
          if (Buffer.from(query.after, 'base64url').toString('base64url') !== query.after) throw new Error();
          after = expenseCursorSchema.parse(JSON.parse(Buffer.from(query.after, 'base64url').toString('utf8')));
          if (after.group !== groupId.toLowerCase()) throw new Error();
        } catch { throw new HttpError(400, 'Invalid expense cursor', 'INVALID_CURSOR'); }
      }
      const rows = await repository.page(groupId, { limit: query.limit, ...(after ? { after } : {}) }), hasMore = rows.length > query.limit, page = rows.slice(0, query.limit), last = page.at(-1);
      return { expenses: page.map(publicExpense), pagination: { limit: query.limit, hasMore,
        nextAfter: hasMore ? Buffer.from(JSON.stringify({ v: 1, group: groupId.toLowerCase(), expenseDate: last.expenseDate.toISOString(), id: String(last._id) })).toString('base64url') : null } };
    },
    async get(user, groupId, expenseId) {
      await groupFor(user, groupId); parse(ownerIdSchema, expenseId, 'INVALID_EXPENSE_ID');
      const row = await repository.find(groupId, expenseId); if (!row) throw missing(); return publicExpense(row);
    },
    async update(user, groupId, expenseId, input, ifMatch) {
      const group = await groupFor(user, groupId); parse(ownerIdSchema, expenseId, 'INVALID_EXPENSE_ID');
      const patch = parse(groupExpensePatchSchema, input);
      const row = await repository.find(groupId, expenseId); if (!row) throw missing();
      const owner = editable(group, row, user); precondition(row, expenseId, ifMatch);
      const merged = { ...expenseInput(row), ...patch }; if (merged.notes === null) delete merged.notes;
      const data = complete(merged); await identities(group, user, data);
      if (!group.financialHistoryAt) throw new Error('Financial history is not protected');
      const updated = await repository.replace(groupId, expenseId, user, owner, row.__v, data, String(row.creator));
      if (!updated) { if (!await repository.find(groupId, expenseId)) throw missing(); throw new HttpError(409, 'Expense changed; reload and review', 'GROUP_EXPENSE_CONFLICT'); }
      return publicExpense(updated);
    },
    async remove(user, groupId, expenseId, ifMatch) {
      const group = await groupFor(user, groupId); parse(ownerIdSchema, expenseId, 'INVALID_EXPENSE_ID');
      const row = await repository.find(groupId, expenseId); if (!row) throw missing();
      const owner = editable(group, row, user); precondition(row, expenseId, ifMatch);
      if (!group.financialHistoryAt) throw new Error('Financial history is not protected');
      if (!await repository.remove(groupId, expenseId, user, owner, row.__v)) { if (!await repository.find(groupId, expenseId)) throw missing(); throw new HttpError(409, 'Expense changed; reload and review', 'GROUP_EXPENSE_CONFLICT'); }
    },
  };
}
