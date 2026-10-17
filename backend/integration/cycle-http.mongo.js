import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { before, after, beforeEach, test } from 'node:test';
import mongoose from 'mongoose';
import { Group } from '../src/models/group.model.js';
import { GroupFinancialCycle } from '../src/models/group-financial-cycle.model.js';
import { GroupExpense } from '../src/models/group-expense.model.js';
import { GroupSettlement } from '../src/models/group-settlement.model.js';
import { GroupCycleTransition } from '../src/models/group-cycle-transition.model.js';
import { User } from '../src/models/user.model.js';
import {
  createGroupRepository,
  groupRepository,
  ensureGroupIndexes,
} from '../src/repositories/group.repository.js';
import {
  createGroupFinancialCycleRepository,
  groupFinancialCycleRepository,
  ensureGroupFinancialCycleIndexes,
} from '../src/repositories/group-financial-cycle.repository.js';
import {
  createGroupExpenseRepository,
  groupExpenseRepository,
  ensureGroupExpenseIndexes,
} from '../src/repositories/group-expense.repository.js';
import {
  createSettlementRepository,
  settlementRepository,
  ensureSettlementIndexes,
} from '../src/repositories/settlement.repository.js';
import {
  createCycleTransitionRepository,
  cycleTransitionRepository,
  ensureCycleTransitionIndexes,
} from '../src/repositories/group-cycle-transition.repository.js';
import {
  createGroupBalanceRepository,
  groupBalanceRepository,
} from '../src/repositories/group-balance.repository.js';
import {
  createMembershipRepository,
  membershipRepository,
} from '../src/repositories/membership.repository.js';
import { userRepository } from '../src/repositories/user.repository.js';
import { hashPassword } from '../src/services/password.service.js';
import { createDisposableCycleApp } from './helpers/staged-cycle-app.js';
import { assertCycleHttpReadiness } from '../src/staged/readiness.js';
import { createApp } from '../app.js';
import { ownerA, ownerB, origin, secret } from '../tests/helpers/transaction-api.js';
import { ownerC } from '../tests/helpers/invitation-api.js';

const database = `tallynest_cycle_http_test_${Date.now()}_${randomBytes(6).toString('hex')}`;
const models = {
  cycles: GroupFinancialCycle,
  expenses: GroupExpense,
  settlements: GroupSettlement,
};
const repositories = {
  groups: groupRepository,
  cycles: groupFinancialCycleRepository,
  expenses: groupExpenseRepository,
  settlements: settlementRepository,
  receipts: cycleTransitionRepository,
  profiles: membershipRepository,
  balances: groupBalanceRepository,
  users: userRepository,
};
const config = { nodeEnv: 'test', clientOrigin: origin, jwtSecret: secret };
let passwordHash, groupId, cookies;
const tag = (row) => `"tn-${row._id}-v${row.__v}"`;
before(async () => {
  console.log(`Disposable staged HTTP database: ${database}`);
  await mongoose.connect(`mongodb://127.0.0.1:27017/${database}`, {
    serverSelectionTimeoutMS: 10000,
  });
  for (const install of [
    ensureGroupIndexes,
    ensureGroupFinancialCycleIndexes,
    ensureGroupExpenseIndexes,
    ensureSettlementIndexes,
    ensureCycleTransitionIndexes,
  ])
    await install();
  await User.init();
  passwordHash = await hashPassword('Disposable test password 123!');
});
beforeEach(async () => {
  for (const model of [
    Group,
    GroupFinancialCycle,
    GroupExpense,
    GroupSettlement,
    GroupCycleTransition,
    User,
  ])
    await model.deleteMany({});
  await mongoose.connection.db.collection('cyclemigrationruns').deleteMany({});
  await User.create(
    [ownerA, ownerB, ownerC].map((id, i) => ({
      _id: id,
      name: `Test member ${i}`,
      email: `${i}@test.invalid`,
      passwordHash,
    })),
  );
  const group = await groupRepository.createForOwner(ownerA, {
    name: 'HTTP cycle test',
  });
  group.members.push({ user: ownerB, role: 'member', createdAt: new Date() });
  await group.save();
  await Group.collection.updateOne({ _id: group._id }, { $set: { financialProtocolVersion: 2 } });
  groupId = String(group._id);
});
after(async () => {
  assert.equal(mongoose.connection.name, database);
  await mongoose.connection.dropDatabase();
  assert.equal(
    (await mongoose.connection.db.admin().listDatabases({ nameOnly: true })).databases.some(
      (d) => d.name === database,
    ),
    false,
  );
  await mongoose.disconnect();
  console.log(`Verified cleanup: ${database}`);
});
async function setup(t, fault, normal = false, independent = false) {
  let connection = mongoose.connection,
    workerRepositories = repositories,
    workerModels = models;
  if (independent) {
    connection = await mongoose
      .createConnection(`mongodb://127.0.0.1:27017/${database}`)
      .asPromise();
    t.after(() => connection.close());
    const [G, C, E, S, T, U] = [
      Group,
      GroupFinancialCycle,
      GroupExpense,
      GroupSettlement,
      GroupCycleTransition,
      User,
    ].map((m) => connection.model(m.modelName, m.schema));
    workerRepositories = {
      groups: createGroupRepository(G),
      cycles: createGroupFinancialCycleRepository(C),
      expenses: createGroupExpenseRepository(E),
      settlements: createSettlementRepository(S),
      receipts: createCycleTransitionRepository(T),
      profiles: createMembershipRepository(G, U),
      balances: createGroupBalanceRepository(E, S),
      users: {
        ...userRepository,
        findById: (id) => U.findById(id),
        findByEmailWithPassword: (email) => U.findOne({ email }).select('+passwordHash'),
      },
    };
    workerModels = { cycles: C, expenses: E, settlements: S };
  }
  const app = normal
    ? createApp(config)
    : await createDisposableCycleApp({
        connection,
        config,
        models: workerModels,
        repositories: workerRepositories,
        fault,
      });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}/api`;
  cookies = {};
  for (const [i, user] of [ownerA, ownerB, ownerC].entries()) {
    const response = await fetch(url + '/auth/login', {
      method: 'POST',
      headers: {
        Origin: origin,
        'X-CSRF-Protection': '1',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email: `${i}@test.invalid`,
        password: 'Disposable test password 123!',
      }),
    });
    assert.equal(response.status, 200);
    cookies[user] = response.headers.get('set-cookie').split(';')[0];
  }
  return async (path, { method = 'GET', body, user = ownerA, headers = {} } = {}) => {
    const response = await fetch(url + path, {
      method,
      headers: {
        Origin: origin,
        'X-CSRF-Protection': '1',
        ...(user ? { Cookie: cookies[user] } : {}),
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...headers,
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    return {
      status: response.status,
      body: await response.json(),
      etag: response.headers.get('etag'),
      headers: response.headers,
    };
  };
}
const path = (suffix = '') => `/groups/${groupId}${suffix}`;
async function state() {
  const group = await Group.findById(groupId);
  const cycle = group.currentCycleId
    ? await GroupFinancialCycle.findById(group.currentCycleId)
    : null;
  return { group, cycle };
}
async function open(request) {
  const { group, cycle } = await state();
  const result = await request(path('/cycles'), {
    method: 'POST',
    body: cycle ? { previousCycleId: String(cycle._id), epoch: group.cycleEpoch } : {},
    headers: {
      'If-Match': tag(group),
      'Idempotency-Key': randomUUID(),
      ...(cycle ? { 'If-Cycle-Match': tag(cycle) } : {}),
    },
  });
  assert.equal(result.status, 201, JSON.stringify(result.body));
  return result;
}
async function transition(request, action, extra = {}) {
  const { group, cycle } = await state();
  return request(path(`/cycles/${cycle._id}/${action}`), {
    method: 'POST',
    body: { epoch: group.cycleEpoch },
    headers: {
      'If-Match': tag(cycle),
      'If-Group-Match': tag(group),
      'Idempotency-Key': randomUUID(),
    },
    ...extra,
  });
}
const expense = () => ({
  payer: ownerA,
  title: 'Exact dinner',
  amountMinor: 10001,
  currency: 'INR',
  category: 'food_dining',
  expenseDate: '2026-10-17T00:00:00.000Z',
  split: { method: 'equal', participants: [ownerA, ownerB] },
});
async function add(request, data = expense(), key = randomUUID()) {
  const { cycle } = await state();
  return request(path('/expenses'), {
    method: 'POST',
    body: { ...data, cycleId: String(cycle._id) },
    headers: { 'Idempotency-Key': key },
  });
}
async function settle(request) {
  const { cycle } = await state();
  const proposed = await request(path('/settlements'), {
    method: 'POST',
    user: ownerB,
    body: {
      cycleId: String(cycle._id),
      recipient: ownerA,
      amountMinor: 5000,
      currency: 'INR',
    },
    headers: { 'Idempotency-Key': randomUUID() },
  });
  assert.equal(proposed.status, 201, JSON.stringify(proposed.body));
  return proposed;
}

test('ordinary app has no cycle routes and no browser-controlled activation', async (t) => {
  const request = await setup(t, undefined, true);
  const result = await request(path('/cycles'), {
    headers: { 'X-Cycle-Protocol': '2' },
  });
  assert.equal(result.status, 404);
  const created = await request(path('/expenses'), {
    method: 'POST',
    body: { ...expense(), cycleId: String(new mongoose.Types.ObjectId()) },
    headers: { 'Idempotency-Key': randomUUID() },
  });
  assert.equal(created.body.code, 'CYCLE_PROTOCOL_INACTIVE');
});
test('cycle list/detail, owner-only opening, safe DTO and authoritative group precondition', async (t) => {
  const request = await setup(t);
  assert.equal((await request(path('/cycles'))).body.data.cycles.length, 0);
  assert.equal(
    (
      await request(path('/cycles'), {
        method: 'POST',
        body: {},
        headers: { 'Idempotency-Key': randomUUID() },
      })
    ).status,
    428,
  );
  const { group } = await state();
  assert.equal(
    (
      await request(path('/cycles'), {
        method: 'POST',
        user: ownerB,
        body: {},
        headers: { 'If-Match': tag(group), 'Idempotency-Key': randomUUID() },
      })
    ).status,
    403,
  );
  const opened = await open(request);
  assert.equal(opened.body.apiVersion, 2);
  assert.equal(opened.headers.get('cache-control'), 'no-store');
  const data = opened.body.data;
  assert.deepEqual(data.cycle.memberIds, [ownerA, ownerB]);
  assert.equal((await request(path(`/cycles/${data.cycle.id}`), { user: ownerB })).status, 200);
  assert.equal((await request(path(`/cycles/${data.cycle.id}`), { user: ownerC })).status, 404);
  assert.equal(JSON.stringify(data).includes('payloadHash'), false);
  assert.equal(JSON.stringify(data).includes('migrationRunId'), false);
});
test('authentication, CSRF, origin, query operators, protected input and foreign cycle are rejected', async (t) => {
  const request = await setup(t);
  assert.equal((await request(path('/cycles'), { user: null })).status, 401);
  for (const headers of [{ 'X-CSRF-Protection': '' }, { Origin: 'https://evil.invalid' }])
    assert.equal(
      (await request(path('/cycles'), { method: 'POST', body: {}, headers })).status,
      403,
    );
  assert.equal((await request(path('/cycles?limit=101'))).status, 400);
  assert.equal((await request(path('/cycles?limit[$gt]=1'))).status, 400);
  assert.equal((await request(path(`/cycles/${new mongoose.Types.ObjectId()}`))).status, 404);
  const { group } = await state();
  for (const key of [undefined, 'invalid']) {
    assert.equal(
      (
        await request(path('/cycles'), {
          method: 'POST',
          body: {},
          headers: {
            'If-Match': tag(group),
            ...(key ? { 'Idempotency-Key': key } : {}),
          },
        })
      ).status,
      400,
    );
  }
  assert.equal(
    (
      await request(path('/cycles'), {
        method: 'POST',
        body: { owner: ownerB },
        headers: { 'If-Match': tag(group), 'Idempotency-Key': randomUUID() },
      })
    ).status,
    400,
  );
});
test('lifecycle identical replay preserves original input; changed key payload conflicts, stale and cross-resource tags fail', async (t) => {
  const request = await setup(t);
  await open(request);
  const { group, cycle } = await state();
  const options = {
    method: 'POST',
    body: { epoch: group.cycleEpoch },
    headers: {
      'If-Match': tag(cycle),
      'If-Group-Match': tag(group),
      'Idempotency-Key': randomUUID(),
    },
  };
  const first = await request(path(`/cycles/${cycle._id}/freeze`), options);
  assert.equal(first.status, 200);
  const replay = await request(path(`/cycles/${cycle._id}/freeze`), options);
  assert.equal(replay.status, 200);
  assert.equal(replay.body.data.replayed, true);
  assert.equal(
    (
      await request(path(`/cycles/${cycle._id}/freeze`), {
        ...options,
        body: { epoch: 2 },
      })
    ).body.code,
    'IDEMPOTENCY_CONFLICT',
  );
  assert.equal(
    (
      await request(path(`/cycles/${cycle._id}/close`), {
        ...options,
        headers: { ...options.headers, 'Idempotency-Key': randomUUID() },
      })
    ).status,
    412,
  );
  assert.equal(
    (
      await request(path(`/cycles/${cycle._id}/close`), {
        ...options,
        headers: { ...options.headers, 'If-Match': tag(group) },
      })
    ).status,
    400,
  );
});
test('cycle expense CRUD uses exact shares, ETags, owner/creator policy and durable tombstone replay', async (t) => {
  const request = await setup(t);
  await open(request);
  const key = randomUUID(),
    created = await add(request, expense(), key);
  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.deepEqual(
    created.body.data.expense.shares.map((r) => r.amountMinor),
    [5001, 5000],
  );
  const target = created.body.data.expense.id;
  assert.equal((await add(request, expense(), key)).status, 200);
  assert.equal(
    (await add(request, { ...expense(), amountMinor: 2 }, key)).body.code,
    'IDEMPOTENCY_CONFLICT',
  );
  const detail = await request(path(`/expenses/${target}`));
  const changed = await request(path(`/expenses/${target}`), {
    method: 'PATCH',
    body: { title: 'Updated' },
    headers: { 'If-Match': detail.etag },
  });
  assert.equal(changed.status, 200, JSON.stringify(changed.body));
  assert.equal(
    (
      await request(path(`/expenses/${target}`), {
        method: 'PATCH',
        body: { title: 'Stale' },
        headers: { 'If-Match': detail.etag },
      })
    ).status,
    412,
  );
  assert.equal(
    (
      await request(path(`/expenses/${target}`), {
        method: 'DELETE',
        user: ownerB,
        headers: { 'If-Match': changed.etag },
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await request(path(`/expenses/${target}`), {
        method: 'DELETE',
        headers: { 'If-Match': changed.etag },
      })
    ).status,
    200,
  );
  assert.equal((await add(request, expense(), key)).body.code, 'EXPENSE_DELETED');
  assert.equal((await request(path(`/expenses/${target}`))).status, 404);
  assert.equal((await request(path('/expenses'))).body.data.expenses.length, 0);
});
test('explicit cycle selection, invalid amounts, participant snapshot and group isolation', async (t) => {
  const request = await setup(t);
  await open(request);
  const { cycle } = await state();
  assert.equal(
    (
      await request(path('/expenses'), {
        method: 'POST',
        body: expense(),
        headers: { 'Idempotency-Key': randomUUID() },
      })
    ).body.code,
    'CYCLE_SELECTION_REQUIRED',
  );
  for (const amountMinor of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])
    assert.equal((await add(request, { ...expense(), amountMinor })).status, 400);
  assert.equal(
    (
      await add(request, {
        ...expense(),
        split: { method: 'equal', participants: [ownerC] },
      })
    ).status,
    409,
  );
  const second = await groupRepository.createForOwner(ownerA, {
    name: 'Other group',
  });
  assert.equal((await request(`/groups/${second._id}/cycles/${cycle._id}`)).status, 409);
  const original = await add(request);
  assert.equal(
    (
      await request(path(`/expenses/${original.body.data.expense.id}`), {
        user: ownerC,
      })
    ).status,
    404,
  );
});
test('settlement capacity, recipient-only decision, pending close block, exact historical balances and two cycles', async (t) => {
  const request = await setup(t);
  await open(request);
  const data = expense(),
    key = randomUUID();
  const created = await add(request, data, key);
  assert.equal(created.status, 201);
  const oldCycle = created.body.data.expense.cycleId;
  const proposal = await settle(request);
  const pendingHistory = await request(path(`/settlements?cycleId=${oldCycle}`));
  assert.equal(pendingHistory.status, 200, JSON.stringify(pendingHistory.body));
  assert.equal(pendingHistory.body.data.settlements[0].id, proposal.body.data.settlement.id);
  assert.equal(
    (await request(path(`/settlements/${proposal.body.data.settlement.id}`))).status,
    200,
  );
  assert.equal((await transition(request, 'close')).body.code, 'CYCLE_PENDING_SETTLEMENTS');
  assert.equal((await add(request)).body.code, 'EXPENSES_FROZEN');
  const pendingCycle = (await state()).cycle;
  const pending = await request(path(`/balances?cycleId=${pendingCycle._id}`));
  assert.equal(
    pending.body.data.balances.members.find((m) => m.user === ownerB).pendingSentMinor,
    5000,
  );
  assert.equal(
    pending.body.data.balances.members.find((m) => m.user === ownerA).pendingReceivedMinor,
    5000,
  );
  const excessive = await request(path('/settlements'), {
    method: 'POST',
    user: ownerB,
    body: {
      cycleId: String(pendingCycle._id),
      recipient: ownerA,
      amountMinor: 1,
    },
    headers: { 'Idempotency-Key': randomUUID() },
  });
  assert.equal(excessive.body.code, 'SETTLEMENT_EXCESS');
  const target = proposal.body.data.settlement.id;
  assert.equal(
    (
      await request(path(`/settlements/${target}/confirm`), {
        user: ownerB,
        method: 'POST',
        body: {},
        headers: { 'If-Match': proposal.etag },
      })
    ).status,
    403,
  );
  const confirmed = await request(path(`/settlements/${target}/confirm`), {
    method: 'POST',
    body: {},
    headers: { 'If-Match': proposal.etag },
  });
  assert.equal(confirmed.status, 200, JSON.stringify(confirmed.body));
  const confirmedHistory = await request(path(`/settlements?cycleId=${oldCycle}`));
  assert.equal(confirmedHistory.status, 200, JSON.stringify(confirmedHistory.body));
  assert.equal(confirmedHistory.body.data.settlements[0].status, 'confirmed');
  assert.equal(
    (
      await request(path(`/settlements/${target}/confirm`), {
        method: 'POST',
        body: {},
        headers: { 'If-Match': confirmed.etag },
      })
    ).status,
    409,
  );
  assert.equal((await transition(request, 'close')).status, 200);
  await open(request);
  const { cycle } = await state();
  const balances = await request(path(`/balances?cycleId=${cycle._id}`));
  assert.deepEqual(
    balances.body.data.balances.members.map((r) => r.netMinor),
    [0, 0],
  );
  const old = await request(path(`/balances?cycleId=${oldCycle}`));
  assert.deepEqual(
    old.body.data.balances.members.map((r) => r.netMinor),
    [0, 0],
  );
  assert.equal((await add(request)).status, 201);
  const replay = await request(path('/expenses'), {
    method: 'POST',
    body: { ...data, cycleId: oldCycle },
    headers: { 'Idempotency-Key': key },
  });
  assert.equal(replay.status, 200);
  assert.equal(replay.body.data.expense.id, created.body.data.expense.id);
  assert.equal(await GroupExpense.countDocuments(), 2);
});
test('bounded signed cursors cannot cross cycles, users or list kinds; group history remains available', async (t) => {
  const request = await setup(t);
  await open(request);
  for (let i = 0; i < 3; i++) assert.equal((await add(request)).status, 201);
  const { cycle } = await state();
  const first = await request(path(`/expenses?limit=1&cycleId=${cycle._id}`));
  const cursor = first.body.pagination.nextAfter;
  assert.ok(cursor);
  const next = await request(path(`/expenses?limit=1&cycleId=${cycle._id}&after=${cursor}`));
  assert.equal(next.status, 200);
  assert.notEqual(next.body.data.expenses[0].id, first.body.data.expenses[0].id);
  for (const suffix of [
    `/expenses?limit=1&after=${cursor}`,
    `/settlements?limit=1&cycleId=${cycle._id}&after=${cursor}`,
    `/expenses?limit=1&cycleId=${cycle._id}&after=${cursor}x`,
    `/expenses?limit=1&cycleId=${cycle._id}&after=${cursor}!`,
  ])
    assert.equal((await request(path(suffix))).body.code, 'INVALID_CURSOR');
  assert.equal(
    (
      await request(path(`/expenses?limit=1&cycleId=${cycle._id}&after=${cursor}`), {
        user: ownerB,
      })
    ).status,
    400,
  );
  assert.equal((await request(path('/expenses'))).body.data.expenses.length, 3);
});
test('injected applying interruption recovers fixed expense and does not expose payloads', async (t) => {
  let fail = true;
  const request = await setup(t, async (stage) => {
    if (fail && stage === 'after_target_write') {
      fail = false;
      throw Error('private fault data');
    }
  });
  await open(request);
  const key = randomUUID();
  assert.equal((await add(request, expense(), key)).status, 500);
  const before = await GroupExpense.findOne();
  assert.equal(
    (
      await request(path('/financial-recovery'), {
        user: ownerB,
        method: 'POST',
        body: {},
      })
    ).status,
    403,
  );
  const recovered = await request(path('/financial-recovery'), {
    method: 'POST',
    body: {},
  });
  assert.equal(recovered.status, 200, JSON.stringify(recovered.body));
  assert.equal(recovered.body.data.recovered, true);
  assert.equal(recovered.body.data.cycle.etag, tag((await state()).cycle));
  const replay = await add(request, expense(), key);
  assert.equal(replay.status, 200);
  assert.equal(replay.body.data.expense.id, String(before._id));
  assert.equal((await state()).group.financialOperation, undefined);
});
test('maintenance is enforced after construction; schema/index drift fails closed and construction never repairs it', async (t) => {
  const request = await setup(t);
  await mongoose.connection.db.collection('cyclemigrationruns').insertOne({ offlineHeld: true });
  assert.equal((await request(path('/cycles'))).status, 503);
  await assert.rejects(assertCycleHttpReadiness(mongoose.connection.db), {
    code: 'CYCLE_MIGRATION_MAINTENANCE',
  });
  await mongoose.connection.db.collection('cyclemigrationruns').deleteMany({});
  const index = (await GroupFinancialCycle.collection.indexes()).find((i) => i.key.sequence === 1);
  await GroupFinancialCycle.collection.dropIndex(index.name);
  try {
    assert.equal((await request(path('/cycles'))).body.code, 'CYCLE_INDEX_NOT_READY');
  } finally {
    await GroupFinancialCycle.createIndexes();
  }
  await Group.collection.updateOne(
    { _id: new mongoose.Types.ObjectId(groupId) },
    {
      $set: {
        cycleMigration: {
          version: 1,
          runId: new mongoose.Types.ObjectId(),
          state: 'held',
        },
      },
    },
  );
  assert.equal((await request(path('/cycles'))).body.code, 'CYCLE_MIGRATION_MAINTENANCE');
});
test('simultaneous first opens and freeze versus expense are serialized without duplicate active slots', async (t) => {
  const request = await setup(t);
  const { group } = await state();
  const results = await Promise.all(
    [1, 2].map(() =>
      request(path('/cycles'), {
        method: 'POST',
        body: {},
        headers: { 'If-Match': tag(group), 'Idempotency-Key': randomUUID() },
      }),
    ),
  );
  assert.equal(results.filter((r) => r.status === 201).length, 1);
  assert.equal(await GroupFinancialCycle.countDocuments({ activeSlot: true }), 1);
  const outcomes = await Promise.all([add(request), transition(request, 'freeze')]);
  assert.ok(
    outcomes.every((r) => [200, 201, 409, 412].includes(r.status)),
    JSON.stringify(outcomes),
  );
  const latest = await state();
  if (latest.cycle.status === 'open')
    assert.equal((await transition(request, 'freeze')).status, 200);
  assert.equal((await add(request)).status, 409);
});

test('independent HTTP workers: interrupted explicit freeze recovers and delayed original cannot write into next cycle', async (t) => {
  let release,
    entered,
    armed = true;
  const waiting = new Promise((r) => {
      release = r;
    }),
    ready = new Promise((r) => {
      entered = r;
    });
  const first = await setup(
    t,
    async (stage, op) => {
      if (armed && stage === 'after_cycle_write' && op.kind === 'cycle_freeze') {
        armed = false;
        entered();
        await waiting;
      }
    },
    false,
    true,
  );
  const second = await setup(t, undefined, false, true);
  await open(first);
  const original = await state();
  const inFlight = transition(first, 'freeze');
  try {
    await ready;
    const recovered = await second(path('/financial-recovery'), {
      method: 'POST',
      body: {},
    });
    assert.equal(recovered.status, 200, JSON.stringify(recovered.body));
    assert.equal((await transition(second, 'close')).status, 200);
    await open(second);
    release();
    const result = await inFlight;
    assert.equal(result.status, 200, JSON.stringify(result.body));
    const latest = await state();
    assert.equal(latest.cycle.sequence, 2);
    assert.equal(latest.cycle.status, 'open');
    assert.equal((await GroupFinancialCycle.findById(original.cycle._id)).status, 'closed');
    assert.equal(await GroupFinancialCycle.countDocuments(), 2);
  } finally {
    release();
    await inFlight;
  }
});
test('independent HTTP workers serialize confirmation versus closure and competing next-cycle opens', async (t) => {
  const first = await setup(t, undefined, false, true),
    second = await setup(t, undefined, false, true);
  await open(first);
  await add(first);
  const proposed = await settle(first),
    target = proposed.body.data.settlement.id;
  const results = await Promise.all([
    first(path(`/settlements/${target}/confirm`), {
      method: 'POST',
      body: {},
      headers: { 'If-Match': proposed.etag },
    }),
    transition(second, 'close'),
  ]);
  assert.ok(
    results.every((r) => [200, 409, 412].includes(r.status)),
    JSON.stringify(results),
  );
  if ((await GroupSettlement.findById(target)).status === 'pending') {
    const fresh = await first(path(`/settlements/${target}`));
    assert.equal(
      (
        await first(path(`/settlements/${target}/confirm`), {
          method: 'POST',
          body: {},
          headers: { 'If-Match': fresh.etag },
        })
      ).status,
      200,
    );
  }
  if ((await state()).cycle.status === 'frozen')
    assert.equal((await transition(first, 'close')).status, 200);
  const { group, cycle } = await state();
  const requests = await Promise.all(
    [first, second].map((request) =>
      request(path('/cycles'), {
        method: 'POST',
        body: { previousCycleId: String(cycle._id), epoch: group.cycleEpoch },
        headers: {
          'If-Match': tag(group),
          'If-Cycle-Match': tag(cycle),
          'Idempotency-Key': randomUUID(),
        },
      }),
    ),
  );
  assert.equal(requests.filter((r) => r.status === 201).length, 1);
  assert.equal(await GroupFinancialCycle.countDocuments({ activeSlot: true }), 1);
  assert.deepEqual(
    (await GroupFinancialCycle.find().sort({ sequence: 1 })).map((r) => r.sequence),
    [1, 2],
  );
});
test('verified migrated Cycle 1 receipt accepts a legacy creation hash only with migration provenance', async (t) => {
  const request = await setup(t);
  await open(request);
  const data = expense(),
    key = randomUUID();
  const created = await add(request, data, key);
  const row = await GroupExpense.findById(created.body.data.expense.id);
  // Model a verified migration without releasing or touching a held rehearsal database.
  const legacyHash = createHash('sha256').update(JSON.stringify(data)).digest('hex');
  await GroupExpense.collection.updateOne({ _id: row._id }, { $set: { creationHash: legacyHash } });
  assert.equal(
    (
      await request(path('/expenses'), {
        method: 'POST',
        body: data,
        headers: { 'Idempotency-Key': key },
      })
    ).body.code,
    'CYCLE_SELECTION_REQUIRED',
  );
  await GroupFinancialCycle.collection.updateOne(
    { _id: row.cycleId },
    {
      $set: {
        migrationVersion: 1,
        migrationRunId: new mongoose.Types.ObjectId(),
      },
    },
  );
  const replay = await request(path('/expenses'), {
    method: 'POST',
    body: data,
    headers: { 'Idempotency-Key': key },
  });
  assert.equal(replay.status, 200, JSON.stringify(replay.body));
  assert.equal(replay.body.data.replayed, true);
  assert.equal(await GroupExpense.countDocuments(), 1);
});
test('invitation admission only at closed boundary, new snapshot never rewrites historical identities', async (t) => {
  const request = await setup(t);
  await open(request);
  const { group, cycle } = await state();
  const invitation = await request(path('/invitations'), {
    method: 'POST',
    body: {},
    headers: { 'If-Match': tag(group) },
  });
  assert.equal(invitation.status, 201, JSON.stringify(invitation.body));
  const token = invitation.body.data.token;
  const accept = () =>
    request(`/invitations/${token}/accept`, {
      user: ownerC,
      method: 'POST',
      body: {},
    });
  assert.equal((await accept()).status, 409);
  assert.equal((await transition(request, 'freeze')).status, 200);
  assert.equal((await accept()).status, 409);
  assert.equal((await transition(request, 'close')).status, 200);
  assert.equal((await accept()).status, 200);
  assert.deepEqual((await GroupFinancialCycle.findById(cycle._id)).memberIds.map(String), [
    ownerA,
    ownerB,
  ]);
  await open(request);
  assert.deepEqual((await state()).cycle.memberIds.map(String), [ownerA, ownerB, ownerC]);
  assert.equal(
    (await request(path('/leave'), { user: ownerC, method: 'POST', body: {} })).body.code,
    'FINANCIAL_HISTORY_LOCKED',
  );
});
test('closed-cycle expense edits/deletion and decisions cannot bypass immutable associations', async (t) => {
  const request = await setup(t);
  await open(request);
  const created = await add(request),
    target = created.body.data.expense.id;
  await settle(request).then(async (proposal) => {
    assert.equal(
      (
        await request(path(`/settlements/${proposal.body.data.settlement.id}/confirm`), {
          method: 'POST',
          body: {},
          headers: { 'If-Match': proposal.etag },
        })
      ).status,
      200,
    );
  });
  assert.equal((await transition(request, 'close')).status, 200);
  for (const method of ['PATCH', 'DELETE']) {
    const result = await request(path(`/expenses/${target}`), {
      method,
      ...(method === 'PATCH' ? { body: { title: 'Forbidden' } } : {}),
      headers: { 'If-Match': created.etag },
    });
    assert.equal(result.status, 409);
  }
  assert.equal(
    (
      await request(path(`/expenses/${target}`), {
        method: 'PATCH',
        body: { cycleId: String(new mongoose.Types.ObjectId()) },
        headers: { 'If-Match': created.etag },
      })
    ).status,
    400,
  );
  const other = await groupRepository.createForOwner(ownerA, {
    name: 'Foreign version 2',
  });
  await Group.collection.updateOne({ _id: other._id }, { $set: { financialProtocolVersion: 2 } });
  assert.equal(
    (await request(`/groups/${other._id}/cycles/${created.body.data.expense.cycleId}`)).status,
    404,
  );
});
test('readiness rejects validator drift and unresolved operations without altering schema or reservation', async (t) => {
  const request = await setup(t);
  await open(request);
  const metadata = (
    await mongoose.connection.db
      .listCollections({ name: GroupFinancialCycle.collection.name })
      .toArray()
  )[0];
  await mongoose.connection.db.command({
    collMod: GroupFinancialCycle.collection.name,
    validationLevel: 'moderate',
  });
  try {
    assert.equal((await request(path('/cycles'))).body.code, 'CYCLE_SCHEMA_NOT_READY');
  } finally {
    await mongoose.connection.db.command({
      collMod: GroupFinancialCycle.collection.name,
      validator: metadata.options.validator,
      validationLevel: 'strict',
      validationAction: 'error',
    });
  }
  let failed = false;
  const worker = await setup(t, async (stage) => {
    if (!failed && stage === 'after_reserve') {
      failed = true;
      throw Error('injected checking interruption');
    }
  });
  assert.equal((await add(worker)).status, 500);
  await assert.rejects(assertCycleHttpReadiness(mongoose.connection.db), {
    code: 'CYCLE_RECOVERY_REQUIRED',
  });
  assert.equal(
    (await request(path('/financial-recovery'), { method: 'POST', body: {} })).status,
    200,
  );
});

test('simultaneous identical/conflicting HTTP creation keys persist one intent and replays stay bound', async (t) => {
  const request = await setup(t);
  await open(request);
  const key = randomUUID();
  const results = await Promise.all([add(request, expense(), key), add(request, expense(), key)]);
  assert.ok(results.every((r) => [200, 201, 409].includes(r.status)));
  assert.equal(await GroupExpense.countDocuments(), 1);
  assert.equal((await add(request, expense(), key)).status, 200);
  assert.equal(
    (await add(request, { ...expense(), title: 'Conflicting intent' }, key)).body.code,
    'IDEMPOTENCY_CONFLICT',
  );
});
test('staged readiness identifies inconsistent pointer and protocol versions without fixing records', async (t) => {
  const { assertCycleGroupConsistency } = await import('../src/staged/readiness.js');
  const request = await setup(t);
  await open(request);
  const before = await Group.collection.findOne({
    _id: new mongoose.Types.ObjectId(groupId),
  });
  await Group.collection.updateOne({ _id: before._id }, { $set: { currentCycleState: 'frozen' } });
  await assert.rejects(assertCycleGroupConsistency(mongoose.connection.db), {
    code: 'CYCLE_POINTER_INVALID',
  });
  assert.equal((await Group.findById(groupId)).currentCycleState, 'frozen');
  await Group.collection.updateOne(
    { _id: before._id },
    { $set: { currentCycleState: 'open', financialProtocolVersion: 3 } },
    { bypassDocumentValidation: true },
  );
  await assert.rejects(assertCycleGroupConsistency(mongoose.connection.db), {
    code: 'CYCLE_PROTOCOL_INACTIVE',
  });
});
test('partial cycle transition is busy until recovery reconciles; normal startup remains isolated', async (t) => {
  let fail = true;
  const request = await setup(t, async (stage, op) => {
    if (fail && stage === 'after_cycle_write' && op.kind === 'cycle_freeze') {
      fail = false;
      throw Error('injected lifecycle interruption');
    }
  });
  await open(request);
  assert.equal((await transition(request, 'freeze')).status, 500);
  const held = await state();
  assert.equal(held.cycle.status, 'frozen');
  assert.equal(held.group.currentCycleState, 'open');
  assert.equal(
    (await request(path('/financial-recovery'), { method: 'POST', body: {} })).status,
    200,
  );
  assert.equal((await state()).group.currentCycleState, 'frozen');
  assert.equal((await state()).group.financialOperation, undefined);
});

test('concurrent identical lifecycle intents reconcile once and changed reuse conflicts', async (t) => {
  const first = await setup(t, undefined, false, true),
    second = await setup(t, undefined, false, true);
  await open(first);
  const { group, cycle } = await state();
  const options = {
    method: 'POST',
    body: { epoch: group.cycleEpoch },
    headers: {
      'If-Match': tag(cycle),
      'If-Group-Match': tag(group),
      'Idempotency-Key': randomUUID(),
    },
  };
  const url = path(`/cycles/${cycle._id}/freeze`);
  const results = await Promise.all([first(url, options), second(url, options)]);
  assert.ok(
    results.some((r) => r.status === 200),
    JSON.stringify(results),
  );
  assert.ok(
    results.every((r) => [200, 409].includes(r.status)),
    JSON.stringify(results),
  );
  const replay = await first(url, options);
  assert.equal(replay.status, 200);
  assert.equal(replay.body.data.replayed, true);
  assert.equal(await GroupCycleTransition.countDocuments({ kind: 'cycle_freeze' }), 1);
  assert.equal(
    (await second(url, { ...options, body: { epoch: 2 } })).body.code,
    'IDEMPOTENCY_CONFLICT',
  );
});

test('corrupt replayed financial records fail closed rather than exposing invalid amounts', async (t) => {
  const request = await setup(t);
  await open(request);
  const key = randomUUID();
  const created = await add(request, expense(), key);
  const target = new mongoose.Types.ObjectId(created.body.data.expense.id);
  await GroupExpense.collection.updateOne(
    { _id: target },
    { $set: { amountMinor: 0 } },
    { bypassDocumentValidation: true },
  );
  const replay = await add(request, expense(), key);
  assert.equal(replay.status, 422, JSON.stringify(replay.body));
  assert.equal(replay.body.code, 'BALANCE_DATA_INVALID');
  assert.equal((await request(path(`/expenses/${target}`))).status, 422);
  const { cycle } = await state();
  assert.equal((await request(path(`/balances?cycleId=${cycle._id}`))).status, 422);
});
