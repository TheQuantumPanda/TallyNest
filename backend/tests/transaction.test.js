import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { Transaction } from '../src/models/transaction.model.js';
import { transactionInputSchema, transactionDocumentSchema } from '../src/validators/transaction.validator.js';
import { TRANSACTION_CATEGORIES, isCategoryForType } from '../src/constants/transaction.constants.js';
import { createTransactionRepository } from '../src/repositories/transaction.repository.js';

const owner = '507f1f77bcf86cd799439011';
const input = { type: 'expense', title: ' Lunch ', amountMinor: 10050, category: 'food_dining',
  transactionDate: '2024-02-29T12:30:00.000Z' };
const document = overrides => ({ owner, ...input, ...overrides });

for (const [type, category] of [['income', 'salary'], ['expense', 'food_dining']]) {
  test(`valid ${type} agrees across input, document and model`, async () => {
    const data = document({ type, category });
    assert.equal(transactionDocumentSchema.parse(data).currency, 'INR');
    const { owner: _owner, ...payload } = data;
    assert.equal(transactionInputSchema.parse(payload).title, 'Lunch');
    const model = new Transaction(data);
    assert.equal(model.validateSync(), undefined);
    await model.validate();
    assert.equal(model.owner.toHexString(), owner);
    assert.equal(model.title, 'Lunch');
    assert.equal(model.amountMinor, 10050);
    assert.equal(model.currency, 'INR');
    assert.equal(model.transactionDate.toISOString(), input.transactionDate);
  });
}

for (const amountMinor of [0, -1, -10050, 1.5, 0.1, NaN, Infinity, -Infinity,
  Number.MAX_SAFE_INTEGER + 1, '100', true, null, {}, [], undefined]) {
  test(`reject invalid amount ${String(amountMinor)} (${typeof amountMinor}) in Zod and Mongoose`, () => {
    const data = document({ amountMinor });
    assert.equal(transactionDocumentSchema.safeParse(data).success, false);
    assert.ok(new Transaction(data).validateSync()?.errors.amountMinor);
  });
}

for (const amountMinor of [1, Number.MAX_SAFE_INTEGER]) {
  test(`accept exact minor-unit boundary ${amountMinor}`, () => {
    const data = document({ amountMinor });
    assert.equal(transactionDocumentSchema.safeParse(data).success, true);
    const model = new Transaction(data);
    assert.equal(model.validateSync(), undefined);
    assert.equal(model.amountMinor, amountMinor);
  });
}

for (const overrides of [
  { type: 'transfer' }, { category: 'unknown' }, { category: 'salary' },
  { type: 'income', category: 'food_dining' }, { currency: 'USD' }, { currency: 'inr' },
  { title: '' }, { title: '   ' }, { title: 'x'.repeat(201) }, { title: 42 },
  { notes: 'x'.repeat(2001) }, { notes: null },
]) {
  test(`reject incompatible or malformed fields ${JSON.stringify(overrides).slice(0, 90)}`, () => {
    const data = document(overrides);
    assert.equal(transactionDocumentSchema.safeParse(data).success, false);
    assert.ok(new Transaction(data).validateSync());
  });
}

test('all central category definitions validate only their declared types', () => {
  assert.equal(new Set(TRANSACTION_CATEGORIES.map(value => value.id)).size, TRANSACTION_CATEGORIES.length);
  for (const category of TRANSACTION_CATEGORIES) {
    assert.ok(category.label);
    for (const type of ['income', 'expense']) {
      const expected = category.types.includes(type);
      assert.equal(isCategoryForType(category.id, type), expected);
      assert.equal(transactionInputSchema.safeParse({ ...input, type, category: category.id }).success, expected);
      assert.equal(!new Transaction(document({ type, category: category.id })).validateSync(), expected);
    }
  }
});

for (const transactionDate of ['2023-02-29T00:00:00.000Z', '2024-02-30T00:00:00.000Z',
  '2024-04-31T00:00:00.000Z', '1900-02-29T00:00:00.000Z', '2024-13-01T00:00:00.000Z', '2024-01-01T24:00:00.000Z',
  '2024-01-01T00:00:60.000Z', '2024-01-01', '2024-01-01T00:00:00Z',
  '2024-01-01T00:00:00.000+05:30', 'bad', 0, null, undefined]) {
  test(`reject invalid or noncanonical transaction date ${transactionDate}`, () => {
    const data = document({ transactionDate });
    assert.equal(transactionDocumentSchema.safeParse(data).success, false);
    assert.ok(new Transaction(data).validateSync()?.errors.transactionDate);
  });
}

test('model accepts valid Date objects internally, rejects invalid Date and numeric timestamps', () => {
  assert.equal(new Transaction(document({ transactionDate: new Date(input.transactionDate) })).validateSync(), undefined);
  assert.ok(new Transaction(document({ transactionDate: new Date(NaN) })).validateSync());
  assert.ok(new Transaction(document({ transactionDate: new Date('+010000-01-01T00:00:00.000Z') })).validateSync());
});

for (const value of [undefined, null, '', 'bad', 123, { $ne: null }]) {
  test(`ownership is required and cannot be an operator: ${JSON.stringify(value)}`, () => {
    assert.equal(transactionDocumentSchema.safeParse(document({ owner: value })).success, false);
    assert.ok(new Transaction(document({ owner: value })).validateSync()?.errors.owner);
  });
}

test('input excludes ownership, timestamps and undeclared fields', () => {
  for (const extra of [{ owner }, { createdAt: input.transactionDate }, { amount: 100.5 }, { unexpected: true }]) {
    assert.equal(transactionInputSchema.safeParse({ ...input, ...extra }).success, false);
  }
  assert.throws(() => new Transaction(document({ unexpected: true })), /strict/i);
});

test('optional notes are omitted or trimmed, and model accepts ObjectId ownership', () => {
  const absent = new Transaction(document());
  assert.equal(absent.notes, undefined);
  for (const notes of ['', '  memo  ', 'x'.repeat(2000)]) {
    const parsed = transactionDocumentSchema.parse(document({ notes }));
    const model = new Transaction(document({ owner: new mongoose.Types.ObjectId(owner), notes }));
    assert.equal(model.validateSync(), undefined);
    assert.equal(model.notes, parsed.notes);
  }
});

test('changing type rechecks category compatibility on full document validation', () => {
  const model = new Transaction(document());
  model.type = 'income';
  assert.ok(model.validateSync()?.errors.category);
});

test('schema declares timestamps, immutable ownership and scoped date and amount indexes', () => {
  assert.equal(Transaction.schema.options.timestamps, true);
  assert.equal(Transaction.schema.path('owner').options.ref, 'User');
  assert.equal(Transaction.schema.path('owner').options.immutable, true);
  assert.ok(Transaction.schema.path('createdAt'));
  assert.ok(Transaction.schema.path('updatedAt'));
  assert.deepEqual(Transaction.schema.indexes().map(([keys]) => keys), [{ owner: 1, transactionDate: -1, _id: -1 }, { owner: 1, amountMinor: -1, _id: -1 }, { recurringSchedule: 1, scheduledDate: 1 }, { owner: 1, creationKey: 1 }]);
});

function mockRepository() {
  const calls = [];
  const model = {
    findOne(filter) { calls.push(['findOne', filter]); return { exec: async () => null }; },
    find(filter) {
      calls.push(['find', filter]);
      return { sort(order) { calls.push(['sort', order]); return this; },
        limit(value) { calls.push(['limit', value]); return this; }, exec: async () => [] };
    },
  };
  return { repository: createTransactionRepository(model), calls };
}

test('repository single lookup is scoped to owner and transaction ID', async () => {
  const { repository, calls } = mockRepository();
  const id = '507f1f77bcf86cd799439012';
  assert.equal(await repository.findByIdForOwner(owner, id), null);
  assert.deepEqual(calls, [['findOne', { owner, _id: id, deletedAt: { $exists: false } }]]);
});

test('repository history scope, half-open dates, stable ordering and limit', async () => {
  const { repository, calls } = mockRepository();
  const from = '2024-02-01T00:00:00.000Z';
  const to = '2024-03-01T00:00:00.000Z';
  assert.deepEqual(await repository.findForOwner(new mongoose.Types.ObjectId(owner), { from, to, limit: 20 }), []);
  assert.deepEqual(calls, [['find', { owner, deletedAt: { $exists: false }, transactionDate: { $gte: new Date(from), $lt: new Date(to) } }],
    ['sort', { transactionDate: -1, _id: -1 }], ['limit', 20]]);
});

test('repository owner-only read remains bounded', async () => {
  const { repository, calls } = mockRepository();
  await repository.findForOwner(owner);
  assert.deepEqual(calls, [['find', { owner, deletedAt: { $exists: false } }], ['sort', { transactionDate: -1, _id: -1 }], ['limit', 50]]);
});

test('repository rejects missing ownership, operator injection, invalid IDs and bad ranges before queries', () => {
  const { repository, calls } = mockRepository();
  for (const badOwner of [undefined, null, '', { $ne: null }]) {
    assert.throws(() => repository.findForOwner(badOwner));
    assert.throws(() => repository.findByIdForOwner(badOwner, owner));
  }
  assert.throws(() => repository.findByIdForOwner(owner, { $ne: null }));
  for (const options of [{ limit: 0 }, { limit: 101 }, { limit: 1.5 }, { limit: '50' },
    { from: '2024-02-30T00:00:00.000Z' }, { from: input.transactionDate, to: input.transactionDate }]) {
    assert.throws(() => repository.findForOwner(owner, options));
  }
  assert.deepEqual(calls, []);
});

test('text and leap-century boundaries are accepted without truncation', () => {
  const data = document({ title: 'x'.repeat(200), notes: 'x'.repeat(2000),
    transactionDate: '2000-02-29T00:00:00.000Z' });
  assert.equal(transactionDocumentSchema.safeParse(data).success, true);
  assert.equal(new Transaction(data).validateSync(), undefined);
});

test('model rejects invalid assignments after an initially valid document', () => {
  for (const [field, value] of [['amountMinor', '100'], ['transactionDate', '2024-02-30T00:00:00.000Z'],
    ['title', 42], ['currency', 'USD']]) {
    const model = new Transaction(document());
    model[field] = value;
    assert.ok(model.validateSync()?.errors[field]);
  }
});

test('repository atomic write and deletion filters always include owner, ID and version where needed', async () => {
  const calls = [];
  function Model(data) { return new Transaction(data); }
  Model.findOneAndUpdate = (filter, update, options) => {
    calls.push({ filter, update, options });
    return { exec: async () => null };
  };
  Model.findOneAndDelete = filter => {
    calls.push({ filter });
    return { exec: async () => null };
  };
  const repository = createTransactionRepository(Model);
  const id = '507f1f77bcf86cd799439012';
  await repository.replaceForOwner(owner, id, 7, input);
  assert.deepEqual(calls[0].filter, { owner, _id: id, __v: 7, deletedAt: { $exists: false } });
  assert.deepEqual(calls[0].update.$inc, { __v: 1 });
  assert.deepEqual(calls[0].update.$unset, { notes: 1 });
  assert.equal(calls[0].update.$set.amountMinor, 10050);
  assert.equal(Object.hasOwn(calls[0].update.$set, 'owner'), false);
  await repository.deleteForOwner(owner, id);
  assert.deepEqual(calls[1].filter, { owner, _id: id, deletedAt: { $exists: false }, $or: [{ recurringSchedule: { $exists: true } }, { creationKey: { $exists: true } }] });
  assert.deepEqual(calls[2].filter, { owner, _id: id, deletedAt: { $exists: false }, recurringSchedule: { $exists: false }, creationKey: { $exists: false } });
  const before = calls.length;
  await assert.rejects(() => repository.replaceForOwner(owner, id, 7, { ...input, amountMinor: 1.5 }));
  await assert.rejects(() => repository.replaceForOwner(owner, id, 7, { ...input, owner }));
  await assert.rejects(() => repository.replaceForOwner(owner, id, -1, input));
  await assert.rejects(() => repository.deleteForOwner({ $ne: null }, id));
  assert.equal(calls.length, before);
});
