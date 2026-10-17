import {
  FRESH_MANIFEST_COLLECTION,
  FRESH_MANIFEST_ID,
  FRESH_PROFILE,
  FRESH_PROFILE_VERSION,
  freshCollections,
  indexMatches,
  manifestValidator,
  sameDefinition,
} from './fresh-cycle-schema.js';

const fail = (code) => {
  throw new Error(code);
};
const expectedNames = new Set([
  FRESH_MANIFEST_COLLECTION,
  ...freshCollections.map((item) => item.name),
]);
const manifest = (checkpoint, state = 'initializing') => ({
  _id: FRESH_MANIFEST_ID,
  profile: FRESH_PROFILE,
  version: FRESH_PROFILE_VERSION,
  state,
  checkpoint,
});

async function metadata(db) {
  const rows = await db.listCollections().toArray();
  if (rows.some((row) => !expectedNames.has(row.name))) fail('FRESH_UNKNOWN_COLLECTION');
  return new Map(rows.map((row) => [row.name, row]));
}
async function assertCollection(db, row, spec, allowPartial = false) {
  if (
    !row ||
    row.options?.validationLevel !== 'strict' ||
    row.options?.validationAction !== 'error' ||
    !sameDefinition(row.options.validator, spec.definition)
  )
    fail('FRESH_VALIDATOR_MISMATCH');
  const actual = await db.collection(spec.name).indexes();
  const required = spec.indexes;
  if (
    actual.some(
      (index) =>
        index.expireAfterSeconds !== undefined ||
        (index.name !== '_id_' && !required.some((expected) => indexMatches(index, expected))),
    )
  )
    fail('FRESH_INDEX_MISMATCH');
  if (!actual.some((index) => index.name === '_id_' && sameDefinition(index.key, { _id: 1 })))
    fail('FRESH_INDEX_MISMATCH');
  if (
    !allowPartial &&
    required.some((expected) => !actual.some((index) => indexMatches(index, expected)))
  )
    fail('FRESH_INDEX_MISSING');
}
async function readManifest(db, rows) {
  const row = rows.get(FRESH_MANIFEST_COLLECTION);
  if (!row) return null;
  await assertCollection(db, row, {
    name: FRESH_MANIFEST_COLLECTION,
    definition: manifestValidator,
    indexes: [],
  });
  const documents = await db.collection(FRESH_MANIFEST_COLLECTION).find({}).limit(2).toArray();
  if (documents.length > 1) fail('FRESH_MANIFEST_INVALID');
  return documents[0] ?? null;
}
function assertManifest(document) {
  if (
    !document ||
    document._id !== FRESH_MANIFEST_ID ||
    document.profile !== FRESH_PROFILE ||
    document.version !== FRESH_PROFILE_VERSION ||
    !Number.isInteger(document.checkpoint) ||
    document.checkpoint < 0 ||
    document.checkpoint > freshCollections.length ||
    !['initializing', 'ready'].includes(document.state) ||
    (document.state === 'ready' && document.checkpoint !== freshCollections.length)
  )
    fail('FRESH_MANIFEST_INVALID');
}

// A failed group operation remains reserved and needs its original authorized recovery.
// Readiness never clears it or refuses the entire API because of that one group.
async function inspectFinancialState(db) {
  if (await db.collection('cyclemigrationruns').findOne({})) fail('FRESH_MIGRATION_HELD');
  if (
    await db.collection('groups').findOne({
      $or: [{ financialProtocolVersion: { $ne: 2 } }, { cycleMigration: { $exists: true } }],
    })
  )
    fail('FRESH_LEGACY_GROUP');
  for (const name of ['groupexpenses', 'groupsettlements']) {
    if (await db.collection(name).findOne({ cycleId: { $exists: false } }))
      fail('FRESH_CYCLE_ASSOCIATION_INVALID');
    const orphan = await db
      .collection(name)
      .aggregate(
        [
          {
            $lookup: {
              from: 'groupfinancialcycles',
              let: { cycle: '$cycleId', group: '$group' },
              pipeline: [
                {
                  $match: {
                    $expr: { $and: [{ $eq: ['$_id', '$$cycle'] }, { $eq: ['$group', '$$group'] }] },
                  },
                },
              ],
              as: 'cycles',
            },
          },
          { $match: { cycles: { $size: 0 } } },
          { $project: { _id: 1 } },
          { $limit: 1 },
        ],
        { maxTimeMS: 5000 },
      )
      .toArray();
    if (orphan.length) fail('FRESH_CYCLE_ASSOCIATION_INVALID');
  }
  if (await db.collection('groupfinancialcycles').findOne({ group: { $exists: false } }))
    fail('FRESH_CYCLE_ASSOCIATION_INVALID');
  const orphanCycle = await db
    .collection('groupfinancialcycles')
    .aggregate(
      [
        { $lookup: { from: 'groups', localField: 'group', foreignField: '_id', as: 'groups' } },
        { $match: { groups: { $size: 0 } } },
        { $project: { _id: 1 } },
        { $limit: 1 },
      ],
      { maxTimeMS: 5000 },
    )
    .toArray();
  if (orphanCycle.length) fail('FRESH_CYCLE_ASSOCIATION_INVALID');
  const groups = db.collection('groups');
  for await (const group of groups.find(
    {},
    {
      projection: {
        _id: 1,
        currentCycleId: 1,
        currentCycleState: 1,
        cycleEpoch: 1,
        currency: 1,
        financialOperation: 1,
      },
    },
  )) {
    if (group.financialOperation) continue;
    if (!group.currentCycleId) {
      if (
        group.currentCycleState ||
        group.cycleEpoch !== 0 ||
        (await db.collection('groupfinancialcycles').findOne({ group: group._id }))
      )
        fail('FRESH_CYCLE_POINTER_INVALID');
      continue;
    }
    const cycle = await db
      .collection('groupfinancialcycles')
      .findOne({ _id: group.currentCycleId, group: group._id });
    if (
      !cycle ||
      cycle.status !== group.currentCycleState ||
      cycle.currency !== group.currency ||
      cycle.sequence !== group.cycleEpoch
    )
      fail('FRESH_CYCLE_POINTER_INVALID');
  }
}

export async function assertFreshCycleReadiness(db) {
  const rows = await metadata(db);
  if (rows.size !== expectedNames.size) fail('FRESH_SCHEMA_INCOMPLETE');
  const document = await readManifest(db, rows);
  assertManifest(document);
  if (document.state !== 'ready') fail('FRESH_SETUP_INCOMPLETE');
  for (const spec of freshCollections) await assertCollection(db, rows.get(spec.name), spec);
  await inspectFinancialState(db);
  return { profile: FRESH_PROFILE, version: FRESH_PROFILE_VERSION };
}

// Explicit setup only. The caller must validate the disposable target before invoking this.
export async function installFreshCycleSchema(db, { fault = async () => {} } = {}) {
  let rows = await metadata(db);
  if (rows.size === 0) {
    await db.createCollection(FRESH_MANIFEST_COLLECTION, {
      validator: manifestValidator,
      validationLevel: 'strict',
      validationAction: 'error',
    });
    await fault('after_manifest_collection');
    rows = await metadata(db);
  }
  if (!rows.has(FRESH_MANIFEST_COLLECTION)) fail('FRESH_NOT_EMPTY');
  let document = await readManifest(db, rows);
  if (!document) {
    if (rows.size !== 1) fail('FRESH_MANIFEST_MISSING');
    await db.collection(FRESH_MANIFEST_COLLECTION).insertOne(manifest(0));
    await fault('after_manifest_insert');
    document = manifest(0);
  }
  assertManifest(document);
  if (document.state === 'ready') return assertFreshCycleReadiness(db);
  const { checkpoint } = document;
  for (let i = 0; i < freshCollections.length; i++) {
    const spec = freshCollections[i],
      row = rows.get(spec.name);
    if (i < checkpoint) await assertCollection(db, row, spec);
    else if (i === checkpoint && row) await assertCollection(db, row, spec, true);
    else if (row) fail('FRESH_UNEXPECTED_SETUP_STATE');
  }
  for (let i = checkpoint; i < freshCollections.length; i++) {
    const spec = freshCollections[i];
    if (!rows.has(spec.name)) {
      await db.createCollection(spec.name, {
        validator: spec.definition,
        validationLevel: 'strict',
        validationAction: 'error',
      });
      await fault('after_collection', spec.name);
    }
    for (const [key, options] of spec.indexes)
      await db.collection(spec.name).createIndex(key, options);
    await fault('after_indexes', spec.name);
    const current = (await metadata(db)).get(spec.name);
    await assertCollection(db, current, spec);
    const result = await db
      .collection(FRESH_MANIFEST_COLLECTION)
      .updateOne(
        { _id: FRESH_MANIFEST_ID, state: 'initializing', checkpoint: i },
        { $set: { checkpoint: i + 1 } },
      );
    if (result.modifiedCount !== 1) fail('FRESH_SETUP_CONFLICT');
    await fault('after_checkpoint', spec.name);
  }
  const completed = await db
    .collection(FRESH_MANIFEST_COLLECTION)
    .updateOne(
      { _id: FRESH_MANIFEST_ID, state: 'initializing', checkpoint: freshCollections.length },
      { $set: { state: 'ready' } },
    );
  if (completed.modifiedCount !== 1) fail('FRESH_SETUP_CONFLICT');
  await fault('after_ready');
  return assertFreshCycleReadiness(db);
}
