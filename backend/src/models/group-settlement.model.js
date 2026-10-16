import mongoose from 'mongoose';
import {
  amountMinorSchema,
  ownerIdSchema,
  currencySchema,
} from '../validators/transaction.validator.js';
const reference = (ref, required = true) => ({
  type: mongoose.Schema.Types.ObjectId,
  ref,
  required,
  immutable: true,
  set(value) {
    return value === undefined
      ? value
      : ownerIdSchema.parse(value instanceof mongoose.Types.ObjectId ? String(value) : value);
  },
});
const schema = new mongoose.Schema(
  {
    group: reference('Group'),
    // Optional for legacy settlements; later migration will backfill it.
    cycleId: reference('GroupFinancialCycle', false),
    sender: reference('User'),
    recipient: reference('User'),
    amountMinor: {
      type: Number,
      required: true,
      immutable: true,
      set: (value) => amountMinorSchema.parse(value),
    },
    currency: {
      type: String,
      required: true,
      immutable: true,
      default: 'INR',
      set: (value) => currencySchema.parse(value),
    },
    status: {
      type: String,
      required: true,
      enum: ['pending', 'confirmed', 'rejected'],
      default: 'pending',
    },
    createdAt: { type: Date, required: true, immutable: true },
    confirmedAt: Date,
    rejectedAt: Date,
    decisionBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    creationKey: {
      type: String,
      required: true,
      immutable: true,
      match: /^[a-f0-9]{64}$/,
    },
    creationHash: {
      type: String,
      required: true,
      immutable: true,
      match: /^[a-f0-9]{64}$/,
    },
    lastFinancialOperation: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
    },
  },
  { strict: 'throw', optimisticConcurrency: true },
);
schema.pre('validate', function () {
  if (
    String(this.sender) === String(this.recipient) ||
    (this.status === 'pending' && (this.confirmedAt || this.rejectedAt || this.decisionBy)) ||
    (this.status === 'confirmed' &&
      (!this.confirmedAt ||
        this.rejectedAt ||
        String(this.decisionBy) !== String(this.recipient))) ||
    (this.status === 'rejected' &&
      (!this.rejectedAt || this.confirmedAt || String(this.decisionBy) !== String(this.recipient)))
  )
    this.invalidate('status', 'Invalid settlement audit state');
});
schema.index({ group: 1, _id: -1 });
schema.index({ group: 1, sender: 1, creationKey: 1 }, { unique: true });
export const GroupSettlement = mongoose.model('GroupSettlement', schema);
export const settlementCollectionValidator = {
  $and: [
    {
      $jsonSchema: {
        bsonType: 'object',
        additionalProperties: false,
        required: [
          '_id',
          'group',
          'sender',
          'recipient',
          'amountMinor',
          'currency',
          'status',
          'createdAt',
          'creationKey',
          'creationHash',
          'lastFinancialOperation',
          '__v',
        ],
        properties: {
          ...Object.fromEntries(
            [
              '_id',
              'group',
              'cycleId',
              'sender',
              'recipient',
              'lastFinancialOperation',
              'decisionBy',
            ].map((key) => [key, { bsonType: 'objectId' }]),
          ),
          amountMinor: {
            bsonType: ['int', 'long', 'double'],
            minimum: 1,
            maximum: Number.MAX_SAFE_INTEGER,
          },
          currency: { enum: ['INR'] },
          status: { enum: ['pending', 'confirmed', 'rejected'] },
          ...Object.fromEntries(
            ['createdAt', 'confirmedAt', 'rejectedAt'].map((key) => [key, { bsonType: 'date' }]),
          ),
          creationKey: { bsonType: 'string', pattern: '^[a-f0-9]{64}$' },
          creationHash: { bsonType: 'string', pattern: '^[a-f0-9]{64}$' },
          __v: { bsonType: ['int', 'long', 'double'], minimum: 0, maximum: 1 },
        },
      },
    },
    {
      $expr: {
        $and: [
          { $ne: ['$sender', '$recipient'] },
          { $eq: ['$amountMinor', { $trunc: '$amountMinor' }] },
          { $eq: ['$__v', { $cond: [{ $eq: ['$status', 'pending'] }, 0, 1] }] },
          {
            $switch: {
              branches: [
                {
                  case: { $eq: ['$status', 'pending'] },
                  then: {
                    $and: ['confirmedAt', 'rejectedAt', 'decisionBy'].map((key) => ({
                      $eq: [{ $type: '$' + key }, 'missing'],
                    })),
                  },
                },
                {
                  case: { $eq: ['$status', 'confirmed'] },
                  then: {
                    $and: [
                      { $eq: ['$decisionBy', '$recipient'] },
                      { $eq: [{ $type: '$confirmedAt' }, 'date'] },
                      { $gte: ['$confirmedAt', '$createdAt'] },
                      { $eq: [{ $type: '$rejectedAt' }, 'missing'] },
                    ],
                  },
                },
                {
                  case: { $eq: ['$status', 'rejected'] },
                  then: {
                    $and: [
                      { $eq: ['$decisionBy', '$recipient'] },
                      { $eq: [{ $type: '$rejectedAt' }, 'date'] },
                      { $gte: ['$rejectedAt', '$createdAt'] },
                      { $eq: [{ $type: '$confirmedAt' }, 'missing'] },
                    ],
                  },
                },
              ],
              default: false,
            },
          },
        ],
      },
    },
  ],
};
