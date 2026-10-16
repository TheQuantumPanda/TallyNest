import { durableWriteOptions } from '../utils/durable-write.js';
import mongoose from 'mongoose';
import { RecurringSchedule } from '../models/recurring.model.js';
import { Transaction } from '../models/transaction.model.js';
import { ownerIdSchema } from '../validators/transaction.validator.js';
import { recurringInputSchema, recurringPageSchema } from '../validators/recurring.validator.js';
import { cursorAfter } from '../utils/recurrence.js';
const objectId = (value) =>
  ownerIdSchema.parse(value instanceof mongoose.Types.ObjectId ? value.toHexString() : value);
function versionNumber(value) {
  if (!Number.isSafeInteger(value) || value < 0 || value >= Number.MAX_SAFE_INTEGER - 2)
    throw new RangeError('Invalid version');
}
export function createRecurringRepository(model = RecurringSchedule) {
  return {
    async createForOwner(owner, input, receipt = {}) {
      const data = recurringInputSchema.parse(input);
      return new model({
        ...data,
        ...receipt,
        owner: objectId(owner),
        ...cursorAfter(data),
        __v: 0,
      }).save(durableWriteOptions());
    },
    findCreationReceipt(owner, key) {
      if (!/^[a-f0-9]{64}$/.test(key)) throw new TypeError('Invalid creation key');
      return model
        .findOne({ owner: objectId(owner), creationKey: key })
        .readConcern('majority')
        .maxTimeMS(1000)
        .exec();
    },
    findByIdForOwner(owner, id) {
      return model
        .findOne({ owner: objectId(owner), _id: objectId(id), deletedAt: { $exists: false } })
        .exec();
    },
    listForOwner(owner, input) {
      const { status, limit, after } = recurringPageSchema.parse(input);
      return model
        .find({
          owner: objectId(owner),
          deletedAt: { $exists: false },
          ...(status ? { status } : {}),
          ...(after ? { _id: { $lt: objectId(after) } } : {}),
        })
        .sort({ _id: -1 })
        .limit(limit + 1)
        .maxTimeMS(1000)
        .exec();
    },
    async replaceForOwner(owner, id, version, input, lastOccurrenceDate) {
      versionNumber(version);
      const data = recurringInputSchema.parse(input),
        cursor = cursorAfter(data, lastOccurrenceDate);
      const document = new model({
        ...data,
        owner: objectId(owner),
        ...cursor,
        lastOccurrenceDate,
      });
      await document.validate();
      const values = {};
      for (const key of [
        'type',
        'title',
        'amountMinor',
        'currency',
        'category',
        'frequency',
        'startDate',
        'status',
        'endDate',
        'notes',
      ])
        if (document[key] !== undefined) values[key] = document[key];
      return model
        .findOneAndUpdate(
          {
            owner: objectId(owner),
            _id: objectId(id),
            __v: version,
            deletedAt: { $exists: false },
            pending: { $exists: false },
          },
          {
            $set: { ...values, ...cursor },
            $inc: { __v: 1 },
            $unset: {
              ...(data.notes === undefined ? { notes: 1 } : {}),
              ...(!data.endDate ? { endDate: 1 } : {}),
            },
          },
          { returnDocument: 'after', ...durableWriteOptions(), maxTimeMS: 2000 },
        )
        .exec();
    },
    deleteForOwner(owner, id) {
      return model
        .findOneAndUpdate(
          {
            owner: objectId(owner),
            _id: objectId(id),
            deletedAt: { $exists: false },
            pending: { $exists: false },
          },
          { $set: { deletedAt: new Date() }, $inc: { __v: 1 } },
          { returnDocument: 'after', ...durableWriteOptions(), maxTimeMS: 2000 },
        )
        .exec();
    },
    // Trusted background-worker scan; owner is mandatory at the HTTP boundary.
    findDue({ owner, asOf, exclude = [] }) {
      if (
        !(asOf instanceof Date) ||
        !Number.isFinite(asOf.getTime()) ||
        !Array.isArray(exclude) ||
        exclude.length > 100
      )
        throw new RangeError('Invalid due query');
      return model
        .findOne({
          ...(owner ? { owner: objectId(owner) } : {}),
          status: 'active',
          deletedAt: { $exists: false },
          nextOccurrenceDate: { $ne: null, $lte: asOf },
          _id: { $nin: exclude.map(objectId) },
        })
        .sort({ nextOccurrenceDate: 1, _id: 1 })
        .maxTimeMS(1000)
        .readConcern('majority')
        .exec();
    },
    reserve(document, transactionId) {
      versionNumber(document.__v);
      return model
        .findOneAndUpdate(
          {
            owner: objectId(document.owner),
            _id: document._id,
            __v: document.__v,
            status: 'active',
            deletedAt: { $exists: false },
            pending: { $exists: false },
          },
          {
            $set: { pending: { date: document.nextOccurrenceDate, transactionId } },
            $inc: { __v: 1 },
          },
          { returnDocument: 'after', ...durableWriteOptions(), maxTimeMS: 2000 },
        )
        .exec();
    },
    advance(document, cursor) {
      return model
        .findOneAndUpdate(
          {
            owner: objectId(document.owner),
            _id: document._id,
            __v: document.__v,
            deletedAt: { $exists: false },
            'pending.transactionId': document.pending.transactionId,
            'pending.date': document.pending.date,
          },
          {
            $set: { ...cursor, lastOccurrenceDate: document.pending.date },
            $unset: { pending: 1 },
            $inc: { __v: 1 },
          },
          { returnDocument: 'after', ...durableWriteOptions(), maxTimeMS: 2000 },
        )
        .exec();
    },
  };
}
export const recurringRepository = createRecurringRepository();
export async function ensureRecurringIndexes() {
  await Promise.all([RecurringSchedule.init(), Transaction.init()]);
}
