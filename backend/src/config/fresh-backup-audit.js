// Offline, read-only backup/restore proof for fresh-v2 (including multiple cycles).
// Writers must be stopped. Never exposed through the web application.
import { createHash } from 'node:crypto';
import { assertFreshCycleReadiness } from './fresh-cycle-setup.js';
import { freshCollections } from './fresh-cycle-schema.js';
import { GroupExpense } from '../models/group-expense.model.js';
import { GroupSettlement } from '../models/group-settlement.model.js';
import { GroupFinancialCycle } from '../models/group-financial-cycle.model.js';
import { createGroupBalanceRepository } from '../repositories/group-balance.repository.js';
import { calculateBalances } from '../utils/group-balances.js';
import { assertClosable } from '../utils/cycle-lifecycle.js';
// Only these generic, read-only hashes are reused; the migration reconciler
// assumes a single legacy cycle and must not be used to audit fresh-v2 history.
import {
  canonical,
  databaseDigest,
  databaseSchemaDigest,
} from '../migrations/cycle-v1/reconcile.js';
const fail = (code) => {
  throw new Error(code);
};
const adapter = (collection) => ({
  aggregate: (pipeline) => ({
    option: (options) => ({ exec: () => collection.aggregate(pipeline, options).toArray() }),
  }),
});
export async function auditFreshBackup(db) {
  await assertFreshCycleReadiness(db);
  const before = await databaseDigest(db),
    schemaBefore = await databaseSchemaDigest(db);
  if (
    (await db.collection('groups').findOne({ financialOperation: { $exists: true } })) ||
    (await db.collection('recurringschedules').findOne({ pending: { $exists: true } }))
  )
    fail('FRESH_BACKUP_RECOVERY_REQUIRED');
  const counts = {};
  for (const spec of freshCollections) {
    if (await db.collection(spec.name).findOne({ $nor: [spec.definition] }))
      fail('FRESH_BACKUP_INVALID_RECORD');
    counts[spec.name] = await db.collection(spec.name).countDocuments({});
  }
  for (const [name, Model] of [
    ['groupexpenses', GroupExpense],
    ['groupsettlements', GroupSettlement],
    ['groupfinancialcycles', GroupFinancialCycle],
  ])
    for await (const row of db.collection(name).find({}).sort({ _id: 1 })) {
      try {
        await new Model(row).validate();
      } catch {
        fail('FRESH_BACKUP_INVALID_RECORD');
      }
    }
  const balances = createGroupBalanceRepository(
    adapter(db.collection('groupexpenses')),
    adapter(db.collection('groupsettlements')),
  );
  const cycles = [];
  for await (const cycle of db
    .collection('groupfinancialcycles')
    .find({})
    .sort({ group: 1, sequence: 1 })) {
    const ids = cycle.memberIds.map(String);
    if (
      (await db.collection('users').countDocuments({ _id: { $in: cycle.memberIds } })) !==
      ids.length
    )
      fail('FRESH_BACKUP_MISSING_IDENTITY');
    const rows = calculateBalances(
      ids,
      await balances.aggregate(String(cycle.group), ids, String(cycle._id)),
    );
    if (cycle.status === 'closed') assertClosable(rows);
    cycles.push({
      group: String(cycle.group),
      cycle: String(cycle._id),
      sequence: cycle.sequence,
      state: cycle.status,
      members: rows.map((row) =>
        Object.fromEntries(
          Object.entries(row).map(([key, value]) => [
            key,
            typeof value === 'bigint' ? value.toString() : value,
          ]),
        ),
      ),
    });
  }
  const dataDigest = await databaseDigest(db);
  await assertFreshCycleReadiness(db);
  const schemaDigest = await databaseSchemaDigest(db);
  if (dataDigest !== before || schemaDigest !== schemaBefore) fail('FRESH_BACKUP_WRITER_DETECTED');
  return {
    formatVersion: 1,
    counts,
    dataDigest,
    schemaDigest,
    cycles,
    financialDigest: createHash('sha256').update(canonical(cycles)).digest('hex'),
  };
}
