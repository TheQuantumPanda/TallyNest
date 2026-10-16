import assert from 'node:assert/strict';
import test from 'node:test';
import { Budget } from '../src/models/budget.model.js';
import { createBudgetRepository } from '../src/repositories/budget.repository.js';
import { ownerA } from './helpers/transaction-api.js';
import { budget, budgetApiSetup, budgetApiContract } from './helpers/budget-api.js';
import { budgetInputSchema, budgetMonthSchema } from '../src/validators/budget.validator.js';

function isolatedBudgets() {
  const records = new Map();
  const snapshot = (document) => (document ? Budget.hydrate(document.toObject()) : null);
  function unique(document) {
    if (
      [...records.values()].some(
        (row) =>
          String(row._id) !== String(document._id) &&
          String(row.owner) === String(document.owner) &&
          row.month === document.month &&
          row.currency === document.currency &&
          row.category === document.category,
      )
    ) {
      throw Object.assign(new Error('Duplicate'), { code: 11000 });
    }
  }
  return {
    async createForOwner(owner, data) {
      const document = new Budget({ ...data, owner });
      await document.validate();
      document.createdAt = document.updatedAt = new Date('2026-10-13T00:00:00.000Z');
      document.__v = 0;
      unique(document);
      records.set(String(document._id), document);
      return snapshot(document);
    },
    async findByIdForOwner(owner, id) {
      const row = records.get(id);
      return row && String(row.owner) === owner ? snapshot(row) : null;
    },
    async findForOwner(owner, query) {
      return [...records.values()]
        .filter(
          (row) =>
            String(row.owner) === owner &&
            row.month === query.month &&
            row.currency === query.currency &&
            (!query.category || row.category === query.category),
        )
        .sort((a, b) => a.category.localeCompare(b.category))
        .map(snapshot);
    },
    async replaceForOwner(owner, id, version, data) {
      const old = records.get(id);
      if (!old || String(old.owner) !== owner || old.__v !== version) return null;
      const document = new Budget({
        ...data,
        owner,
        _id: id,
        __v: version + 1,
        createdAt: old.createdAt,
        updatedAt: new Date('2026-10-14T00:00:00.000Z'),
      });
      await document.validate();
      if (records.get(id)?.__v !== version) return null;
      unique(document);
      records.set(id, document);
      return snapshot(document);
    },
    async deleteForOwner(owner, id) {
      const row = await this.findByIdForOwner(owner, id);
      if (row) records.delete(id);
      return row;
    },
  };
}
budgetApiContract((t, { wrapRepository = (value) => value } = {}) =>
  budgetApiSetup(t, wrapRepository(isolatedBudgets())),
);

test('budget model agrees with reusable schemas and rejects casting invalid monetary inputs', async () => {
  for (const value of [0, -1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, '100', true]) {
    assert.equal(budgetInputSchema.safeParse({ ...budget, amountMinor: value }).success, false);
    await assert.rejects(new Budget({ ...budget, owner: ownerA, amountMinor: value }).validate());
  }
  await new Budget({ ...budget, owner: ownerA, amountMinor: Number.MAX_SAFE_INTEGER }).validate();
  for (const changes of [
    { owner: undefined },
    { owner: 'bad' },
    { category: 'salary' },
    { currency: 'USD' },
    { month: '2026-1' },
  ]) {
    await assert.rejects(new Budget({ ...budget, owner: ownerA, ...changes }).validate());
  }
  assert.throws(() => new Budget({ ...budget, owner: ownerA, unexpected: 1 }));
});
test('budget canonical month accepts real calendar keys only', () => {
  for (const month of ['0001-01', '2024-02', '9999-12'])
    assert.equal(budgetMonthSchema.safeParse(month).success, true);
  for (const month of [
    '0000-01',
    '2026-00',
    '2026-13',
    '2026-2',
    '2026-02Z',
    ' 2026-02',
    '10000-01',
    null,
  ])
    assert.equal(budgetMonthSchema.safeParse(month).success, false);
});
test('budget schema has one unique compound index and optimistic document saves', () => {
  assert.deepEqual(Budget.schema.indexes(), [
    [{ owner: 1, month: 1, currency: 1, category: 1 }, { unique: true }],
  ]);
  assert.equal(Budget.schema.options.optimisticConcurrency, true);
  assert.equal(Budget.schema.options.timestamps, true);
  assert.equal(Budget.schema.path('owner').options.immutable, true);
});
test('budget repository constructs owner-scoped reads, CAS and deletion at the query level', async () => {
  const calls = [];
  const chain = {
    sort(value) {
      calls.push(['sort', value]);
      return this;
    },
    limit() {
      return this;
    },
    maxTimeMS() {
      return this;
    },
    exec() {
      return Promise.resolve(null);
    },
  };
  class Model extends Budget {
    static find(filter) {
      calls.push(['find', filter]);
      return chain;
    }
    static findOne(filter) {
      calls.push(['findOne', filter]);
      return chain;
    }
    static findOneAndUpdate(...args) {
      calls.push(['update', ...args]);
      return chain;
    }
    static findOneAndDelete(filter) {
      calls.push(['delete', filter]);
      return chain;
    }
  }
  const repository = createBudgetRepository(Model);
  await repository.findForOwner(ownerA, { month: budget.month });
  await repository.findByIdForOwner(ownerA, ownerA);
  await repository.replaceForOwner(ownerA, ownerA, 0, budget);
  await repository.deleteForOwner(ownerA, ownerA);
  for (const call of calls.filter((row) => row[0] !== 'sort')) assert.equal(call[1].owner, ownerA);
  const update = calls.find((row) => row[0] === 'update');
  assert.equal(update[1].__v, 0);
  assert.equal(update[2].$inc.__v, 1);
  assert.equal(Object.hasOwn(update[2].$set, 'owner'), false);
  await assert.rejects(repository.replaceForOwner(ownerA, ownerA, Number.MAX_SAFE_INTEGER, budget));
  await assert.rejects(
    repository.replaceForOwner(ownerA, ownerA, 0, { ...budget, amountMinor: '100' }),
  );
  assert.throws(() => repository.findForOwner(ownerA, { month: { $ne: null } }));
});
test('budget internal failures are sanitized even outside production', async (t) => {
  const request = await budgetApiSetup(t, {
    async findForOwner() {
      throw new Error('secret driver detail');
    },
  });
  const result = await request('?month=2026-10');
  assert.equal(result.status, 500);
  assert.deepEqual(result.body, {
    status: 'error',
    message: 'Internal server error',
    code: 'INTERNAL_ERROR',
  });
});
