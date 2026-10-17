import { createHash } from 'node:crypto';
import { z } from 'zod';
import { requireGroupMember, requireGroupOwner } from '../services/group-authorization.js';
import { publicExpense } from '../services/group-expense.service.js';
import { publicSettlement } from '../services/settlement.service.js';
import { expenseInput } from '../models/group-expense.model.js';
import {
  groupExpenseInputSchema,
  groupExpensePatchSchema,
  idempotencyKeySchema,
} from '../validators/group-expense.validator.js';
import { settlementInputSchema } from '../validators/settlement.validator.js';
import { allocateSplit } from '../utils/split.js';
import { safeBalanceNumber } from '../utils/group-balances.js';
import { HttpError } from '../utils/httpError.js';
import {
  id,
  empty,
  epoch,
  pageQuery,
  parse,
  expected,
  currentVersion,
  missing,
  publicCycle,
  publicHead,
} from './contract.js';
const hashKey = (value) => createHash('sha256').update(value.toLowerCase()).digest('hex');
function validateAllocation(data) {
  try {
    allocateSplit(data.amountMinor, data.split);
  } catch {
    throw new HttpError(400, 'Split must assign positive exact shares', 'INVALID_SPLIT');
  }
  return data;
}
async function assertReadable(row) {
  try {
    // Query-returned documents can carry transient immutable-default errors after a CAS.
    // Validate a fresh snapshot without saving or changing the persisted schema.
    await new row.constructor(row.toObject()).validate();
  } catch {
    throw new HttpError(422, 'Financial data cannot be safely read', 'BALANCE_DATA_INVALID');
  }
  if (!row.cycleId)
    throw new HttpError(422, 'Missing financial cycle association', 'CYCLE_ASSOCIATION_INVALID');
}
const scopedExpense = (row) => ({
  ...publicExpense(row),
  cycleId: String(row.cycleId),
});
const scopedSettlement = (row) => ({
  ...publicSettlement(row),
  cycleId: String(row.cycleId),
});
export function createCycleHttpService({
  groups,
  cycles,
  expenses,
  settlements,
  profiles,
  financial,
  lifecycle,
  history,
}) {
  async function groupFor(user, groupId) {
    groupId = parse(id, groupId);
    const group = await requireGroupMember(groups, user, groupId);
    if (group.financialProtocolVersion !== 2)
      throw new HttpError(409, 'Cycle protocol is inactive', 'CYCLE_PROTOCOL_INACTIVE');
    return group;
  }
  async function cycleFor(groupId, cycleId) {
    const cycle = await cycles.find(groupId, parse(id, cycleId));
    if (!cycle) throw missing();
    try {
      await cycle.validate();
    } catch {
      throw new HttpError(422, 'Cycle data cannot be safely read', 'CYCLE_DATA_INVALID');
    }
    return cycle;
  }
  async function envelope(user, groupId, data) {
    const group = await groupFor(user, groupId);
    if ((data.cycle || data.cycles) && group.financialOperation)
      throw new HttpError(409, 'Cycle transition must be recovered first', 'FINANCIAL_BUSY');
    return { ...data, group: publicHead(group) };
  }
  async function registered(ids) {
    const unique = [...new Set(ids)];
    if (unique.length > 100)
      throw new HttpError(
        400,
        'Financial identities exceed the group member limit',
        'INVALID_MEMBERSHIP',
      );
    const rows = await profiles.publicProfiles(unique);
    if (rows.length !== unique.length)
      throw new HttpError(400, 'Financial identities must be registered', 'INVALID_MEMBERSHIP');
  }
  return {
    async list(user, groupId, kind, input) {
      const group = await groupFor(user, groupId);
      if (group.financialOperation && kind === 'cycles')
        throw new HttpError(409, 'Cycle transition must be recovered first', 'FINANCIAL_BUSY');
      const query = parse(pageQuery, input, 'INVALID_QUERY');
      if (kind === 'cycles' && query.cycleId)
        throw new HttpError(400, 'Unsupported cycle filter', 'INVALID_QUERY');
      if (query.cycleId) await cycleFor(groupId, query.cycleId);
      const result = await history.page(kind, user, groupId, query);
      for (const row of result.rows) {
        if (kind === 'cycles') {
          try {
            await row.validate();
          } catch {
            throw new HttpError(
              422,
              'Financial data cannot be safely read',
              'BALANCE_DATA_INVALID',
            );
          }
        } else await assertReadable(row);
        if (kind !== 'cycles' && !row.cycleId)
          throw new HttpError(
            422,
            'Missing financial cycle association',
            'CYCLE_ASSOCIATION_INVALID',
          );
      }
      const mapper =
        kind === 'cycles' ? publicCycle : kind === 'expenses' ? scopedExpense : scopedSettlement;
      return {
        data: await envelope(user, groupId, {
          [kind]: result.rows.map(mapper),
        }),
        pagination: result.pagination,
      };
    },
    async get(user, groupId, kind, target, query) {
      parse(empty, query, 'INVALID_QUERY');
      const group = await groupFor(user, groupId);
      if (group.financialOperation && kind === 'cycles')
        throw new HttpError(409, 'Cycle transition must be recovered first', 'FINANCIAL_BUSY');
      target = parse(id, target);
      const row =
        kind === 'cycles'
          ? await cycleFor(groupId, target)
          : await (kind === 'expenses' ? expenses : settlements).find(groupId, target);
      if (!row || (kind !== 'cycles' && !row.cycleId)) throw missing();
      if (kind === 'cycles') {
        try {
          await row.validate();
        } catch {
          throw new HttpError(422, 'Financial data cannot be safely read', 'BALANCE_DATA_INVALID');
        }
      } else await assertReadable(row);
      const key = kind === 'cycles' ? 'cycle' : kind === 'expenses' ? 'expense' : 'settlement';
      return envelope(user, groupId, {
        [key]: (kind === 'cycles'
          ? publicCycle
          : kind === 'expenses'
            ? scopedExpense
            : scopedSettlement)(row),
      });
    },
    async transition(user, groupId, action, target, body, headers) {
      const group = await groupFor(user, groupId);
      requireGroupOwner(group, user);
      const intent = parse(
        idempotencyKeySchema,
        headers.key,
        'IDEMPOTENCY_KEY_REQUIRED',
      ).toLowerCase();
      let result;
      if (action === 'open') {
        const data = parse(
          z.object({ previousCycleId: id.optional(), epoch: epoch.optional() }).strict(),
          body,
        );
        const groupVersion = expected(headers.match, groupId);
        if (data.previousCycleId) {
          await cycleFor(groupId, data.previousCycleId);
          result = await lifecycle.openNext(user, groupId, {
            intent,
            groupVersion,
            cycleId: data.previousCycleId,
            cycleVersion: expected(headers.cycleMatch, data.previousCycleId),
            epoch: data.epoch,
          });
        } else {
          if (data.epoch !== undefined)
            throw new HttpError(400, 'Initial cycle has no epoch input', 'INVALID_REQUEST');
          // No current-state default: an empty request always means the first cycle, including retries.
          result = await lifecycle.openFirst(user, groupId, {
            intent,
            groupVersion,
          });
        }
      } else {
        target = parse(id, target);
        await cycleFor(groupId, target);
        const data = parse(z.object({ epoch }).strict(), body);
        result = await lifecycle[action](user, groupId, {
          intent,
          groupVersion: expected(headers.groupMatch, groupId),
          cycleId: target,
          cycleVersion: expected(headers.match, target),
          epoch: data.epoch,
        });
      }
      const cycle = await cycleFor(groupId, String(result.receipt.cycleId));
      return envelope(user, groupId, {
        cycle: publicCycle(cycle),
        replayed: result.replayed,
        transition: {
          outcome: result.receipt.outcome,
          completedAt: result.receipt.completedAt.toISOString(),
        },
      });
    },
    async create(user, groupId, kind, input, keyValue) {
      const group = await groupFor(user, groupId);
      const key = parse(idempotencyKeySchema, keyValue, 'IDEMPOTENCY_KEY_REQUIRED');
      const schema = kind === 'expenses' ? groupExpenseInputSchema : settlementInputSchema;
      const parsed = parse(schema.extend({ cycleId: id.optional() }), input);
      const { cycleId: selected, ...data } = parsed;
      if (kind === 'expenses') validateAllocation(data);
      // Receipt resolution precedes active-cycle selection. Missing cycle is allowed only for a verified migrated replay.
      const prior =
        kind === 'expenses'
          ? await expenses.findReceipt(groupId, user, hashKey(key))
          : await settlements.receipt(groupId, user, hashKey(key));
      let cycleId = selected;
      if (!cycleId && prior?.cycleId) {
        const original = await cycleFor(groupId, String(prior.cycleId));
        if (original.sequence === 1 && original.migrationVersion === 1 && original.migrationRunId)
          cycleId = String(original._id);
      }
      if (!cycleId)
        throw new HttpError(
          409,
          'Select an explicit cycle before creating financial records',
          'CYCLE_SELECTION_REQUIRED',
        );
      await cycleFor(groupId, cycleId);
      // Existing receipts must replay even after editing or changes to current membership.
      if (!prior) {
        await registered(
          kind === 'expenses'
            ? [
                user,
                data.payer,
                ...data.split.participants.map((p) => (typeof p === 'string' ? p : p.user)),
              ]
            : [user, data.recipient],
        );
      }
      const result = await financial.run(
        user,
        groupId,
        cycleId,
        group.cycleEpoch,
        kind === 'expenses' ? 'expense_create' : 'settlement_create',
        { data, key },
      );
      await assertReadable(result.row);
      return envelope(user, groupId, {
        [kind === 'expenses' ? 'expense' : 'settlement']: (kind === 'expenses'
          ? scopedExpense
          : scopedSettlement)(result.row),
        replayed: result.replayed,
      });
    },
    async mutate(user, groupId, kind, target, action, input, match) {
      const group = await groupFor(user, groupId);
      target = parse(id, target);
      const row = await (kind === 'expenses' ? expenses : settlements).find(groupId, target);
      if (!row || !row.cycleId) throw missing();
      if (kind === 'expenses' && String(group.creator) !== user && String(row.creator) !== user)
        throw new HttpError(403, 'Expense creator or owner required', 'EXPENSE_EDIT_FORBIDDEN');
      if (kind === 'settlements' && String(row.recipient) !== user)
        throw new HttpError(403, 'Only the recipient may decide', 'SETTLEMENT_RECIPIENT_REQUIRED');
      const version = currentVersion(match, row);
      let data;
      if (action === 'update') {
        const merged = {
          ...expenseInput(row),
          ...parse(groupExpensePatchSchema, input),
        };
        if (merged.notes === null) delete merged.notes;
        data = validateAllocation(parse(groupExpenseInputSchema, merged));
        await registered([
          user,
          data.payer,
          ...data.split.participants.map((p) => (typeof p === 'string' ? p : p.user)),
        ]);
      } else parse(empty, input ?? {});
      const result = await financial.run(
        user,
        groupId,
        String(row.cycleId),
        group.cycleEpoch,
        kind === 'expenses' ? `expense_${action}` : `settlement_${action}`,
        { targetId: target, version, ...(data ? { data } : {}) },
      );
      await assertReadable(result.row);
      return envelope(
        user,
        groupId,
        action === 'delete'
          ? { deleted: true }
          : {
              [kind === 'expenses' ? 'expense' : 'settlement']: (kind === 'expenses'
                ? scopedExpense
                : scopedSettlement)(result.row),
            },
      );
    },
    async balances(user, groupId, query) {
      await groupFor(user, groupId);
      const { cycleId } = parse(
        z.object({ cycleId: id }).strict(),
        query,
        'CYCLE_SELECTION_REQUIRED',
      );
      await cycleFor(groupId, cycleId);
      const { rows, suggestions } = await financial.balances(user, groupId, cycleId);
      return envelope(user, groupId, {
        balances: {
          groupId,
          cycleId,
          currency: 'INR',
          netTotalMinor: 0,
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
          suggestions,
        },
      });
    },
    async recover(user, groupId, input) {
      parse(empty, input);
      await groupFor(user, groupId);
      const result = await lifecycle.recover(user, groupId);
      const group = await groupFor(user, groupId);
      return envelope(user, groupId, {
        recovered: result.recovered,
        ...(group.currentCycleId
          ? {
              cycle: publicCycle(await cycleFor(groupId, String(group.currentCycleId))),
            }
          : {}),
      });
    },
  };
}
