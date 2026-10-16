import mongoose from 'mongoose';
import {
  GroupExpense,
  groupExpenseCollectionValidator,
  persistedSplit,
} from '../models/group-expense.model.js';
import {
  groupExpenseInputSchema,
  expensePageSchema,
} from '../validators/group-expense.validator.js';
import { ownerIdSchema } from '../validators/transaction.validator.js';
import { allocateSplit } from '../utils/split.js';
import { durableWriteOptions } from '../utils/durable-write.js';
const id = (value) =>
  ownerIdSchema.parse(value instanceof mongoose.Types.ObjectId ? String(value) : value);
async function documentFor(model, group, creator, input, creationKey, creationHash) {
  const data = groupExpenseInputSchema.parse(input),
    allocation = allocateSplit(data.amountMinor, data.split);
  const document = new model({
    ...data,
    split: persistedSplit(allocation.split),
    shares: allocation.shares,
    group: id(group),
    creator: id(creator),
    creationKey,
    creationHash,
    __v: 0,
  });
  await document.validate();
  return document;
}
export function createGroupExpenseRepository(model = GroupExpense) {
  return {
    async create(group, creator, input, key, hash, operationId, targetId) {
      id(operationId);
      id(targetId);
      const document = await documentFor(model, group, creator, input, key, hash);
      document._id = targetId;
      document.lastFinancialOperation = operationId;
      return document.save(durableWriteOptions());
    },
    findAny(group, target) {
      return model
        .findOne({ group: id(group), _id: id(target) })
        .readConcern('majority')
        .maxTimeMS(1000)
        .exec();
    },
    findReceipt(group, creator, key) {
      return model
        .findOne({ group: id(group), creator: id(creator), creationKey: key })
        .readConcern('majority')
        .maxTimeMS(1000)
        .exec();
    },
    find(group, expenseId) {
      return model
        .findOne({ group: id(group), _id: id(expenseId), deletedAt: { $exists: false } })
        .maxTimeMS(1000)
        .exec();
    },
    page(group, input) {
      const { limit, after } = expensePageSchema.parse(input);
      if (after && after.group !== id(group).toLowerCase())
        throw new TypeError('Wrong cursor group');
      return model
        .find({
          group: id(group),
          deletedAt: { $exists: false },
          ...(after
            ? {
                $or: [
                  { expenseDate: { $lt: new Date(after.expenseDate) } },
                  { expenseDate: new Date(after.expenseDate), _id: { $lt: id(after.id) } },
                ],
              }
            : {}),
        })
        .sort({ expenseDate: -1, _id: -1 })
        .limit(limit + 1)
        .maxTimeMS(1000)
        .exec();
    },
    async replace(group, expenseId, actor, owner, expected, input, creator, operationId) {
      id(operationId);
      if (!Number.isSafeInteger(expected) || expected < 0 || expected >= Number.MAX_SAFE_INTEGER)
        throw new RangeError('Invalid expense version');
      const document = await documentFor(
        model,
        group,
        creator,
        input,
        '0'.repeat(64),
        '0'.repeat(64),
      );
      const values = Object.fromEntries(
        [
          'payer',
          'title',
          'amountMinor',
          'currency',
          'category',
          'expenseDate',
          'split',
          'shares',
          'notes',
        ]
          .filter((key) => document[key] !== undefined)
          .map((key) => [key, document[key]]),
      );
      return model
        .findOneAndUpdate(
          {
            group: id(group),
            _id: id(expenseId),
            ...(!owner ? { creator: id(actor) } : {}),
            __v: expected,
            deletedAt: { $exists: false },
          },
          {
            $set: { ...values, lastFinancialOperation: operationId },
            ...(document.notes === undefined ? { $unset: { notes: 1 } } : {}),
            $inc: { __v: 1 },
          },
          { returnDocument: 'after', ...durableWriteOptions(), maxTimeMS: 2000 },
        )
        .exec();
    },
    remove(group, expenseId, actor, owner, expected, operationId) {
      id(operationId);
      if (!Number.isSafeInteger(expected) || expected < 0 || expected >= Number.MAX_SAFE_INTEGER)
        throw new RangeError('Invalid expense version');
      return model
        .findOneAndUpdate(
          {
            group: id(group),
            _id: id(expenseId),
            ...(!owner ? { creator: id(actor) } : {}),
            __v: expected,
            deletedAt: { $exists: false },
          },
          {
            $set: { deletedAt: new Date(), lastFinancialOperation: operationId },
            $inc: { __v: 1 },
          },
          { returnDocument: 'after', ...durableWriteOptions(), maxTimeMS: 2000 },
        )
        .exec();
    },
  };
}
export const groupExpenseRepository = createGroupExpenseRepository();
export async function ensureGroupExpenseIndexes() {
  const db = GroupExpense.db.db,
    name = GroupExpense.collection.name;
  try {
    await db.createCollection(name, {
      validator: groupExpenseCollectionValidator,
      validationLevel: 'strict',
      validationAction: 'error',
    });
  } catch (error) {
    if (error.code !== 48) throw error;
  }
  await db.command({
    collMod: name,
    validator: groupExpenseCollectionValidator,
    validationLevel: 'strict',
    validationAction: 'error',
  });
  await GroupExpense.init();
}
