import mongoose from 'mongoose';
import { groupRepository } from '../repositories/group.repository.js';
import { groupExpenseRepository } from '../repositories/group-expense.repository.js';
import { settlementRepository } from '../repositories/settlement.repository.js';
import { groupBalanceRepository } from '../repositories/group-balance.repository.js';
import { calculateBalances, assertSettlementCapacity } from '../utils/group-balances.js';
import { requireGroupMember } from './group-authorization.js';
import { HttpError } from '../utils/httpError.js';
const busy = () =>
  new HttpError(
    409,
    'Group financial operation is pending; recover it before continuing',
    'FINANCIAL_BUSY',
  );
export function createGroupFinancialService({
  groups = groupRepository,
  expenses = groupExpenseRepository,
  settlements = settlementRepository,
  balances = groupBalanceRepository,
} = {}) {
  async function execute(group, operation) {
    const op = operation.toObject ? operation.toObject() : operation,
      groupId = String(group._id),
      actor = String(op.actor),
      p = op.payload;
    if (op.kind.startsWith('expense_')) {
      const previous = await expenses.findAny(groupId, p.targetId);
      if (previous && String(previous.lastFinancialOperation) === String(op._id)) return previous;
      if (op.kind === 'expense_create') {
        const receipt = await expenses.findReceipt(groupId, actor, p.key);
        if (receipt) {
          if (receipt.deletedAt)
            throw new HttpError(
              409,
              'The expense was deleted and cannot be recreated',
              'EXPENSE_DELETED',
            );
          if (receipt.creationHash !== p.hash)
            throw new HttpError(409, 'Creation key conflict', 'IDEMPOTENCY_CONFLICT');
          return receipt;
        }
        try {
          return await expenses.create(
            groupId,
            actor,
            p.data,
            p.key,
            p.hash,
            String(op._id),
            p.targetId,
          );
        } catch (error) {
          if (error.code !== 11000) throw error;
          const receipt = await expenses.findReceipt(groupId, actor, p.key);
          if (!receipt || receipt.creationHash !== p.hash) throw error;
          if (receipt.deletedAt)
            throw new HttpError(
              409,
              'The expense was deleted and cannot be recreated',
              'EXPENSE_DELETED',
            );
          return receipt;
        }
      }
      const written =
        op.kind === 'expense_update'
          ? await expenses.replace(
              groupId,
              p.targetId,
              actor,
              p.owner,
              p.version,
              p.data,
              p.creator,
              String(op._id),
            )
          : await expenses.remove(groupId, p.targetId, actor, p.owner, p.version, String(op._id));
      if (written) return written;
      const current = await expenses.findAny(groupId, p.targetId);
      if (current && String(current.lastFinancialOperation) === String(op._id)) return current;
      throw new HttpError(
        409,
        'Expense changed before the reserved write',
        'GROUP_EXPENSE_CONFLICT',
      );
    }
    const existing = await settlements.find(groupId, p.targetId);
    if (existing && String(existing.lastFinancialOperation) === String(op._id)) return existing;
    if (op.kind === 'settlement_create') {
      const receipt = await settlements.receipt(groupId, actor, p.key);
      if (receipt) {
        if (receipt.creationHash !== p.hash)
          throw new HttpError(409, 'Creation key conflict', 'IDEMPOTENCY_CONFLICT');
        return receipt;
      }
      const rows = calculateBalances(
        group.members.map((row) => String(row.user)),
        await balances.aggregate(
          groupId,
          group.members.map((row) => String(row.user)),
        ),
      );
      assertSettlementCapacity(rows, actor, p.recipient, p.amountMinor, true);
      // Reservation prevents expense workers from racing this irreversible transition.
      if (!group.settlementStartedAt) await groups.beginSettlementMode(groupId, String(op._id));
      try {
        return await settlements.create(groupId, op);
      } catch (error) {
        if (error.code !== 11000) throw error;
        const receipt = await settlements.receipt(groupId, actor, p.key);
        if (!receipt) throw error;
        if (receipt.creationHash !== p.hash)
          throw new HttpError(409, 'Creation key conflict', 'IDEMPOTENCY_CONFLICT');
        return receipt;
      }
    }
    if (
      !existing ||
      String(existing.recipient) !== actor ||
      existing.__v !== p.version ||
      existing.status !== 'pending'
    )
      throw new HttpError(409, 'Settlement was already decided or changed', 'SETTLEMENT_DECIDED');
    if (op.kind === 'settlement_confirm') {
      const rows = calculateBalances(
        group.members.map((row) => String(row.user)),
        await balances.aggregate(
          groupId,
          group.members.map((row) => String(row.user)),
        ),
      );
      assertSettlementCapacity(
        rows,
        String(existing.sender),
        String(existing.recipient),
        existing.amountMinor,
        false,
      );
    }
    const written = await settlements.decide(groupId, op);
    if (written) return written;
    const current = await settlements.find(groupId, p.targetId);
    if (current && String(current.lastFinancialOperation) === String(op._id)) return current;
    throw new HttpError(409, 'Settlement was already decided', 'SETTLEMENT_DECIDED');
  }
  async function finish(group) {
    const operation = group.financialOperation;
    try {
      const result = await execute(group, operation);
      await groups.finishFinancial(String(group._id), String(operation._id));
      return result;
    } catch (error) {
      // Deterministic domain failures happen before an effect; unknown driver outcomes
      // retain the reservation and frozen payload for explicit recovery.
      if (error instanceof HttpError) {
        // Another recovery worker may have committed this exact operation while
        // our preflight aggregation was running. Recognize its durable receipt.
        const current = operation.kind.startsWith('expense_')
          ? await expenses.findAny(String(group._id), operation.payload.targetId)
          : await settlements.find(String(group._id), operation.payload.targetId);
        await groups.finishFinancial(String(group._id), String(operation._id));
        if (current && String(current.lastFinancialOperation) === String(operation._id))
          return current;
      }
      throw error;
    }
  }
  return {
    async run(user, groupId, kind, payload) {
      const group = await requireGroupMember(groups, user, groupId);
      if (group.financialProtocolVersion !== undefined)
        throw new HttpError(
          409,
          'Cycle protocol is not active on this API',
          'CYCLE_PROTOCOL_INACTIVE',
        );
      if (group.financialOperation) throw busy();
      if (group.__v >= Number.MAX_SAFE_INTEGER - 4)
        throw new HttpError(409, 'Group financial version exhausted', 'GROUP_CONFLICT');
      if (kind.startsWith('expense_') && group.settlementStartedAt)
        throw new HttpError(
          409,
          'Shared expenses are permanently frozen in settlement mode',
          'EXPENSES_FROZEN',
        );
      const op = {
        _id: new mongoose.Types.ObjectId(),
        actor: user,
        kind,
        payload,
        createdAt: new Date(),
      };
      const reserved = await groups.reserveFinancial(user, groupId, group.__v, op);
      if (!reserved) throw busy();
      return finish(reserved);
    },
    async recover(user, groupId) {
      const group = await requireGroupMember(groups, user, groupId);
      if (group.financialProtocolVersion !== undefined)
        throw new HttpError(
          409,
          'Cycle protocol is not active on this API',
          'CYCLE_PROTOCOL_INACTIVE',
        );
      if (!group.financialOperation) return { recovered: false };
      if (String(group.financialOperation.actor) !== user && String(group.creator) !== user)
        throw new HttpError(
          403,
          'Only operation actor or group owner can recover work',
          'RECOVERY_FORBIDDEN',
        );
      await finish(group);
      return { recovered: true };
    },
  };
}
