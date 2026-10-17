import { Group, groupCollectionValidator } from '../../models/group.model.js';
import { GroupExpense, groupExpenseCollectionValidator } from '../../models/group-expense.model.js';
import {
  GroupSettlement,
  settlementCollectionValidator,
} from '../../models/group-settlement.model.js';
import {
  GroupFinancialCycle,
  groupFinancialCycleCollectionValidator,
} from '../../models/group-financial-cycle.model.js';
import {
  GroupCycleTransition,
  cycleTransitionValidator,
} from '../../models/group-cycle-transition.model.js';
import { User } from '../../models/user.model.js';
import { canonical } from './reconcile.js';
import { fail } from './safety.js';
export function migrationModels(connection) {
  return Object.fromEntries(
    [
      ['G', Group],
      ['E', GroupExpense],
      ['S', GroupSettlement],
      ['C', GroupFinancialCycle],
      ['T', GroupCycleTransition],
      ['U', User],
    ].map(([key, model]) => [key, connection.model(model.modelName, model.schema)]),
  );
}
export const definitions = [
  [Group, groupCollectionValidator],
  [GroupExpense, groupExpenseCollectionValidator],
  [GroupSettlement, settlementCollectionValidator],
  [GroupFinancialCycle, groupFinancialCycleCollectionValidator],
  [GroupCycleTransition, cycleTransitionValidator],
];
export async function verifyIndexes(db, model) {
  const indexes = await db.collection(model.collection.name).indexes();
  if (indexes.some((index) => index.expireAfterSeconds !== undefined)) fail('UNEXPECTED_TTL_INDEX');
  for (const [key, options] of model.schema.indexes()) {
    if (
      !indexes.some(
        (index) =>
          JSON.stringify(index.key) === JSON.stringify(key) &&
          !!index.unique === !!options.unique &&
          !!index.sparse === !!options.sparse &&
          canonical(index.partialFilterExpression ?? {}) ===
            canonical(options.partialFilterExpression ?? {}),
      )
    )
      fail('REQUIRED_INDEX_MISSING');
  }
}
export function strictFinancialValidator(base, groups) {
  // Legacy compatibility remains for unrelated/quarantined groups; every migrated row requires a cycle.
  return {
    $and: [base, { $or: [{ group: { $nin: groups } }, { cycleId: { $type: 'objectId' } }] }],
  };
}
export function strictGroupValidator(base, groups) {
  return {
    $and: [
      base,
      {
        $or: [
          { _id: { $nin: groups } },
          {
            $and: [
              { 'cycleMigration.version': 1 },
              { 'cycleMigration.runId': { $type: 'objectId' } },
              {
                $or: [
                  { 'cycleMigration.state': { $ne: 'verified' } },
                  {
                    $and: [
                      { financialProtocolVersion: 2 },
                      { currentCycleId: { $type: 'objectId' } },
                      { currentCycleState: { $in: ['open', 'frozen'] } },
                      { cycleEpoch: 1 },
                      { financialOperation: { $exists: false } },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  };
}
export async function preflight(connection, models, run) {
  const info = await connection.db.admin().command({ buildInfo: 1 });
  if (info.versionArray[0] !== 8) fail('UNSUPPORTED_MONGODB_VERSION');
  const metadata = await connection.db.listCollections().toArray();
  for (const model of [models.G, models.E, models.S, models.U]) {
    if (!metadata.some((row) => row.name === model.collection.name))
      fail('EXPECTED_COLLECTION_MISSING');
  }
  for (const [model, validator] of definitions.slice(0, 3)) {
    const row = metadata.find((item) => item.name === model.collection.name);
    const installed = row?.options?.validator;
    const expected = run?.strictGroups?.length
      ? model === Group
        ? strictGroupValidator(validator, run.strictGroups)
        : strictFinancialValidator(validator, run.strictGroups)
      : validator;
    const previousGroupValidator = structuredClone(groupCollectionValidator);
    delete previousGroupValidator.$and[0].$jsonSchema.properties.cycleMigration;
    const knownPrevious =
      model === Group && canonical(installed) === canonical(previousGroupValidator);
    if (
      row?.options?.validationLevel !== 'strict' ||
      row?.options?.validationAction !== 'error' ||
      (!knownPrevious &&
        canonical(installed) !== canonical(expected) &&
        canonical(installed) !== canonical(validator))
    )
      fail('COLLECTION_VALIDATOR_MISMATCH');
    await verifyIndexes(connection.db, model);
  }
  for (const [model, validator] of definitions.slice(3)) {
    const installed = metadata.find((row) => row.name === model.collection.name);
    if (!installed) continue;
    let knownPrevious = false;
    if (model === GroupFinancialCycle) {
      const previous = structuredClone(validator);
      delete previous.$and[0].$jsonSchema.properties.migrationVersion;
      delete previous.$and[0].$jsonSchema.properties.migrationRunId;
      previous.$and[1].$expr.$and.shift();
      knownPrevious = canonical(installed.options.validator) === canonical(previous);
    }
    if (
      installed.options.validationLevel !== 'strict' ||
      installed.options.validationAction !== 'error' ||
      (!knownPrevious && canonical(installed.options.validator) !== canonical(validator))
    )
      fail('CYCLE_VALIDATOR_MISMATCH');
    // Missing dormant-cycle indexes may be an interrupted setup; installCycles must build and verify them before any backfill.
  }
  const active = await connection.db.admin().command({ currentOp: 1, active: true });
  if (
    (active.inprog ?? []).some(
      (op) =>
        op.ns?.startsWith(connection.name + '.') && op.appName !== 'tallynest-cycle-migrator-v1',
    )
  )
    fail('UNEXPECTED_ACTIVE_WRITER');
  for (const model of [models.E, models.S]) {
    const orphans = await model.collection
      .aggregate([
        {
          $lookup: {
            from: models.G.collection.name,
            localField: 'group',
            foreignField: '_id',
            as: 'matchingGroup',
          },
        },
        { $match: { matchingGroup: { $size: 0 } } },
        { $limit: 1 },
      ])
      .toArray();
    if (orphans.length) fail('ORPHAN_FINANCIAL_RECORD');
  }
  return {
    mongo: info.version,
    activeCommandsChecked: true,
    writerShutdown: 'operator-attested-not-proven',
  };
}
export async function installCycles(connection, fault) {
  for (const [model, validator] of definitions.slice(3)) {
    const name = model.collection.name;
    if (!(await connection.db.listCollections({ name }).toArray()).length) {
      try {
        await connection.db.createCollection(name, {
          validator,
          validationLevel: 'strict',
          validationAction: 'error',
        });
      } catch (error) {
        if (error.code !== 48) throw error;
      }
    }
    await connection.db.command({
      collMod: name,
      validator,
      validationLevel: 'strict',
      validationAction: 'error',
    });
    await fault('during_index_install');
    await connection.db.collection(name).createIndexes(
      model.schema.indexes().map(([key, options]) => ({
        key,
        name: options.name ?? Object.entries(key).flat().join('_'),
        ...options,
      })),
    );
    await verifyIndexes(connection.db, model);
  }
}
