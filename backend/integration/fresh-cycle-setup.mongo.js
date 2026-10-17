import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { after, test } from 'node:test';
import { promisify } from 'node:util';
import { once } from 'node:events';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import { createApp } from '../app.js';
import {
  installFreshCycleSchema,
  assertFreshCycleReadiness,
} from '../src/config/fresh-cycle-setup.js';
import { FRESH_MANIFEST_COLLECTION, freshCollections } from '../src/config/fresh-cycle-schema.js';
import { createGroupRepository } from '../src/repositories/group.repository.js';
import { createGroupService } from '../src/services/group.service.js';
import { createCycleLifecycleService } from '../src/services/cycle-lifecycle.service.js';
import { createGroupExpenseService } from '../src/services/group-expense.service.js';
import { createTransactionService } from '../src/services/transaction.service.js';
import { createBudgetService } from '../src/services/budget.service.js';
import { createRecurringService } from '../src/services/recurring.service.js';
import { Group } from '../src/models/group.model.js';
import { GroupFinancialCycle } from '../src/models/group-financial-cycle.model.js';
import { User } from '../src/models/user.model.js';
import { hashPassword } from '../src/services/password.service.js';
import { secret, origin } from '../tests/helpers/transaction-api.js';

const base = 'mongodb://127.0.0.1:27017';
const run = promisify(execFile);
const databases = new Set();
function name() {
  const database = `tallynest_fresh_v2_test_${Date.now()}_${randomBytes(6).toString('hex')}`;
  databases.add(database);
  return database;
}
async function client(database) {
  const connection = new mongoose.mongo.MongoClient(`${base}/${database}`, {
    serverSelectionTimeoutMS: 10000,
  });
  await connection.connect();
  return connection;
}
async function rejectsUnchanged(db, code, operation) {
  const before = await db.listCollections().toArray();
  const collections = await Promise.all(
    before.map(async (row) => ({
      name: row.name,
      documents: await db.collection(row.name).find({}).sort({ _id: 1 }).toArray(),
      indexes: await db.collection(row.name).indexes(),
      options: row.options,
    })),
  );
  await assert.rejects(operation, (error) =>
    typeof code === 'string' ? error.message === code : code.test(error.message),
  );
  const afterRows = await db.listCollections().toArray();
  assert.deepEqual(afterRows, before);
  assert.deepEqual(
    await Promise.all(
      afterRows.map(async (row) => ({
        name: row.name,
        documents: await db.collection(row.name).find({}).sort({ _id: 1 }).toArray(),
        indexes: await db.collection(row.name).indexes(),
        options: row.options,
      })),
    ),
    collections,
  );
}
after(async () => {
  if (mongoose.connection.readyState) await mongoose.disconnect();
  const admin = new mongoose.mongo.MongoClient(base, { serverSelectionTimeoutMS: 10000 });
  await admin.connect();
  try {
    for (const database of databases) {
      assert.match(database, /^tallynest_fresh_v2_test_\d{13}_[a-f0-9]{12}$/);
      await admin.db(database).dropDatabase();
    }
    const existing = await admin.db('admin').admin().listDatabases({ nameOnly: true });
    assert.ok(
      [...databases].every((database) => !existing.databases.some((row) => row.name === database)),
    );
  } finally {
    await admin.close();
  }
});

test('fresh setup installs exact profile and resumes only known partial checkpoints', async () => {
  for (const stop of [
    'after_manifest_collection',
    'after_manifest_insert',
    'after_collection',
    'after_indexes',
    'after_checkpoint',
    'after_ready',
  ]) {
    const connection = await client(name());
    try {
      let stopped = false;
      await assert.rejects(
        installFreshCycleSchema(connection.db(), {
          fault: async (point) => {
            if (!stopped && point === stop) {
              stopped = true;
              throw new Error('TEST_STOP');
            }
          },
        }),
        /TEST_STOP/,
      );
      assert.ok(stopped);
      assert.deepEqual(await installFreshCycleSchema(connection.db()), {
        profile: 'fresh-cycle-v2',
        version: 1,
      });
      assert.deepEqual(await installFreshCycleSchema(connection.db()), {
        profile: 'fresh-cycle-v2',
        version: 1,
      });
    } finally {
      await connection.close();
    }
  }
});

test('disposable setup CLI accepts only its local namespace and leaves a ready schema', async () => {
  const database = name();
  const bad = await run(
    process.execPath,
    ['scripts/setup-fresh-cycle-schema.js', '--database', 'tallynest'],
    { cwd: process.cwd() },
  ).catch((error) => error);
  assert.notEqual(bad.code, 0);
  const result = await run(
    process.execPath,
    ['scripts/setup-fresh-cycle-schema.js', '--database', database],
    { cwd: process.cwd() },
  );
  assert.equal(JSON.parse(result.stdout).database, database);
  const connection = await client(database);
  try {
    await assertFreshCycleReadiness(connection.db());
  } finally {
    await connection.close();
  }
});

test('normal server refuses an uninitialized database before listening or creating collections', async () => {
  const database = name();
  const result = await run(process.execPath, ['server.js'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      NODE_ENV: 'test',
      MONGO_URI: `${base}/${database}`,
      JWT_SECRET: secret,
      CLIENT_ORIGIN: origin,
      PORT: '49999',
    },
  }).catch((error) => error);
  assert.equal(result.code, 1);
  const connection = await client(database);
  try {
    assert.deepEqual(await connection.db().listCollections().toArray(), []);
  } finally {
    await connection.close();
  }
});

test('fresh setup rejects unknown, existing, held and altered checkpoint state without writes', async () => {
  for (const fixture of [
    async (db) => db.createCollection('unrelated'),
    async (db) => {
      await db.createCollection('groups');
      await db.collection('groups').insertOne({ legacy: true });
    },
    async (db) => db.collection('cyclemigrationruns').insertOne({ offlineHeld: true }),
  ]) {
    const connection = await client(name());
    try {
      await fixture(connection.db());
      await rejectsUnchanged(connection.db(), /FRESH_/, () =>
        installFreshCycleSchema(connection.db()),
      );
    } finally {
      await connection.close();
    }
  }
  const connection = await client(name());
  try {
    await assert.rejects(
      installFreshCycleSchema(connection.db(), {
        fault: async (point) => {
          if (point === 'after_manifest_insert') throw new Error('TEST_STOP');
        },
      }),
      /TEST_STOP/,
    );
    await connection
      .db()
      .collection(FRESH_MANIFEST_COLLECTION)
      .updateOne({}, { $set: { checkpoint: 1 } });
    await rejectsUnchanged(connection.db(), 'FRESH_VALIDATOR_MISMATCH', () =>
      installFreshCycleSchema(connection.db()),
    );
  } finally {
    await connection.close();
  }
});

test('readiness rejects exact validator, unique index, partial index and journal drift', async () => {
  for (const drift of ['validator', 'unique', 'partial', 'journal', 'version']) {
    const connection = await client(name());
    const db = connection.db();
    try {
      await installFreshCycleSchema(db);
      if (drift === 'validator')
        await db.command({
          collMod: 'groupexpenses',
          validator: { $jsonSchema: { bsonType: 'object' } },
        });
      if (drift === 'unique')
        await db.collection('groupexpenses').dropIndex('group_1_creator_1_creationKey_1');
      if (drift === 'partial') {
        await db.collection('groupfinancialcycles').dropIndex('group_1');
        await db
          .collection('groupfinancialcycles')
          .createIndex({ group: 1 }, { unique: true, partialFilterExpression: { status: 'open' } });
      }
      if (drift === 'journal')
        await db.collection('groupcycletransitions').dropIndex('group_1_intentKey_1');
      if (drift === 'version')
        await db
          .collection(FRESH_MANIFEST_COLLECTION)
          .updateOne({}, { $set: { version: 2 } }, { bypassDocumentValidation: true });
      await rejectsUnchanged(db, /FRESH_/, () => assertFreshCycleReadiness(db));
    } finally {
      await connection.close();
    }
  }
});

test('normal fresh-v2 group insert is atomic and explicit first-cycle open retains UUID receipts', async () => {
  const database = name(),
    connection = await client(database);
  try {
    await installFreshCycleSchema(connection.db());
    await mongoose.connect(`${base}/${database}`, { autoCreate: false, autoIndex: false });
    const user = await User.create({
      name: 'Fresh owner',
      email: 'fresh@test.invalid',
      passwordHash: await hashPassword('disposable fresh password'),
    });
    const owner = String(user._id);
    const service = createGroupService({ repository: createGroupRepository(), freshV2: true });
    await assert.rejects(
      service.create(owner, { name: 'Unsafe', financialProtocolVersion: 1 }),
      (error) => error.status === 400,
    );
    const publicGroup = await service.create(owner, { name: 'Fresh cycle group' });
    const group = await Group.findById(publicGroup.id);
    assert.equal(group.financialProtocolVersion, 2);
    assert.equal(group.cycleEpoch, 0);
    assert.equal(group.currentCycleId, undefined);
    assert.deepEqual(
      group.members.map((row) => [String(row.user), row.role]),
      [[owner, 'owner']],
    );
    await assertFreshCycleReadiness(connection.db());
    const lifecycle = createCycleLifecycleService({ internalEnabled: true });
    const input = { intent: randomUUID(), groupVersion: group.__v };
    const first = await lifecycle.openFirst(owner, publicGroup.id, input);
    assert.equal(first.replayed, false);
    const replay = await lifecycle.openFirst(owner, publicGroup.id, input);
    assert.equal(replay.replayed, true);
    assert.equal(await GroupFinancialCycle.countDocuments({ group: group._id }), 1);
    await assert.rejects(
      lifecycle.openFirst(owner, publicGroup.id, { intent: randomUUID(), groupVersion: group.__v }),
      (error) => error.code === 'VERSION_MISMATCH',
    );
    await assertFreshCycleReadiness(connection.db());
    const legacy = createGroupExpenseService();
    await assert.rejects(
      legacy.list(owner, publicGroup.id, {}),
      (error) => error.code === 'CYCLE_PROTOCOL_INACTIVE',
    );
  } finally {
    await mongoose.disconnect();
    await connection.close();
  }
});

test('fresh validators admit real personal transaction, budget and recurring service writes', async () => {
  const database = name(),
    connection = await client(database);
  try {
    await installFreshCycleSchema(connection.db());
    await mongoose.connect(`${base}/${database}`, { autoCreate: false, autoIndex: false });
    const user = await User.create({
      name: 'Personal owner',
      email: 'personal@test.invalid',
      passwordHash: await hashPassword('disposable fresh password'),
    });
    const owner = String(user._id);
    const transaction = await createTransactionService().create(
      owner,
      {
        type: 'expense',
        title: 'Fresh purchase',
        amountMinor: 125,
        currency: 'INR',
        category: 'food_dining',
        transactionDate: '2026-10-17T00:00:00.000Z',
      },
      randomUUID(),
    );
    assert.equal(transaction.transaction.amountMinor, 125);
    const budget = await createBudgetService().create(owner, {
      category: 'food_dining',
      currency: 'INR',
      amountMinor: 5000,
      month: '2026-10',
    });
    assert.equal(budget.amountMinor, 5000);
    const schedule = await createRecurringService().create(
      owner,
      {
        type: 'expense',
        title: 'Fresh schedule',
        amountMinor: 100,
        currency: 'INR',
        category: 'food_dining',
        frequency: 'monthly',
        startDate: '2026-10-17T00:00:00.000Z',
      },
      randomUUID(),
    );
    assert.equal(schedule.schedule.amountMinor, 100);
    await assertFreshCycleReadiness(connection.db());
  } finally {
    await mongoose.disconnect();
    await connection.close();
  }
});

test('normal authenticated routes create v2 groups but expose no cycle route or legacy financial fallback', async () => {
  const database = name(),
    connection = await client(database);
  let server;
  try {
    await installFreshCycleSchema(connection.db());
    await mongoose.connect(`${base}/${database}`, { autoCreate: false, autoIndex: false });
    const user = await User.create({
      name: 'HTTP owner',
      email: 'http@test.invalid',
      passwordHash: await hashPassword('disposable fresh password'),
    });
    const app = createApp(
      { nodeEnv: 'test', clientOrigin: origin, jwtSecret: secret },
      { freshV2Groups: true },
    );
    server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const token = jwt.sign({}, secret, {
      algorithm: 'HS256',
      subject: String(user._id),
      issuer: 'smart-finance-manager',
      audience: 'smart-finance-manager-web',
      expiresIn: 900,
    });
    async function request(path, method = 'GET', body) {
      const response = await fetch(`http://127.0.0.1:${server.address().port}/api/groups${path}`, {
        method,
        headers: {
          Origin: origin,
          'X-CSRF-Protection': '1',
          Cookie: `sfm_access=${token}`,
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      return { status: response.status, data: await response.json() };
    }
    assert.equal(
      (await request('', 'POST', { name: 'Injection', financialProtocolVersion: 1 })).status,
      400,
    );
    assert.equal((await request('', 'POST', { name: 'Injection', cycleEpoch: 99 })).status, 400);
    const created = await request('', 'POST', { name: 'HTTP fresh group' });
    assert.equal(created.status, 201);
    const id = created.data.data.group.id;
    assert.equal((await Group.findById(id)).financialProtocolVersion, 2);
    assert.equal((await request(`/${id}/cycles`)).status, 404);
    const legacy = await request(`/${id}/balances`);
    assert.equal(legacy.status, 409);
    assert.equal(legacy.data.code, 'CYCLE_PROTOCOL_INACTIVE');
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    await mongoose.disconnect();
    await connection.close();
  }
});

test('an unresolved group operation does not disable read-only startup or permit legacy financial writes', async () => {
  const database = name(),
    connection = await client(database);
  try {
    await installFreshCycleSchema(connection.db());
    await mongoose.connect(`${base}/${database}`, { autoCreate: false, autoIndex: false });
    const user = await User.create({
      name: 'Recovery owner',
      email: 'recovery@test.invalid',
      passwordHash: await hashPassword('disposable fresh password'),
    });
    const owner = String(user._id);
    const group = await createGroupRepository().createForOwnerV2(owner, { name: 'Recovery group' });
    let stop = true;
    const lifecycle = createCycleLifecycleService({
      internalEnabled: true,
      fault: async (point) => {
        if (stop && point === 'after_reserve') {
          stop = false;
          throw new Error('TEST_STOP');
        }
      },
    });
    await assert.rejects(
      lifecycle.openFirst(owner, String(group._id), { intent: randomUUID(), groupVersion: 0 }),
      /TEST_STOP/,
    );
    await assertFreshCycleReadiness(connection.db());
    await assert.rejects(
      createGroupExpenseService().list(owner, String(group._id), {}),
      (error) => error.code === 'CYCLE_PROTOCOL_INACTIVE',
    );
    await lifecycle.recover(owner, String(group._id));
    await assertFreshCycleReadiness(connection.db());
  } finally {
    await mongoose.disconnect();
    await connection.close();
  }
});

test(
  'auth-enabled MongoDB separates setup and runtime schema privileges while retaining fixed-intent recovery',
  { timeout: 90000 },
  async () => {
    const database = name();
    const container = `tallynest-fresh-auth-${randomBytes(6).toString('hex')}`;
    const rootPassword = randomBytes(20).toString('hex');
    const setupPassword = randomBytes(20).toString('hex');
    const runtimePassword = randomBytes(20).toString('hex');
    let root;
    await run('docker', [
      'run',
      '--rm',
      '-d',
      '--name',
      container,
      '-p',
      '127.0.0.1::27018',
      'mongo:8.0',
      '--auth',
      '--bind_ip_all',
      '--port',
      '27018',
    ]);
    try {
      let port;
      for (let attempt = 0; attempt < 30; attempt++) {
        try {
          const result = await run('docker', ['port', container, '27018/tcp']);
          port = Number(result.stdout.trim().split(':').at(-1));
          await run('docker', [
            'exec',
            container,
            'mongosh',
            '--port',
            '27018',
            '--quiet',
            '--eval',
            'db.adminCommand({ping:1})',
          ]);
          break;
        } catch {
          await new Promise((resolve) => setTimeout(resolve, 500));
        }
      }
      assert.ok(Number.isInteger(port));
      await run('docker', [
        'exec',
        container,
        'mongosh',
        '--port',
        '27018',
        '--quiet',
        '--eval',
        `db.getSiblingDB('admin').createUser({user:'testadmin',pwd:'${rootPassword}',roles:['root']})`,
      ]);
      root = new mongoose.mongo.MongoClient(
        `mongodb://testadmin:${rootPassword}@127.0.0.1:${port}/admin?authSource=admin`,
      );
      await root.connect();
      const db = root.db(database);
      await db.command({
        createRole: 'runtime',
        privileges: [
          {
            resource: { db: database, collection: '' },
            actions: ['find', 'listCollections', 'listIndexes'],
          },
          ...freshCollections.map(({ name: collection }) => ({
            resource: { db: database, collection },
            actions: ['insert', 'update', 'remove'],
          })),
        ],
        roles: [],
      });
      await db.command({
        createRole: 'blind',
        privileges: [
          {
            resource: { db: database, collection: '' },
            actions: ['find'],
          },
        ],
        roles: [],
      });
      await db.command({
        createUser: 'setup',
        pwd: setupPassword,
        roles: [{ role: 'dbOwner', db: database }],
      });
      await db.command({
        createUser: 'runtime',
        pwd: runtimePassword,
        roles: [{ role: 'runtime', db: database }],
      });
      await db.command({
        createUser: 'blind',
        pwd: runtimePassword,
        roles: [{ role: 'blind', db: database }],
      });
      const uri = (user, pass) =>
        `mongodb://${user}:${pass}@127.0.0.1:${port}/${database}?authSource=${database}`;
      const setup = new mongoose.mongo.MongoClient(uri('setup', setupPassword));
      await setup.connect();
      try {
        await installFreshCycleSchema(setup.db());
      } finally {
        await setup.close();
      }
      const limited = new mongoose.mongo.MongoClient(uri('runtime', runtimePassword));
      await limited.connect();
      try {
        await assertFreshCycleReadiness(limited.db());
        await assert.rejects(
          limited.db().createCollection('forbidden'),
          (error) => error.code === 13,
        );
        await assert.rejects(
          limited.db().collection('groups').createIndex({ forbidden: 1 }),
          (error) => error.code === 13,
        );
        await assert.rejects(
          limited.db().command({ collMod: 'groups', validationAction: 'warn' }),
          (error) => error.code === 13,
        );
      } finally {
        await limited.close();
      }
      const blind = new mongoose.mongo.MongoClient(uri('blind', runtimePassword));
      await blind.connect();
      try {
        await assert.rejects(assertFreshCycleReadiness(blind.db()), (error) => error.code === 13);
      } finally {
        await blind.close();
      }
      await mongoose.connect(uri('runtime', runtimePassword), {
        autoCreate: false,
        autoIndex: false,
      });
      try {
        const user = await User.create({
          name: 'Limited owner',
          email: 'limited@test.invalid',
          passwordHash: await hashPassword('disposable fresh password'),
        });
        const owner = String(user._id);
        const group = await createGroupRepository().createForOwnerV2(owner, {
          name: 'Limited recovery',
        });
        let stopped = false;
        const lifecycle = createCycleLifecycleService({
          internalEnabled: true,
          fault: async (point) => {
            if (!stopped && point === 'after_reserve') {
              stopped = true;
              throw new Error('TEST_STOP');
            }
          },
        });
        await assert.rejects(
          lifecycle.openFirst(owner, String(group._id), { intent: randomUUID(), groupVersion: 0 }),
          /TEST_STOP/,
        );
        await assertFreshCycleReadiness(mongoose.connection.db);
        await lifecycle.recover(owner, String(group._id));
        assert.equal(await GroupFinancialCycle.countDocuments({ group: group._id }), 1);
      } finally {
        await mongoose.disconnect();
      }
    } finally {
      await root?.close();
      await run('docker', ['rm', '-f', container]);
    }
  },
);
