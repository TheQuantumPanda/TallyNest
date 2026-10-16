import { durableWriteOptions } from '../utils/durable-write.js';
import mongoose from 'mongoose';
import { transactionPageSchema } from '../validators/transaction-query.validator.js';
import { Transaction } from '../models/transaction.model.js';
import {
  ownerIdSchema,
  transactionDateSchema,
  transactionInputSchema,
} from '../validators/transaction.validator.js';

function objectId(value) {
  return ownerIdSchema.parse(
    value instanceof mongoose.Types.ObjectId ? value.toHexString() : value,
  );
}

// Validate a full Mongoose document before any write. Query update validators
// alone cannot check type/category across fields. The version predicate below
// ensures this validated snapshot cannot overwrite a concurrent update.
export function createTransactionRepository(model = Transaction) {
  async function validatedData(ownerId, data) {
    const parsed = transactionInputSchema.parse(data);
    const document = new model({ ...parsed, owner: objectId(ownerId) });
    await document.validate();
    return document;
  }
  return {
    async createForOwner(ownerId, data, receipt = {}) {
      const document = await validatedData(ownerId, data);
      Object.assign(document, receipt);
      return document.save(durableWriteOptions());
    },
    findCreationReceipt(ownerId, key) {
      if (!/^[a-f0-9]{64}$/.test(key)) throw new TypeError('Invalid creation key');
      return model
        .findOne({ owner: objectId(ownerId), creationKey: key })
        .readConcern('majority')
        .maxTimeMS(1000)
        .exec();
    },
    async replaceForOwner(ownerId, transactionId, version, data) {
      if (!Number.isSafeInteger(version) || version < 0)
        throw new RangeError('Invalid transaction version');
      const document = await validatedData(ownerId, data);
      const values = {};
      for (const key of [
        'type',
        'title',
        'amountMinor',
        'currency',
        'category',
        'transactionDate',
        'notes',
      ]) {
        if (document[key] !== undefined) values[key] = document[key];
      }
      return model
        .findOneAndUpdate(
          {
            owner: objectId(ownerId),
            _id: objectId(transactionId),
            __v: version,
            deletedAt: { $exists: false },
          },
          {
            $set: values,
            $inc: { __v: 1 },
            ...(document.notes === undefined ? { $unset: { notes: 1 } } : {}),
          },
          { returnDocument: 'after', runValidators: false },
        )
        .exec();
    },
    async deleteForOwner(ownerId, transactionId) {
      const filter = {
        owner: objectId(ownerId),
        _id: objectId(transactionId),
        deletedAt: { $exists: false },
      };
      const generated = await model
        .findOneAndUpdate(
          {
            ...filter,
            $or: [{ recurringSchedule: { $exists: true } }, { creationKey: { $exists: true } }],
          },
          { $set: { deletedAt: new Date() }, $inc: { __v: 1 } },
          { returnDocument: 'after', ...durableWriteOptions(), maxTimeMS: 2000 },
        )
        .exec();
      return (
        generated ??
        model
          .findOneAndDelete({
            ...filter,
            recurringSchedule: { $exists: false },
            creationKey: { $exists: false },
          })
          .exec()
      );
    },
    async createGeneratedForOwner(ownerId, transactionId, scheduleId, date, input) {
      const document = await validatedData(ownerId, input);
      document._id = objectId(transactionId);
      document.recurringSchedule = objectId(scheduleId);
      document.scheduledDate = new Date(transactionDateSchema.parse(date.toISOString()));
      await document.validate();
      try {
        return { document: await document.save(durableWriteOptions()), created: true };
      } catch (error) {
        if (error.code !== 11000) throw error;
        // Includes hidden tombstones and manually edited history. Never replace it.
        const receipt = await model
          .findOne({
            owner: objectId(ownerId),
            recurringSchedule: objectId(scheduleId),
            scheduledDate: date,
          })
          .readConcern('majority')
          .exec();
        if (!receipt) throw error;
        return { document: receipt, created: false };
      }
    },
    findByIdForOwner(ownerId, transactionId) {
      return model
        .findOne({
          owner: objectId(ownerId),
          _id: objectId(transactionId),
          deletedAt: { $exists: false },
        })
        .exec();
    },
    findPageForOwner(ownerId, options) {
      const query = transactionPageSchema.parse(options);
      const filter = {
        owner: objectId(ownerId),
        currency: query.currency,
        deletedAt: { $exists: false },
      };
      for (const field of ['type', 'category']) if (query[field]) filter[field] = query[field];
      if (query.from || query.to) {
        filter.transactionDate = {
          ...(query.from ? { $gte: new Date(query.from) } : {}),
          ...(query.to ? { $lt: new Date(query.to) } : {}),
        };
      }
      if (query.search) {
        filter.title = {
          $regex: query.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
          $options: 'i',
        };
      }
      const direction = query.sortOrder === 'asc' ? 1 : -1;
      if (query.after) {
        const operator = direction === 1 ? '$gt' : '$lt';
        const value =
          query.sortBy === 'transactionDate' ? new Date(query.after.value) : query.after.value;
        filter.$or = [
          { [query.sortBy]: { [operator]: value } },
          { [query.sortBy]: value, _id: { [operator]: objectId(query.after.id) } },
        ];
      }
      return model
        .find(filter)
        .sort({ [query.sortBy]: direction, _id: direction })
        .limit(query.limit + 1)
        .maxTimeMS(1000)
        .exec();
    },
    findForOwner(ownerId, { from, to, limit = 50 } = {}) {
      const filter = { owner: objectId(ownerId), deletedAt: { $exists: false } };
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100)
        throw new RangeError('Limit must be 1–100');
      if (from !== undefined || to !== undefined) {
        filter.transactionDate = {};
        if (from !== undefined)
          filter.transactionDate.$gte = new Date(transactionDateSchema.parse(from));
        if (to !== undefined)
          filter.transactionDate.$lt = new Date(transactionDateSchema.parse(to));
        if (from !== undefined && to !== undefined && from >= to)
          throw new RangeError('Date range must be increasing');
      }
      return model.find(filter).sort({ transactionDate: -1, _id: -1 }).limit(limit).exec();
    },
  };
}

export const transactionRepository = createTransactionRepository();
