import { createHash } from 'node:crypto';
import mongoose from 'mongoose';
import { groupRepository } from '../repositories/group.repository.js';
import { settlementRepository } from '../repositories/settlement.repository.js';
import { groupBalanceRepository } from '../repositories/group-balance.repository.js';
import { membershipRepository } from '../repositories/membership.repository.js';
import { createGroupFinancialService } from './group-financial.service.js';
import { requireGroupMember } from './group-authorization.js';
import {
  settlementInputSchema,
  settlementQuerySchema,
} from '../validators/settlement.validator.js';
import { ownerIdSchema } from '../validators/transaction.validator.js';
import { idempotencyKeySchema } from '../validators/group-expense.validator.js';
import { ifMatchSchema } from '../validators/transaction-query.validator.js';
import { emptyInputSchema } from '../validators/invitation.validator.js';
import {
  calculateBalances,
  simplifyDebts,
  safeBalanceNumber,
} from '../utils/group-balances.js';
import { HttpError } from '../utils/httpError.js';
const parse = (schema, input, code = 'INVALID_SETTLEMENT') => {
  const result = schema.safeParse(input);
  if (!result.success)
    throw new HttpError(400, 'Invalid settlement request', code);
  return result.data;
};
const hash = (value) => createHash('sha256').update(value).digest('hex');
const missing = () =>
  new HttpError(404, 'Settlement not found', 'SETTLEMENT_NOT_FOUND');
export function publicSettlement(row) {
  return {
    id: String(row._id),
    groupId: String(row.group),
    sender: String(row.sender),
    recipient: String(row.recipient),
    amountMinor: row.amountMinor,
    currency: row.currency,
    status: row.status,
    version: row.__v,
    createdAt: row.createdAt.toISOString(),
    ...(row.confirmedAt ? { confirmedAt: row.confirmedAt.toISOString() } : {}),
    ...(row.rejectedAt ? { rejectedAt: row.rejectedAt.toISOString() } : {}),
    ...(row.decisionBy ? { decisionBy: String(row.decisionBy) } : {}),
  };
}
export function createSettlementService({
  groups = groupRepository,
  repository = settlementRepository,
  balances = groupBalanceRepository,
  profiles = membershipRepository,
  financial,
} = {}) {
  financial ??= createGroupFinancialService({
    groups,
    settlements: repository,
    balances,
  });
  async function groupFor(user, groupId) {
    parse(ownerIdSchema, groupId, 'INVALID_GROUP_ID');
    return requireGroupMember(groups, user, groupId);
  }
  return {
    async balances(user, groupId, query) {
      parse(emptyInputSchema, query, 'INVALID_QUERY');
      const group = await groupFor(user, groupId);
      if (group.financialOperation)
        throw new HttpError(
          409,
          'Financial operation is pending; recover before reading balances',
          'FINANCIAL_BUSY',
        );
      const rows = calculateBalances(
        group.members.map((row) => String(row.user)),
        await balances.aggregate(
          groupId,
          group.members.map((row) => String(row.user)),
        ),
      );
      const current = await groupFor(user, groupId);
      if (current.financialOperation || current.__v !== group.__v)
        throw new HttpError(
          409,
          'Group changed during calculation; reload balances',
          'BALANCE_CHANGED',
        );
      return {
        groupId,
        currency: 'INR',
        settlementMode: !!group.settlementStartedAt,
        members: rows.map((row) => ({
          user: row.user,
          paidMinor: safeBalanceNumber(row.paid),
          assignedMinor: safeBalanceNumber(row.assigned),
          confirmedSentMinor: safeBalanceNumber(row.sent),
          confirmedReceivedMinor: safeBalanceNumber(row.received),
          netMinor: safeBalanceNumber(row.net),
          pendingSentMinor: safeBalanceNumber(row.reservedSent),
          pendingReceivedMinor: safeBalanceNumber(row.reservedReceived),
        })),
        suggestions: simplifyDebts(rows),
        netTotalMinor: 0,
      };
    },
    async list(user, groupId, input) {
      await groupFor(user, groupId);
      const query = parse(settlementQuerySchema, input, 'INVALID_QUERY');
      const rows = await repository.list(groupId, query),
        hasMore = rows.length > query.limit,
        page = rows.slice(0, query.limit);
      return {
        settlements: page.map(publicSettlement),
        pagination: {
          limit: query.limit,
          hasMore,
          nextAfter: hasMore ? String(page.at(-1)._id) : null,
        },
      };
    },
    async get(user, groupId, target) {
      await groupFor(user, groupId);
      parse(ownerIdSchema, target, 'INVALID_SETTLEMENT_ID');
      const row = await repository.find(groupId, target);
      if (!row) throw missing();
      return publicSettlement(row);
    },
    async create(user, groupId, input, keyValue) {
      const group = await groupFor(user, groupId),
        data = parse(settlementInputSchema, input);
      if (
        data.recipient === user ||
        !group.members.some((row) => String(row.user) === data.recipient)
      )
        throw new HttpError(
          400,
          'Recipient must be a different group member',
          'INVALID_RECIPIENT',
        );
      const registered = await profiles.publicProfiles([user, data.recipient]);
      if (registered.length !== 2)
        throw new HttpError(
          400,
          'Both settlement accounts must be registered',
          'INVALID_RECIPIENT',
        );
      const key = hash(
          parse(
            idempotencyKeySchema,
            keyValue,
            'IDEMPOTENCY_KEY_REQUIRED',
          ).toLowerCase(),
        ),
        digest = hash(JSON.stringify(data));
      const previous = await repository.receipt(groupId, user, key);
      if (previous) {
        if (previous.creationHash !== digest)
          throw new HttpError(
            409,
            'Creation key was used for another settlement',
            'IDEMPOTENCY_CONFLICT',
          );
        return { settlement: publicSettlement(previous), replayed: true };
      }
      if (!group.financialHistoryAt)
        throw new HttpError(
          409,
          'No outstanding group financial history',
          'SETTLEMENT_EXCESS',
        );
      const targetId = String(new mongoose.Types.ObjectId());
      const row = await financial.run(user, groupId, 'settlement_create', {
        ...data,
        key,
        hash: digest,
        targetId,
      });
      return {
        settlement: publicSettlement(row),
        replayed: String(row._id) !== targetId,
      };
    },
    async decide(user, groupId, target, action, input, ifMatch) {
      await groupFor(user, groupId);
      parse(ownerIdSchema, target, 'INVALID_SETTLEMENT_ID');
      parse(emptyInputSchema, input);
      const row = await repository.find(groupId, target);
      if (!row) throw missing();
      if (String(row.recipient) !== user)
        throw new HttpError(
          403,
          'Only the intended recipient may decide',
          'SETTLEMENT_RECIPIENT_REQUIRED',
        );
      if (row.status !== 'pending')
        throw new HttpError(
          409,
          'Settlement already has a terminal decision',
          'SETTLEMENT_DECIDED',
        );
      if (ifMatch === undefined)
        throw new HttpError(
          428,
          'If-Match is required',
          'PRECONDITION_REQUIRED',
        );
      const expected = parse(ifMatchSchema, ifMatch, 'INVALID_VERSION');
      if (expected.id !== target.toLowerCase())
        throw new HttpError(
          400,
          'Wrong settlement version resource',
          'INVALID_VERSION',
        );
      if (expected.version !== row.__v)
        throw new HttpError(
          412,
          'Settlement version is stale',
          'VERSION_MISMATCH',
        );
      if (!['confirm', 'reject'].includes(action))
        throw new HttpError(
          400,
          'Invalid settlement decision',
          'INVALID_SETTLEMENT',
        );
      return publicSettlement(
        await financial.run(user, groupId, `settlement_${action}`, {
          targetId: target,
          version: row.__v,
        }),
      );
    },
    recover(user, groupId, input) {
      parse(ownerIdSchema, groupId, 'INVALID_GROUP_ID');
      parse(emptyInputSchema, input);
      return financial.recover(user, groupId);
    },
  };
}
