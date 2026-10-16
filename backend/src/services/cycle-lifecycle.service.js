import mongoose from 'mongoose';
import { groupRepository } from '../repositories/group.repository.js';
import { groupFinancialCycleRepository } from '../repositories/group-financial-cycle.repository.js';
import { cycleTransitionRepository } from '../repositories/group-cycle-transition.repository.js';
import { groupExpenseRepository } from '../repositories/group-expense.repository.js';
import { settlementRepository } from '../repositories/settlement.repository.js';
import { groupBalanceRepository } from '../repositories/group-balance.repository.js';
import { requireGroupMember, requireGroupOwner } from './group-authorization.js';
import { createCycleFinancialService } from './cycle-financial.service.js';
import { sortedCycleMembers, nextCycleSequence } from '../utils/group-financial-cycle.js';
import { calculateBalances } from '../utils/group-balances.js';
import { ownerIdSchema } from '../validators/transaction.validator.js';
import {
  LIFECYCLE_KINDS,
  firstCycleInput,
  cycleTransitionInput,
  fingerprint,
  lifecycleHash,
  sameId,
  lifecycleConflict as conflict,
  assertClosable,
  assertLifecycleReceipt,
} from '../utils/cycle-lifecycle.js';
import { HttpError } from '../utils/httpError.js';

const opens = (op) => op.kind === 'cycle_open_first' || op.kind === 'cycle_open_next';
const outcomeId = (op) => String(op.targetId);
async function validateCycle(cycle) {
  try {
    await cycle.validate();
  } catch {
    throw conflict('CYCLE_DATA_INVALID');
  }
}
function sequenceAfter(cycle) {
  try {
    return nextCycleSequence(cycle.sequence);
  } catch {
    throw conflict('CYCLE_SEQUENCE_EXHAUSTED');
  }
}
function validateOperation(op) {
  if (
    !LIFECYCLE_KINDS.includes(op.kind) ||
    op.protocolVersion !== 2 ||
    lifecycleHash(op) !== op.payloadHash ||
    !sameId(op.payload.targetId, op.targetId)
  )
    throw conflict('CYCLE_OPERATION_INVALID');
}
export function createCycleLifecycleService({
  internalEnabled = false,
  groups = groupRepository,
  cycles = groupFinancialCycleRepository,
  receipts = cycleTransitionRepository,
  balances = groupBalanceRepository,
  expenses = groupExpenseRepository,
  settlements = settlementRepository,
  financial,
  fault = async () => {},
} = {}) {
  const enabled = () => {
    if (!internalEnabled)
      throw new HttpError(409, 'Cycle lifecycle is inactive', 'CYCLE_PROTOCOL_INACTIVE');
  };
  async function groupFor(user, groupId, owner = true) {
    ownerIdSchema.parse(user);
    ownerIdSchema.parse(groupId);
    const group = await requireGroupMember(groups, user, groupId);
    if (group.financialProtocolVersion !== 2)
      throw new HttpError(409, 'Cycle lifecycle is inactive', 'CYCLE_PROTOCOL_INACTIVE');
    if (owner) requireGroupOwner(group, user);
    return group;
  }
  function sourceMatches(group, op) {
    return op.kind === 'cycle_open_first'
      ? !group.currentCycleId && !group.currentCycleState && group.cycleEpoch === 0
      : sameId(group.currentCycleId, op.cycleId) &&
          group.cycleEpoch === op.cycleEpoch &&
          group.currentCycleState === op.startState;
  }
  function targetMatches(group, op) {
    return (
      sameId(group.currentCycleId, op.targetId) &&
      group.currentCycleState === op.payload.outcome &&
      group.cycleEpoch === op.cycleEpoch + (opens(op) ? 1 : 0)
    );
  }
  async function closeCheck(group, cycle) {
    await validateCycle(cycle);
    const members = cycle.memberIds.map(String);
    assertClosable(
      calculateBalances(
        members,
        await balances.aggregate(String(group._id), members, String(cycle._id)),
      ),
    );
  }
  async function check(group, op) {
    validateOperation(op);
    if (
      !sameId(group.financialOperation?._id, op._id) ||
      group.financialOperation.phase !== 'checking' ||
      group.__v !== op.expectedGroupVersion + 1 ||
      !sourceMatches(group, op)
    )
      throw conflict('CYCLE_OPERATION_STALE');
    if (op.kind === 'cycle_open_first') {
      if (
        (await cycles.existsForGroup(String(group._id))) ||
        (await balances.hasHistory(String(group._id)))
      )
        throw conflict('CYCLE_BOOTSTRAP_NOT_EMPTY');
      return;
    }
    const cycle = await cycles.find(String(group._id), String(op.cycleId));
    if (
      !cycle ||
      cycle.__v !== op.expectedCycleVersion ||
      cycle.status !== op.startState ||
      cycle.currency !== group.currency ||
      !cycle.memberIds.map(String).includes(String(op.actor))
    )
      throw conflict('CYCLE_VERSION_STALE');
    await validateCycle(cycle);
    if (op.kind === 'cycle_close' || op.kind === 'cycle_open_next') await closeCheck(group, cycle);
    if (op.kind === 'cycle_open_next' && (await cycles.active(String(group._id))))
      throw conflict('CYCLE_ACTIVE_EXISTS');
  }
  async function journal(op) {
    let row = await receipts.find(String(op.groupId), op.payload.intentKey);
    if (!row) {
      try {
        row = await receipts.create(op);
        await fault('after_receipt_insert', op);
      } catch (error) {
        if (error.code !== 11000) throw error;
        row = await receipts.find(String(op.groupId), op.payload.intentKey);
      }
    }
    if (
      !row ||
      !sameId(row._id, op._id) ||
      row.operationHash !== op.payloadHash ||
      row.requestHash !== op.payload.requestHash ||
      lifecycleHash(row.operation) !== op.payloadHash
    )
      throw conflict('CYCLE_RECEIPT_INVALID');
    return assertLifecycleReceipt(row);
  }
  async function cycleProof(op) {
    const cycle = await cycles.find(String(op.groupId), outcomeId(op));
    if (!cycle) return null;
    const field = opens(op)
      ? 'openOperationId'
      : op.kind === 'cycle_freeze'
        ? 'freezeOperationId'
        : 'closeOperationId';
    // Later monotonic transitions may have completed before a delayed original worker resumes.
    if (!sameId(cycle[field], op._id) || cycle.currency !== 'INR') return null;
    if (
      opens(op) &&
      (cycle.sequence !== op.payload.sequence ||
        cycle.memberIds.map(String).join(',') !== op.payload.memberIds.join(',') ||
        (op.kind === 'cycle_open_next' && !sameId(cycle.previousCycleId, op.cycleId)))
    )
      return null;
    await validateCycle(cycle);
    return cycle;
  }
  async function apply(groupId, op) {
    validateOperation(op);
    const receipt = await journal(op);
    if (receipt.completedAt) return receipt;
    const group = await groupFor(String(op.actor), groupId);
    if (
      !sameId(group.financialOperation?._id, op._id) ||
      group.financialOperation.phase !== 'applying' ||
      (!sourceMatches(group, op) && !targetMatches(group, op))
    )
      throw conflict('CYCLE_OPERATION_STALE');
    let proof = await cycleProof(op);
    if (!proof) {
      await fault('before_cycle_write', op);
      if (opens(op)) {
        try {
          await cycles.createForTransition(op);
        } catch (error) {
          if (error.code !== 11000) throw error;
        }
      } else await cycles.transition(op);
      await fault('after_cycle_write', op);
      proof = await cycleProof(op);
      if (!proof) throw conflict('CYCLE_TRANSITION_CONFLICT');
    }
    await fault('before_group_mirror', op);
    const mirrored = await groups.mirrorLifecycle(groupId, op);
    if (mirrored) await fault('after_group_mirror', op);
    const latest = mirrored ?? (await groupFor(String(op.actor), groupId));
    if (!sameId(latest.financialOperation?._id, op._id) || !targetMatches(latest, op)) {
      // A recovery worker may already have completed and released the same transition.
      const prior = await receipts.find(groupId, op.payload.intentKey);
      if (prior?.completedAt && prior.operationHash === op.payloadHash)
        return assertLifecycleReceipt(prior);
      throw conflict('CYCLE_MIRROR_CONFLICT');
    }
    const completed = await receipts.complete(
      groupId,
      String(op._id),
      op.payloadHash,
      new Date(Math.max(Date.now(), new Date(op.createdAt).getTime())),
    );
    await fault('after_receipt_complete', op);
    const result = completed ?? (await receipts.find(groupId, op.payload.intentKey));
    if (!result?.completedAt || result.operationHash !== op.payloadHash)
      throw conflict('CYCLE_RECEIPT_INVALID');
    return assertLifecycleReceipt(result);
  }
  async function finish(group) {
    const op = group.financialOperation;
    validateOperation(op);
    if (op.phase === 'checking') {
      try {
        await check(group, op);
        await fault('after_check', op);
      } catch (error) {
        // Only a proved validation failure in checking is cancellable. Never discard applying work.
        if (error instanceof HttpError && error.code !== 'CYCLE_OPERATION_INVALID')
          await groups.cancelLifecycle(String(group._id), op);
        throw error;
      }
      const promoted = await groups.promoteLifecycle(String(group._id), op);
      if (!promoted) {
        const current = await groupFor(String(op.actor), String(group._id));
        if (
          !sameId(current.financialOperation?._id, op._id) ||
          current.financialOperation.phase !== 'applying'
        ) {
          const prior = await receipts.find(String(group._id), op.payload.intentKey);
          if (prior?.completedAt && prior.operationHash === op.payloadHash)
            return assertLifecycleReceipt(prior);
          throw conflict('CYCLE_OPERATION_STALE');
        }
      }
      await fault('after_promote', op);
    }
    const receipt = await apply(String(group._id), op);
    await fault('before_release', op);
    const released = await groups.finishLifecycle(String(group._id), op);
    if (!released) {
      const latest = await groupFor(String(op.actor), String(group._id));
      if (sameId(latest.financialOperation?._id, op._id)) throw conflict('CYCLE_RELEASE_PENDING');
    }
    await fault('after_release', op);
    return receipt;
  }
  async function run(user, groupId, kind, input) {
    enabled();
    user = ownerIdSchema.parse(user).toLowerCase();
    groupId = ownerIdSchema.parse(groupId).toLowerCase();
    const schema = kind === 'cycle_open_first' ? firstCycleInput : cycleTransitionInput;
    const parsed = schema.safeParse(input);
    if (!parsed.success)
      throw new HttpError(400, 'Invalid cycle transition request', 'INVALID_CYCLE_TRANSITION');
    const data = { ...parsed.data, intent: parsed.data.intent.toLowerCase() };
    const group = await groupFor(user, groupId),
      intentKey = fingerprint(data.intent);
    const requestHash = fingerprint({ groupId, user, kind, data });
    const prior = await receipts.find(groupId, intentKey);
    if (prior) {
      assertLifecycleReceipt(prior);
      if (prior.requestHash !== requestHash) throw conflict('IDEMPOTENCY_CONFLICT');
      if (prior.completedAt) {
        if (sameId(group.financialOperation?._id, prior._id)) await finish(group);
        return { receipt: prior, replayed: true };
      }
    }
    if (group.financialOperation) {
      const op = group.financialOperation;
      if (op.payload?.intentKey === intentKey) {
        if (op.payload.requestHash !== requestHash) throw conflict('IDEMPOTENCY_CONFLICT');
        return { receipt: await finish(group), replayed: true };
      }
      throw conflict('FINANCIAL_BUSY');
    }
    if (prior) throw conflict('CYCLE_RECEIPT_INVALID');
    if (group.__v !== data.groupVersion)
      throw new HttpError(412, 'Group version is stale', 'VERSION_MISMATCH');
    const first = kind === 'cycle_open_first';
    const state = first
      ? 'none'
      : kind === 'cycle_freeze'
        ? 'open'
        : kind === 'cycle_close'
          ? 'frozen'
          : 'closed';
    let cycle;
    if (first) {
      if (
        group.currentCycleId ||
        group.currentCycleState ||
        (group.cycleEpoch !== undefined && group.cycleEpoch !== 0) ||
        group.settlementStartedAt
      )
        throw conflict('CYCLE_STATE_INVALID');
    } else {
      if (
        !sameId(group.currentCycleId, data.cycleId) ||
        group.cycleEpoch !== data.epoch ||
        group.currentCycleState !== state
      )
        throw conflict('CYCLE_STATE_INVALID');
      cycle = await cycles.find(groupId, data.cycleId);
      if (!cycle || cycle.status !== state || cycle.__v !== data.cycleVersion)
        throw new HttpError(412, 'Cycle version is stale', 'VERSION_MISMATCH');
      await validateCycle(cycle);
    }
    const targetId =
      first || kind === 'cycle_open_next' ? String(new mongoose.Types.ObjectId()) : data.cycleId;
    const effectiveAt = new Date(
      Math.max(
        Date.now(),
        cycle?.closedAt?.getTime() ?? cycle?.frozenAt?.getTime() ?? cycle?.openedAt?.getTime() ?? 0,
      ),
    ).toISOString();
    const op = {
      _id: new mongoose.Types.ObjectId(),
      actor: user,
      kind,
      protocolVersion: 2,
      groupId,
      cycleId: first ? targetId : data.cycleId,
      cycleEpoch: first ? 0 : data.epoch,
      expectedGroupVersion: data.groupVersion,
      expectedCycleVersion: first ? 0 : data.cycleVersion,
      targetId,
      phase: 'checking',
      startState: state,
      createdAt: new Date(effectiveAt),
      payload: {
        targetId,
        intentKey,
        requestHash,
        outcome: opens({ kind }) ? 'open' : kind === 'cycle_freeze' ? 'frozen' : 'closed',
        effectiveAt,
        hadHistory: !!group.financialHistoryAt,
        hadSettlementMarker: !!group.settlementStartedAt,
        ...(first || kind === 'cycle_open_next'
          ? {
              sequence: first ? 1 : sequenceAfter(cycle),
              memberIds: [...sortedCycleMembers(group.members.map((row) => row.user))],
            }
          : {}),
      },
    };
    op.payloadHash = lifecycleHash(op);
    const reserved = await groups.reserveLifecycle(user, groupId, op);
    if (!reserved) throw conflict('FINANCIAL_BUSY');
    await fault('after_reserve', op);
    return { receipt: await finish(reserved), replayed: false };
  }
  return {
    openFirst: (user, group, input) => run(user, group, 'cycle_open_first', input),
    freeze: (user, group, input) => run(user, group, 'cycle_freeze', input),
    close: (user, group, input) => run(user, group, 'cycle_close', input),
    openNext: (user, group, input) => run(user, group, 'cycle_open_next', input),
    async recover(user, groupId) {
      enabled();
      user = ownerIdSchema.parse(user).toLowerCase();
      groupId = ownerIdSchema.parse(groupId).toLowerCase();
      const group = await groupFor(user, groupId, false);
      if (!group.financialOperation) return { recovered: false };
      if (!LIFECYCLE_KINDS.includes(group.financialOperation.kind)) {
        const coordinator =
          financial ??
          createCycleFinancialService({
            internalEnabled,
            groups,
            cycles,
            balances,
            expenses,
            settlements,
          });
        return coordinator.recover(user, groupId);
      }
      requireGroupOwner(group, user);
      return { recovered: true, receipt: await finish(group) };
    },
  };
}
