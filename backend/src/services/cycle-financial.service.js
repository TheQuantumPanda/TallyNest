import { createHash } from 'node:crypto';
import mongoose from 'mongoose';
import { z } from 'zod';
import { groupRepository } from '../repositories/group.repository.js';
import { groupFinancialCycleRepository } from '../repositories/group-financial-cycle.repository.js';
import { groupExpenseRepository } from '../repositories/group-expense.repository.js';
import { settlementRepository } from '../repositories/settlement.repository.js';
import { groupBalanceRepository } from '../repositories/group-balance.repository.js';
import {
  groupExpenseInputSchema,
  idempotencyKeySchema,
} from '../validators/group-expense.validator.js';
import { settlementInputSchema } from '../validators/settlement.validator.js';
import { ownerIdSchema } from '../validators/transaction.validator.js';
import { allocateSplit } from '../utils/split.js';
import {
  calculateBalances,
  assertSettlementCapacity,
  simplifyDebts,
} from '../utils/group-balances.js';
import { requireGroupMember } from './group-authorization.js';
import { HttpError } from '../utils/httpError.js';

const id = ownerIdSchema.transform((value) => value.toLowerCase());
const version = z
  .number()
  .int()
  .min(0)
  .max(Number.MAX_SAFE_INTEGER - 1);
const targetSchema = z.object({ targetId: id, version }).strict();
const hash = (value) => createHash('sha256').update(value).digest('hex');
const same = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();
const conflict = (code = 'CYCLE_FINANCIAL_CONFLICT') =>
  new HttpError(409, 'Cycle financial state changed; recover or reload', code);
const inactive = () =>
  new HttpError(409, 'Cycle write protocol is inactive', 'CYCLE_PROTOCOL_INACTIVE');

function prepare(kind, input, cycleId) {
  if (kind === 'expense_create' || kind === 'expense_update') {
    const parsed = (
      kind === 'expense_create'
        ? z.object({ data: groupExpenseInputSchema, key: idempotencyKeySchema }).strict()
        : z.object({ ...targetSchema.shape, data: groupExpenseInputSchema }).strict()
    ).parse(input);
    const data = {
      ...parsed.data,
      split: allocateSplit(parsed.data.amountMinor, parsed.data.split).split,
    };
    if (kind === 'expense_update')
      return { targetId: parsed.targetId, version: parsed.version, data };
    const key = hash(parsed.key.toLowerCase());
    return { data, key, hash: hash(JSON.stringify({ cycleId, data })) };
  }
  if (kind === 'expense_delete' || kind === 'settlement_confirm' || kind === 'settlement_reject')
    return targetSchema.parse(input);
  if (kind === 'settlement_create') {
    const parsed = z
      .object({ data: settlementInputSchema, key: idempotencyKeySchema })
      .strict()
      .parse(input);
    return {
      ...parsed.data,
      key: hash(parsed.key.toLowerCase()),
      hash: hash(JSON.stringify({ cycleId, data: parsed.data })),
    };
  }
  throw new TypeError('Unknown cycle financial operation');
}

function checkOperation(op, groupId) {
  if (
    op.protocolVersion !== 2 ||
    !same(op.groupId, groupId) ||
    !same(op.cycleId, op.payload.cycleId) ||
    !same(op.targetId, op.payload.targetId) ||
    op.payloadHash !==
      hash(
        JSON.stringify({
          kind: op.kind,
          groupId: String(op.groupId),
          cycleId: String(op.cycleId),
          cycleEpoch: op.cycleEpoch,
          targetId: String(op.targetId),
          expectedGroupVersion: op.expectedGroupVersion,
          expectedCycleVersion: op.expectedCycleVersion,
          startState: op.startState,
          payload: op.payload,
        }),
      )
  )
    throw conflict('CYCLE_OPERATION_INVALID');
}

export function createCycleFinancialService({
  internalEnabled = false,
  groups = groupRepository,
  cycles = groupFinancialCycleRepository,
  expenses = groupExpenseRepository,
  settlements = settlementRepository,
  balances = groupBalanceRepository,
  fault = async () => {},
} = {}) {
  const enabled = () => {
    if (!internalEnabled) throw inactive();
  };
  async function groupFor(user, groupId) {
    const group = await requireGroupMember(groups, user, groupId);
    if (group.financialProtocolVersion !== 2) throw inactive();
    return group;
  }
  async function cycleFor(group, op) {
    if (!same(group.currentCycleId, op.cycleId) || group.cycleEpoch !== op.cycleEpoch)
      throw conflict('CYCLE_EPOCH_STALE');
    const cycle = await cycles.find(String(group._id), String(op.cycleId));
    if (!cycle || !same(cycle.group, group._id) || cycle.currency !== group.currency)
      throw conflict('CYCLE_ASSOCIATION_INVALID');
    const members = cycle.memberIds.map(String);
    if (
      !members.includes(String(op.actor)) ||
      !group.members.some((row) => same(row.user, op.actor))
    )
      throw conflict('CYCLE_MEMBERSHIP_CHANGED');
    return { cycle, members };
  }
  async function sourceFor(group, op, members, cycle) {
    const groupId = String(group._id),
      cycleId = String(cycle._id),
      p = op.payload;
    if (op.kind.startsWith('expense_')) {
      if (group.currentCycleState !== 'open' || cycle.status !== 'open')
        throw conflict('EXPENSES_FROZEN');
      if (op.kind === 'expense_create' || op.kind === 'expense_update') {
        const ids = [
          p.data.payer,
          ...p.data.split.participants.map((row) => (typeof row === 'string' ? row : row.user)),
        ];
        if (
          p.data.currency !== cycle.currency ||
          ids.some(
            (value) =>
              !members.includes(value) || !group.members.some((row) => same(row.user, value)),
          )
        )
          throw conflict('CYCLE_MEMBERSHIP_CHANGED');
      }
      if (op.kind !== 'expense_create') {
        const row = await expenses.findAny(groupId, p.targetId);
        const owner =
          same(group.creator, op.actor) &&
          group.members.some((m) => same(m.user, op.actor) && m.role === 'owner');
        if (
          !row ||
          !same(row.cycleId, cycleId) ||
          row.deletedAt ||
          row.__v !== p.version ||
          (!owner && !same(row.creator, op.actor))
        )
          throw conflict('GROUP_EXPENSE_CONFLICT');
        if (op.kind === 'expense_update' && !members.includes(String(row.creator)))
          throw conflict('CYCLE_MEMBERSHIP_CHANGED');
        return { row, owner };
      }
      return {};
    }
    if (
      group.currentCycleState !== 'frozen' &&
      !(op.kind === 'settlement_create' && group.currentCycleState === 'open')
    )
      throw conflict('CYCLE_STATE_INVALID');
    if (op.kind === 'settlement_create') {
      if (
        cycle.status !== group.currentCycleState ||
        p.recipient === String(op.actor) ||
        !members.includes(p.recipient) ||
        !group.members.some((row) => same(row.user, p.recipient)) ||
        p.currency !== cycle.currency
      )
        throw conflict('INVALID_RECIPIENT');
      const rows = calculateBalances(members, await balances.aggregate(groupId, members, cycleId));
      assertSettlementCapacity(rows, String(op.actor), p.recipient, p.amountMinor, true);
      return { rows };
    }
    if (cycle.status !== 'frozen') throw conflict('CYCLE_STATE_INVALID');
    const row = await settlements.find(groupId, p.targetId);
    if (
      !row ||
      !same(row.cycleId, cycleId) ||
      !same(row.recipient, op.actor) ||
      row.status !== 'pending' ||
      row.__v !== p.version
    )
      throw conflict('SETTLEMENT_DECIDED');
    if (op.kind === 'settlement_confirm') {
      const rows = calculateBalances(members, await balances.aggregate(groupId, members, cycleId));
      assertSettlementCapacity(
        rows,
        String(row.sender),
        String(row.recipient),
        row.amountMinor,
        false,
      );
    }
    return { row };
  }
  async function check(group, op) {
    checkOperation(op, String(group._id));
    if (
      !same(group.financialOperation?._id, op._id) ||
      group.financialOperation.phase !== 'checking' ||
      group.__v !== op.expectedGroupVersion + 1
    )
      throw conflict();
    const { cycle, members } = await cycleFor(group, op);
    if (
      cycle.__v !== op.expectedCycleVersion ||
      cycle.status !== group.currentCycleState ||
      cycle.status === 'closed'
    )
      throw conflict('CYCLE_VERSION_STALE');
    await sourceFor(group, op, members, cycle);
  }
  async function effectReceipt(groupId, op) {
    const p = op.payload;
    const row = op.kind.startsWith('expense_')
      ? await expenses.findAny(groupId, p.targetId)
      : await settlements.find(groupId, p.targetId);
    return row && same(row.cycleId, op.cycleId) && same(row.lastFinancialOperation, op._id)
      ? row
      : null;
  }
  async function freeze(group, op) {
    const groupId = String(group._id),
      cycleId = String(op.cycleId);
    let cycle = await cycles.freezeForProposal(
      groupId,
      cycleId,
      op.expectedCycleVersion,
      String(op._id),
    );
    if (!cycle) {
      cycle = await cycles.find(groupId, cycleId);
      if (!cycle || cycle.status !== 'frozen' || !same(cycle.freezeOperationId, op._id))
        throw conflict('CYCLE_FREEZE_CONFLICT');
    } else await fault('after_cycle_freeze', op);
    let current = await groups.findByIdForMember(String(op.actor), groupId);
    if (current.currentCycleState === 'open') {
      const mirrored = await groups.markCycleFrozen(
        groupId,
        String(op._id),
        cycleId,
        op.cycleEpoch,
        !!current.settlementStartedAt,
      );
      if (!mirrored) throw conflict('CYCLE_MIRROR_CONFLICT');
      current = mirrored;
      await fault('after_group_mirror', op);
    }
    if (current.currentCycleState !== 'frozen' || !same(current.financialOperation?._id, op._id))
      throw conflict('CYCLE_MIRROR_CONFLICT');
  }
  async function apply(group, op) {
    const groupId = String(group._id),
      cycleId = String(op.cycleId),
      p = op.payload;
    checkOperation(op, groupId);
    const current = await groupFor(String(op.actor), groupId);
    if (
      !same(current.financialOperation?._id, op._id) ||
      current.financialOperation.phase !== 'applying' ||
      !same(current.currentCycleId, cycleId) ||
      current.cycleEpoch !== op.cycleEpoch
    )
      throw conflict('CYCLE_OPERATION_STALE');
    const receipt = await effectReceipt(groupId, op);
    if (receipt) return receipt;
    let cycle = await cycles.find(groupId, cycleId);
    if (!cycle || cycle.status === 'closed') throw conflict('CYCLE_STATE_INVALID');
    if (op.kind.startsWith('expense_')) {
      if (
        current.currentCycleState !== 'open' ||
        cycle.status !== 'open' ||
        cycle.__v !== op.expectedCycleVersion
      )
        throw conflict('EXPENSES_FROZEN');
      if (op.kind === 'expense_create') {
        const previous = await expenses.findReceipt(groupId, String(op.actor), p.key);
        if (previous) {
          if (previous.creationHash !== p.hash || !same(previous.cycleId, cycleId))
            throw conflict('IDEMPOTENCY_CONFLICT');
          if (previous.deletedAt) throw conflict('EXPENSE_DELETED');
          return previous;
        }
        await fault('before_target_write', op);
        try {
          const written = await expenses.create(
            groupId,
            String(op.actor),
            p.data,
            p.key,
            p.hash,
            String(op._id),
            p.targetId,
            cycleId,
          );
          await fault('after_target_write', op);
          return written;
        } catch (error) {
          if (error.code !== 11000) throw error;
          const prior = await expenses.findReceipt(groupId, String(op.actor), p.key);
          if (!prior || prior.creationHash !== p.hash || !same(prior.cycleId, cycleId)) throw error;
          return prior;
        }
      }
      const row = await expenses.findAny(groupId, p.targetId);
      if (!row || !same(row.cycleId, cycleId)) throw conflict('GROUP_EXPENSE_CONFLICT');
      const owner =
        same(current.creator, op.actor) &&
        current.members.some((m) => same(m.user, op.actor) && m.role === 'owner');
      if (!owner && !same(row.creator, op.actor)) throw conflict('GROUP_EXPENSE_CONFLICT');
      await fault('before_target_write', op);
      const written =
        op.kind === 'expense_update'
          ? await expenses.replace(
              groupId,
              p.targetId,
              String(op.actor),
              owner,
              p.version,
              p.data,
              String(row.creator),
              String(op._id),
              cycleId,
            )
          : await expenses.remove(
              groupId,
              p.targetId,
              String(op.actor),
              owner,
              p.version,
              String(op._id),
              cycleId,
            );
      if (!written)
        return (
          (await effectReceipt(groupId, op)) ?? Promise.reject(conflict('GROUP_EXPENSE_CONFLICT'))
        );
      await fault('after_target_write', op);
      return written;
    }
    if (op.kind === 'settlement_create') {
      if (op.startState === 'open') await freeze(current, op);
      cycle = await cycles.find(groupId, cycleId);
      if (cycle.status !== 'frozen') throw conflict('CYCLE_STATE_INVALID');
      const prior = await settlements.receipt(groupId, String(op.actor), p.key);
      if (prior) {
        if (prior.creationHash !== p.hash || !same(prior.cycleId, cycleId))
          throw conflict('IDEMPOTENCY_CONFLICT');
        return prior;
      }
      await fault('before_target_write', op);
      try {
        const written = await settlements.create(groupId, op, cycleId);
        await fault('after_target_write', op);
        return written;
      } catch (error) {
        if (error.code !== 11000) throw error;
        const prior = await settlements.receipt(groupId, String(op.actor), p.key);
        if (!prior || prior.creationHash !== p.hash || !same(prior.cycleId, cycleId)) throw error;
        return prior;
      }
    }
    if (current.currentCycleState !== 'frozen' || cycle.status !== 'frozen')
      throw conflict('CYCLE_STATE_INVALID');
    const row = await settlements.find(groupId, p.targetId);
    if (!row || !same(row.cycleId, cycleId) || !same(row.recipient, op.actor))
      throw conflict('SETTLEMENT_DECIDED');
    await fault('before_target_write', op);
    const written = await settlements.decide(groupId, op, cycleId);
    if (!written)
      return (await effectReceipt(groupId, op)) ?? Promise.reject(conflict('SETTLEMENT_DECIDED'));
    await fault('after_target_write', op);
    return written;
  }
  async function finish(group) {
    const op = group.financialOperation;
    if (!op || op.protocolVersion !== 2) throw inactive();
    if (op.phase === 'checking') {
      try {
        await check(group, op);
        await fault('after_check', op);
      } catch (error) {
        if (error instanceof HttpError) {
          const cancelled = await groups.cancelCycleChecking(
            String(group._id),
            String(op._id),
            String(op.cycleId),
            op.cycleEpoch,
          );
          if (!cancelled) throw conflict('CYCLE_OPERATION_STALE');
        }
        throw error;
      }
      const promoted = await groups.promoteCycleFinancial(
        String(group._id),
        String(op._id),
        String(op.cycleId),
        op.cycleEpoch,
      );
      if (!promoted) {
        const latest = await groups.findByIdForMember(String(op.actor), String(group._id));
        if (
          !latest ||
          !same(latest.financialOperation?._id, op._id) ||
          latest.financialOperation.phase !== 'applying'
        )
          throw conflict('CYCLE_OPERATION_STALE');
      }
      await fault('after_promote', op);
    }
    const row = await apply(group, op);
    const proof = await effectReceipt(String(group._id), op);
    if (!proof || !same(proof._id, row._id)) throw conflict('CYCLE_RECEIPT_MISSING');
    await fault('before_release', op);
    await groups.finishCycleFinancial(
      String(group._id),
      String(op._id),
      String(op.cycleId),
      op.cycleEpoch,
    );
    return row;
  }
  return {
    async run(user, groupId, cycleIdValue, epoch, kind, input) {
      enabled();
      const cycleId = id.parse(cycleIdValue),
        group = await groupFor(user, groupId);
      const p = prepare(kind, input, cycleId);
      if (kind.endsWith('_create')) {
        const previous =
          kind === 'expense_create'
            ? await expenses.findReceipt(groupId, user, p.key)
            : await settlements.receipt(groupId, user, p.key);
        if (previous) {
          if (previous.creationHash !== p.hash || !same(previous.cycleId, cycleId))
            throw conflict('IDEMPOTENCY_CONFLICT');
          if (previous.deletedAt) throw conflict('EXPENSE_DELETED');
          return { row: previous, replayed: true };
        }
      }
      if (
        !Number.isSafeInteger(epoch) ||
        epoch < 0 ||
        group.cycleEpoch !== epoch ||
        !same(group.currentCycleId, cycleId)
      )
        throw conflict('CYCLE_EPOCH_STALE');
      if (group.financialOperation) throw conflict('FINANCIAL_BUSY');
      const cycle = await cycles.find(groupId, cycleId);
      if (!cycle || cycle.status !== group.currentCycleState || cycle.status === 'closed')
        throw conflict('CYCLE_STATE_INVALID');
      const targetId = p.targetId ?? String(new mongoose.Types.ObjectId());
      const payload = { ...p, targetId, cycleId };
      const op = {
        _id: new mongoose.Types.ObjectId(),
        actor: user,
        kind,
        protocolVersion: 2,
        groupId,
        cycleId,
        cycleEpoch: epoch,
        expectedGroupVersion: group.__v,
        expectedCycleVersion: cycle.__v,
        targetId,
        payload,
        phase: 'checking',
        startState: group.currentCycleState,
        createdAt: new Date(),
      };
      op.payloadHash = hash(
        JSON.stringify({
          kind,
          groupId,
          cycleId,
          cycleEpoch: epoch,
          targetId,
          expectedGroupVersion: op.expectedGroupVersion,
          expectedCycleVersion: op.expectedCycleVersion,
          startState: op.startState,
          payload,
        }),
      );
      const reserved = await groups.reserveCycleFinancial(
        user,
        groupId,
        group.__v,
        cycleId,
        epoch,
        group.currentCycleState,
        op,
      );
      if (!reserved) throw conflict('FINANCIAL_BUSY');
      await fault('after_reserve', op);
      return { row: await finish(reserved), replayed: false };
    },
    async recover(user, groupId) {
      enabled();
      const group = await groupFor(user, groupId);
      if (!group.financialOperation) return { recovered: false };
      const op = group.financialOperation;
      if (op.protocolVersion !== 2) throw inactive();
      if (!same(op.actor, user) && !same(group.creator, user))
        throw new HttpError(403, 'Recovery requires the actor or owner', 'RECOVERY_FORBIDDEN');
      const row = await finish(group);
      return { recovered: true, row };
    },
    async balances(user, groupId, cycleIdValue) {
      enabled();
      const group = await groupFor(user, groupId),
        cycleId = id.parse(cycleIdValue);
      if (group.financialOperation) throw conflict('FINANCIAL_BUSY');
      const cycle = await cycles.find(groupId, cycleId);
      if (!cycle || !same(cycle.group, groupId)) throw conflict('CYCLE_ASSOCIATION_INVALID');
      const members = cycle.memberIds.map(String);
      if (!members.includes(user)) throw conflict('CYCLE_MEMBERSHIP_CHANGED');
      const rows = calculateBalances(members, await balances.aggregate(groupId, members, cycleId));
      const current = await groupFor(user, groupId);
      const again = await cycles.find(groupId, cycleId);
      if (current.financialOperation || current.__v !== group.__v || again.__v !== cycle.__v)
        throw conflict('BALANCE_CHANGED');
      return { rows, suggestions: simplifyDebts(rows) };
    },
  };
}
