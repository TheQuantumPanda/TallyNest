import { isDeepStrictEqual } from 'node:util';
import { definitions } from '../migrations/cycle-v1/preflight.js';
import { HttpError } from '../utils/httpError.js';

const unavailable = (code) => new HttpError(503, 'Staged cycle API is unavailable', code);
// Read only: never creates indexes, installs validators, or releases maintenance.
export async function assertCycleHttpReadiness(db, { allowRecovery = false } = {}) {
  if (await db.collection('cyclemigrationruns').findOne({ offlineHeld: true }))
    throw unavailable('CYCLE_MIGRATION_MAINTENANCE');
  if (await db.collection('groups').findOne({ cycleMigration: { $exists: true } }))
    throw unavailable('CYCLE_MIGRATION_MAINTENANCE');
  const metadata = await db.listCollections().toArray();
  for (const [model, validator] of definitions) {
    const entry = metadata.find((row) => row.name === model.collection.name);
    if (
      !entry ||
      entry.options.validationLevel !== 'strict' ||
      entry.options.validationAction !== 'error' ||
      !isDeepStrictEqual(entry.options.validator, validator)
    )
      throw unavailable('CYCLE_SCHEMA_NOT_READY');
    const indexes = await db.collection(model.collection.name).indexes();
    if (indexes.some((index) => index.expireAfterSeconds !== undefined))
      throw unavailable('CYCLE_INDEX_NOT_READY');
    for (const [key, options] of model.schema.indexes()) {
      if (
        !indexes.some(
          (index) =>
            isDeepStrictEqual(index.key, key) &&
            !!index.unique === !!options.unique &&
            !!index.sparse === !!options.sparse &&
            isDeepStrictEqual(
              index.partialFilterExpression ?? {},
              options.partialFilterExpression ?? {},
            ),
        )
      )
        throw unavailable('CYCLE_INDEX_NOT_READY');
    }
  }
  if (
    !allowRecovery &&
    (await db.collection('groups').findOne({
      financialProtocolVersion: 2,
      financialOperation: { $exists: true },
    }))
  )
    throw unavailable('CYCLE_RECOVERY_REQUIRED');
}

// A separate read-only activation inspection, called before constructing the fixture router.
// Per-request schema probes deliberately omit this scan: separate reads could observe an in-flight CAS.
export async function assertCycleGroupConsistency(db) {
  const groups = db.collection('groups');
  if (await groups.findOne({ financialProtocolVersion: { $exists: true, $ne: 2 } }))
    throw unavailable('CYCLE_PROTOCOL_INACTIVE');
  for await (const group of groups.find({ financialProtocolVersion: 2 })) {
    if (group.financialOperation) throw unavailable('CYCLE_RECOVERY_REQUIRED');
    if (!group.currentCycleId) {
      if (
        group.currentCycleState ||
        (group.cycleEpoch !== undefined && group.cycleEpoch !== 0) ||
        (await db.collection('groupfinancialcycles').findOne({ group: group._id }))
      )
        throw unavailable('CYCLE_POINTER_INVALID');
    } else {
      const cycle = await db
        .collection('groupfinancialcycles')
        .findOne({ group: group._id, _id: group.currentCycleId });
      if (
        !cycle ||
        cycle.status !== group.currentCycleState ||
        cycle.currency !== group.currency ||
        !Number.isSafeInteger(group.cycleEpoch) ||
        group.cycleEpoch < 1
      )
        throw unavailable('CYCLE_POINTER_INVALID');
    }
    for (const name of ['groupexpenses', 'groupsettlements']) {
      if (await db.collection(name).findOne({ group: group._id, cycleId: { $exists: false } }))
        throw unavailable('CYCLE_ASSOCIATION_INVALID');
      const orphan = await db
        .collection(name)
        .aggregate(
          [
            { $match: { group: group._id } },
            {
              $lookup: {
                from: 'groupfinancialcycles',
                let: { cycle: '$cycleId', group: '$group' },
                pipeline: [
                  {
                    $match: {
                      $expr: {
                        $and: [{ $eq: ['$_id', '$$cycle'] }, { $eq: ['$group', '$$group'] }],
                      },
                    },
                  },
                ],
                as: 'cycles',
              },
            },
            { $match: { cycles: { $size: 0 } } },
            { $limit: 1 },
          ],
          { maxTimeMS: 5000 },
        )
        .toArray();
      if (orphan.length) throw unavailable('CYCLE_ASSOCIATION_INVALID');
    }
  }
}
