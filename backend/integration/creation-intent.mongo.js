import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { before, beforeEach, after, test } from 'node:test';
import mongoose from 'mongoose';
import { Transaction } from '../src/models/transaction.model.js';
import { RecurringSchedule } from '../src/models/recurring.model.js';
import { createTransactionRepository } from '../src/repositories/transaction.repository.js';
import {
  createRecurringRepository,
  ensureRecurringIndexes,
} from '../src/repositories/recurring.repository.js';
import { createRecurringEngine } from '../src/services/recurring-engine.service.js';
import { createTransactionService } from '../src/services/transaction.service.js';
import { createRecurringService } from '../src/services/recurring.service.js';
import { createDashboardService } from '../src/services/dashboard.service.js';
import { createBudgetSummaryService } from '../src/services/budget-summary.service.js';
import { creationContract } from '../tests/helpers/creation-api.js';
import { apiSetup, ownerA, ownerB, expense } from '../tests/helpers/transaction-api.js';
import { recurringApiSetup, schedule } from '../tests/helpers/recurring-api.js';
import { User } from '../src/models/user.model.js';
import { Budget } from '../src/models/budget.model.js';
import { userRepository } from '../src/repositories/user.repository.js';
import { hashPassword } from '../src/services/password.service.js';
const database = `tallynest_intent_test_${Date.now()}_${randomBytes(6).toString('hex')}`;
const transactions = createTransactionRepository(),
  recurring = createRecurringRepository();
let passwordHash;
before(async () => {
  await mongoose.connect(`mongodb://127.0.0.1:27017/${database}`, {
    serverSelectionTimeoutMS: 10000,
  });
  assert.equal(mongoose.connection.name, database);
  await Promise.all([ensureRecurringIndexes(), User.init(), Budget.init()]);
  passwordHash = await hashPassword('isolated creation intent account');
  console.log(`Disposable database: ${database}`);
});
beforeEach(async () => {
  assert.equal(mongoose.connection.name, database);
  await Promise.all([
    Transaction.deleteMany({}),
    RecurringSchedule.deleteMany({}),
    User.deleteMany({}),
    Budget.deleteMany({}),
  ]);
  await User.create(
    [ownerA, ownerB].map((id, i) => ({
      _id: id,
      name: `Intent ${i}`,
      email: `intent-${i}@example.test`,
      passwordHash,
    })),
  );
});
after(async () => {
  if (mongoose.connection.readyState === 1) {
    assert.equal(mongoose.connection.name, database);
    await mongoose.connection.dropDatabase();
    assert.equal(
      (await mongoose.connection.db.admin().listDatabases({ nameOnly: true })).databases.some(
        (row) => row.name === database,
      ),
      false,
    );
    await mongoose.disconnect();
    console.log(`Dropped disposable database: ${database}`);
  }
});
creationContract(async (t, resource) =>
  resource === 'transaction'
    ? apiSetup(t, transactions, userRepository)
    : recurringApiSetup(t, { repository: recurring, transactions, users: userRepository }),
);
for (const resource of ['transaction', 'schedule']) {
  const repository = resource === 'transaction' ? transactions : recurring;
  const Model = resource === 'transaction' ? Transaction : RecurringSchedule;
  const input = resource === 'transaction' ? expense : schedule;
  const serviceFor = (repo) =>
    resource === 'transaction'
      ? createTransactionService({ repository: repo })
      : createRecurringService({ repository: repo });
  test(`${resource} real unique index serializes concurrent identical and competing payload intents`, async () => {
    const service = serviceFor(repository),
      key = randomUUID();
    const results = await Promise.all(
      Array.from({ length: 12 }, () => service.create(ownerA, input, key)),
    );
    assert.equal(results.filter((row) => !row.replayed).length, 1);
    assert.equal(new Set(results.map((row) => row[resource].id)).size, 1);
    assert.equal(await Model.countDocuments({ owner: ownerA }), 1);
    const otherKey = randomUUID();
    const competing = await Promise.allSettled([
      service.create(ownerA, input, otherKey),
      service.create(ownerA, { ...input, amountMinor: 1 }, otherKey),
    ]);
    assert.equal(competing.filter((row) => row.status === 'fulfilled').length, 1);
    const failure = competing.find((row) => row.status === 'rejected').reason;
    assert.equal(failure.code, 'IDEMPOTENCY_CONFLICT');
    const indexes = await Model.collection.indexes();
    const index = indexes.find((row) => row.key.owner === 1 && row.key.creationKey === 1);
    assert.equal(index.unique, true);
    assert.deepEqual(index.partialFilterExpression, { creationKey: { $type: 'string' } });
    const stored = await Model.findOne({ owner: ownerA }).lean();
    assert.equal(stored.creationKey.length, 64);
    assert.equal(stored.creationHash.length, 64);
    assert.notEqual(stored.creationKey, key);
    const duplicate = { ...stored, _id: new mongoose.Types.ObjectId() };
    await assert.rejects(Model.collection.insertOne(duplicate), (error) => error.code === 11000);
  });
  test(`${resource} committed database write with lost acknowledgement replays without a second insert`, async () => {
    const key = randomUUID();
    const faulty = {
      ...repository,
      async createForOwner(...args) {
        await repository.createForOwner(...args);
        throw new Error('private simulated acknowledgement loss');
      },
    };
    await assert.rejects(serviceFor(faulty).create(ownerA, input, key));
    const result = await serviceFor(repository).create(ownerA, input, key);
    assert.equal(result.replayed, true);
    assert.equal(await Model.countDocuments({ owner: ownerA }), 1);
  });
}
test('deleted manual creation receipts are absent from ledger, dashboard and budget spending', async () => {
  const service = createTransactionService({ repository: transactions }),
    key = randomUUID();
  const { transaction } = await service.create(ownerA, expense, key);
  await service.remove(ownerA, transaction.id);
  const stored = await Transaction.findById(transaction.id);
  assert(stored.deletedAt);
  assert.equal(stored.amountMinor, expense.amountMinor);
  assert.equal((await transactions.findForOwner(ownerA)).length, 0);
  const dashboard = await createDashboardService({
    now: () => new Date('2026-10-16T00:00:00.000Z'),
  }).summary(ownerA, {});
  assert.equal(dashboard.totals.expenseMinor, 0);
  assert.equal(dashboard.totals.transactionCount, 0);
  const summary = await createBudgetSummaryService().summary(ownerA, { month: '2026-10' });
  assert.equal(summary.totals.expenseMinor, 0);
  await assert.rejects(
    service.create(ownerA, expense, key),
    (error) => error.code === 'CREATION_DELETED',
  );
});
test('template creation receipt survives processing/edit/deletion without duplicating or erasing generated history', async () => {
  const service = createRecurringService({ repository: recurring }),
    key = randomUUID();
  const { schedule: row } = await service.create(
    ownerA,
    { ...schedule, endDate: schedule.startDate },
    key,
  );
  const engine = createRecurringEngine({
    repository: recurring,
    transactions,
    now: () => new Date(schedule.startDate),
  });
  await Promise.all([engine.processDueSchedules(), engine.processDueSchedules()]);
  assert.equal(await Transaction.countDocuments({ owner: ownerA }), 1);
  const replay = await service.create(ownerA, { ...schedule, endDate: schedule.startDate }, key);
  assert.equal(replay.schedule.id, row.id);
  assert.equal(replay.schedule.exhausted, true);
  await service.remove(ownerA, row.id);
  assert((await RecurringSchedule.findById(row.id)).deletedAt);
  assert.equal((await recurring.listForOwner(ownerA, { limit: 20 })).length, 0);
  assert.equal((await engine.processDueSchedules()).attempted, 0);
  await assert.rejects(
    service.create(ownerA, { ...schedule, endDate: schedule.startDate }, key),
    (error) => error.code === 'CREATION_DELETED',
  );
  assert.equal(await Transaction.countDocuments({ owner: ownerA }), 1);
});
for (const resource of ['transaction', 'schedule'])
  test(`${resource} separate Node workers share the database-enforced creation receipt`, async () => {
    const { execFile } = await import('node:child_process');
    const { promisify } = await import('node:util');
    const run = promisify(execFile),
      key = randomUUID();
    const script = `
    import mongoose from 'mongoose';
    import { createTransactionService } from './src/services/transaction.service.js';
    import { createRecurringService } from './src/services/recurring.service.js';
    const config = JSON.parse(process.env.TALLYNEST_INTENT_WORKER);
    if (!config.uri.includes('/tallynest_intent_test_')) throw new Error('Not disposable');
    await mongoose.connect(config.uri);
    try {
      const service = config.resource === 'transaction' ? createTransactionService() : createRecurringService();
      const result = await service.create(config.owner, config.input, config.key);
      console.log(JSON.stringify({ id: result[config.resource].id, replayed: result.replayed }));
    } finally { await mongoose.disconnect(); }
  `;
    const env = {
      ...process.env,
      TALLYNEST_INTENT_WORKER: JSON.stringify({
        uri: `mongodb://127.0.0.1:27017/${database}`,
        resource,
        owner: ownerA,
        input: resource === 'transaction' ? expense : schedule,
        key,
      }),
    };
    const outputs = await Promise.all(
      Array.from({ length: 3 }, () =>
        run(process.execPath, ['--input-type=module', '-e', script], { env, timeout: 15000 }),
      ),
    );
    const results = outputs.map((row) => JSON.parse(row.stdout));
    assert.equal(new Set(results.map((row) => row.id)).size, 1);
    assert.equal(results.filter((row) => !row.replayed).length, 1);
    assert.equal(
      await (resource === 'transaction' ? Transaction : RecurringSchedule).countDocuments({
        owner: ownerA,
      }),
      1,
    );
  });
