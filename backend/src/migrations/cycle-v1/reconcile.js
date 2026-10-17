import { createHash } from 'node:crypto';
import mongoose from 'mongoose';
import { groupCollectionValidator } from '../../models/group.model.js';
import { groupExpenseCollectionValidator } from '../../models/group-expense.model.js';
import { settlementCollectionValidator } from '../../models/group-settlement.model.js';
import { createGroupBalanceRepository } from '../../repositories/group-balance.repository.js';
import { calculateBalances, safeBalanceNumber } from '../../utils/group-balances.js';
import { fail } from './safety.js';
const { EJSON } = mongoose.mongo.BSON;
export function canonical(value) {
  const normalized = EJSON.serialize(value, { relaxed: false });
  const sort = (item) =>
    Array.isArray(item)
      ? item.map(sort)
      : item && typeof item === 'object'
        ? Object.fromEntries(
            Object.keys(item)
              .sort()
              .map((key) => [key, sort(item[key])]),
          )
        : item;
  return JSON.stringify(sort(normalized));
}
export async function databaseDigest(db) {
  const hash = createHash('sha256');
  const collections = (await db.listCollections({}, { nameOnly: true }).toArray())
    .map((c) => c.name)
    .filter((n) => !n.startsWith('system.'))
    .sort();
  for (const name of collections) {
    hash.update(name + '\n');
    for await (const row of db.collection(name).find({}).sort({ _id: 1 }))
      hash.update(canonical(row) + '\n');
  }
  return hash.digest('hex');
}
export function groupFingerprint(group) {
  const {
    cycleMigration: _m,
    financialProtocolVersion: _p,
    currentCycleId: _c,
    currentCycleState: _s,
    cycleEpoch: _e,
    ...rest
  } = group;
  return createHash('sha256').update(canonical(rest)).digest('hex');
}
export async function reconcile(models, group, cycleId, allowedPartialCycleId) {
  const { G, E, S, U } = models,
    groupId = group._id;
  if (await G.collection.findOne({ _id: groupId, $nor: [groupCollectionValidator] }))
    fail('INVALID_GROUP');
  const ids = group.members.map((m) => String(m.user)).sort();
  if ((await U.countDocuments({ _id: { $in: group.members.map((m) => m.user) } })) !== ids.length)
    fail('MISSING_REGISTERED_IDENTITY');
  const identities = new Set(),
    counters = { expenses: 0, tombstones: 0, pending: 0, confirmed: 0, rejected: 0 };
  let total = 0n,
    shares = 0n,
    confirmed = 0n,
    pending = 0n,
    allExpenses = 0n,
    allShares = 0n;
  const hashes = {
    expenses: createHash('sha256'),
    settlements: createHash('sha256'),
    keys: createHash('sha256'),
    versions: createHash('sha256'),
    receipts: createHash('sha256'),
  };
  for (const [model, validator, kind] of [
    [E, groupExpenseCollectionValidator, 'expenses'],
    [S, settlementCollectionValidator, 'settlements'],
  ]) {
    if (await model.collection.findOne({ group: groupId, $nor: [validator] }))
      fail('INVALID_FINANCIAL_RECORD');
    for await (const row of model.collection
      .find({ group: groupId })
      .sort({ _id: 1 })
      .batchSize(50)) {
      if (cycleId && String(row.cycleId) !== String(cycleId)) fail('CYCLE_ASSOCIATION_MISMATCH');
      if (!cycleId && row.cycleId && String(row.cycleId) !== String(allowedPartialCycleId))
        fail('UNTRACKED_PARTIAL_MIGRATION');
      const { cycleId: _cycle, ...original } = row;
      hashes[kind].update(canonical(original) + '\n');
      hashes.keys.update(canonical([row._id, row.creationKey, row.creationHash]) + '\n');
      hashes.versions.update(canonical([row._id, row.__v]) + '\n');
      hashes.receipts.update(
        canonical([
          row._id,
          row.lastFinancialOperation,
          row.deletedAt,
          row.decisionBy,
          row.confirmedAt,
          row.rejectedAt,
        ]) + '\n',
      );
      if (kind === 'expenses') {
        counters.expenses++;
        if (row.deletedAt) counters.tombstones++;
        allExpenses += BigInt(row.amountMinor);
        allShares += row.shares.reduce((sum, s) => sum + BigInt(s.amountMinor), 0n);
        for (const who of [row.creator, row.payer, ...row.shares.map((s) => s.user)])
          identities.add(String(who));
        if (!row.deletedAt) {
          total += BigInt(row.amountMinor);
          shares += row.shares.reduce((sum, s) => sum + BigInt(s.amountMinor), 0n);
        }
      } else {
        counters[row.status]++;
        identities.add(String(row.sender));
        identities.add(String(row.recipient));
        if (row.status === 'confirmed') confirmed += BigInt(row.amountMinor);
        if (row.status === 'pending') pending += BigInt(row.amountMinor);
      }
    }
  }
  if ([...identities].some((id) => !ids.includes(id))) fail('HISTORICAL_IDENTITY_NOT_MEMBER');
  if (
    (counters.expenses || counters.pending || counters.confirmed || counters.rejected) &&
    !group.financialHistoryAt
  )
    fail('MISSING_HISTORY_MARKER');
  if ((counters.pending || counters.confirmed || counters.rejected) && !group.settlementStartedAt)
    fail('MISSING_SETTLEMENT_MARKER');
  for (const value of [total, shares, confirmed, pending, allExpenses, allShares])
    safeBalanceNumber(value);
  if (total !== shares || allExpenses !== allShares) fail('SHARE_RECONCILIATION_FAILED');
  const rows = calculateBalances(
    ids,
    await createGroupBalanceRepository(E, S).aggregate(
      String(groupId),
      ids,
      cycleId ? String(cycleId) : undefined,
    ),
  );
  return {
    groupDigest: groupFingerprint(group),
    counters,
    identities: [...identities].sort(),
    members: ids,
    digests: Object.fromEntries(
      Object.entries(hashes).map(([key, hash]) => [key, hash.digest('hex')]),
    ),
    totals: {
      expenseMinor: total.toString(),
      shareMinor: shares.toString(),
      allExpenseMinor: allExpenses.toString(),
      allShareMinor: allShares.toString(),
      tombstoneMinor: (allExpenses - total).toString(),
      confirmedMinor: confirmed.toString(),
      pendingMinor: pending.toString(),
    },
    balances: rows.map((r) =>
      Object.fromEntries(
        Object.entries(r).map(([key, value]) => [
          key,
          typeof value === 'bigint' ? value.toString() : value,
        ]),
      ),
    ),
  };
}

export async function databaseSchemaDigest(db) {
  const hash = createHash('sha256');
  const collections = (await db.listCollections().toArray())
    .filter((row) => !row.name.startsWith('system.'))
    .sort((a, b) => a.name.localeCompare(b.name));
  for (const row of collections) {
    const indexes = await db.collection(row.name).indexes();
    hash.update(
      canonical({
        name: row.name,
        options: row.options,
        indexes: indexes
          .map(({ v: _v, ns: _ns, ...index }) => index)
          .sort((a, b) => a.name.localeCompare(b.name)),
      }),
    );
  }
  return hash.digest('hex');
}
