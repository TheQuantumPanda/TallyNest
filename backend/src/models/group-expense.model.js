import { TRANSACTION_CATEGORIES } from '../constants/transaction.constants.js';
import mongoose from 'mongoose';
import { groupExpenseInputSchema } from '../validators/group-expense.validator.js';
import { allocateSplit } from '../utils/split.js';
import {
  ownerIdSchema,
  amountMinorSchema,
  transactionDateSchema,
} from '../validators/transaction.validator.js';
function reference(ref) {
  return {
    type: mongoose.Schema.Types.ObjectId,
    ref,
    required: true,
    set(value) {
      return value === undefined
        ? value
        : ownerIdSchema.parse(value instanceof mongoose.Types.ObjectId ? String(value) : value);
    },
  };
}
function field(type, validator, options = {}) {
  return {
    type,
    set(value) {
      return value === undefined ? value : validator.parse(value);
    },
    ...options,
  };
}
const participantSchema = new mongoose.Schema(
  { user: reference('User'), amountMinor: field(Number, amountMinorSchema, { required: true }) },
  { _id: false, strict: 'throw' },
);
const splitParticipant = new mongoose.Schema(
  {
    user: reference('User'),
    amountMinor: field(Number, amountMinorSchema),
    basisPoints: { type: Number },
  },
  { _id: false, strict: 'throw' },
);
const splitSchema = new mongoose.Schema(
  {
    method: { type: String, enum: ['equal', 'exact', 'percentage'], required: true },
    participants: { type: [splitParticipant], required: true },
  },
  { _id: false, strict: 'throw' },
);
const fields = groupExpenseInputSchema.shape;
const schema = new mongoose.Schema(
  {
    group: { ...reference('Group'), immutable: true },
    // Optional while old group financial records and write paths remain in service.
    cycleId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'GroupFinancialCycle',
      immutable: true,
      set(value) {
        return value === undefined
          ? value
          : ownerIdSchema.parse(value instanceof mongoose.Types.ObjectId ? String(value) : value);
      },
    },
    creator: { ...reference('User'), immutable: true },
    payer: reference('User'),
    title: field(String, fields.title, { required: true }),
    amountMinor: field(Number, fields.amountMinor, { required: true }),
    currency: field(String, fields.currency, { required: true, default: 'INR' }),
    category: field(String, fields.category, { required: true }),
    expenseDate: {
      type: Date,
      required: true,
      set(value) {
        return value === undefined
          ? value
          : new Date(
              transactionDateSchema.parse(value instanceof Date ? value.toISOString() : value),
            );
      },
    },
    notes: field(String, fields.notes),
    split: { type: splitSchema, required: true },
    shares: { type: [participantSchema], required: true },
    creationKey: { type: String, required: true, match: /^[a-f0-9]{64}$/, immutable: true },
    creationHash: { type: String, required: true, match: /^[a-f0-9]{64}$/, immutable: true },
    lastFinancialOperation: { type: mongoose.Schema.Types.ObjectId },
    deletedAt: { type: Date },
  },
  { timestamps: true, strict: 'throw', optimisticConcurrency: true },
);
export function expenseInput(document) {
  return {
    payer: String(document.payer),
    title: document.title,
    amountMinor: document.amountMinor,
    currency: document.currency,
    category: document.category,
    expenseDate: document.expenseDate.toISOString(),
    ...(document.notes !== undefined ? { notes: document.notes } : {}),
    split: {
      method: document.split.method,
      participants: document.split.participants.map((row) =>
        document.split.method === 'equal'
          ? String(row.user)
          : document.split.method === 'exact'
            ? { user: String(row.user), amountMinor: row.amountMinor }
            : { user: String(row.user), basisPoints: row.basisPoints },
      ),
    },
  };
}
schema.pre('validate', function () {
  try {
    const { shares } = allocateSplit(this.amountMinor, expenseInput(this).split);
    const allowed =
      this.split.method === 'equal'
        ? ['user']
        : this.split.method === 'exact'
          ? ['user', 'amountMinor']
          : ['user', 'basisPoints'];
    if (
      this.split.participants.some((row) =>
        Object.keys(row.toObject()).some((key) => !allowed.includes(key)),
      ) ||
      JSON.stringify(this.split.participants.map((row) => String(row.user))) !==
        JSON.stringify(shares.map((row) => row.user))
    )
      this.invalidate(
        'split',
        'Split input must use canonical participant order and method fields',
      );
    const actual = this.shares.map((row) => ({
      user: String(row.user),
      amountMinor: row.amountMinor,
    }));
    if (JSON.stringify(shares) !== JSON.stringify(actual))
      this.invalidate('shares', 'Shares must equal the exact deterministic allocation');
    if (!Number.isSafeInteger(this.__v ?? 0) || (this.__v ?? 0) < 0)
      this.invalidate('__v', 'Invalid expense version');
  } catch {
    this.invalidate('split', 'Invalid expense allocation');
  }
});
schema.index({ group: 1, expenseDate: -1, _id: -1 });
schema.index({ group: 1, cycleId: 1, expenseDate: -1, _id: -1 });
schema.index({ group: 1, creator: 1, creationKey: 1 }, { unique: true });
export const GroupExpense = mongoose.model('GroupExpense', schema);
export function persistedSplit(split) {
  return {
    method: split.method,
    participants: split.participants.map((row) => (typeof row === 'string' ? { user: row } : row)),
  };
}
const integer = {
  bsonType: ['int', 'long', 'double'],
  minimum: 1,
  maximum: Number.MAX_SAFE_INTEGER,
};
const user = { bsonType: 'objectId' };
export const groupExpenseCollectionValidator = {
  $and: [
    {
      $jsonSchema: {
        bsonType: 'object',
        additionalProperties: false,
        required: [
          '_id',
          'group',
          'creator',
          'payer',
          'title',
          'amountMinor',
          'currency',
          'category',
          'expenseDate',
          'split',
          'shares',
          'creationKey',
          'creationHash',
          'createdAt',
          'updatedAt',
          '__v',
        ],
        properties: {
          lastFinancialOperation: user,
          _id: user,
          group: user,
          cycleId: user,
          creator: user,
          payer: user,
          title: { bsonType: 'string', minLength: 1, maxLength: 200, pattern: '\\S' },
          amountMinor: integer,
          currency: { enum: ['INR'] },
          category: {
            enum: TRANSACTION_CATEGORIES.filter((row) => row.types.includes('expense')).map(
              (row) => row.id,
            ),
          },
          expenseDate: { bsonType: 'date' },
          notes: { bsonType: 'string', maxLength: 2000 },
          creationKey: { bsonType: 'string', pattern: '^[a-f0-9]{64}$' },
          creationHash: { bsonType: 'string', pattern: '^[a-f0-9]{64}$' },
          createdAt: { bsonType: 'date' },
          updatedAt: { bsonType: 'date' },
          deletedAt: { bsonType: 'date' },
          __v: { ...integer, minimum: 0 },
          shares: {
            bsonType: 'array',
            minItems: 1,
            maxItems: 100,
            items: {
              bsonType: 'object',
              additionalProperties: false,
              required: ['user', 'amountMinor'],
              properties: { user, amountMinor: integer },
            },
          },
          split: {
            bsonType: 'object',
            additionalProperties: false,
            required: ['method', 'participants'],
            properties: {
              method: { enum: ['equal', 'exact', 'percentage'] },
              participants: {
                bsonType: 'array',
                minItems: 1,
                maxItems: 100,
                items: {
                  bsonType: 'object',
                  additionalProperties: false,
                  required: ['user'],
                  properties: {
                    user,
                    amountMinor: integer,
                    basisPoints: {
                      bsonType: ['int', 'long', 'double'],
                      minimum: 1,
                      maximum: 10000,
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    {
      $expr: {
        $and: [
          { $eq: ['$amountMinor', { $trunc: '$amountMinor' }] },
          { $eq: ['$__v', { $trunc: '$__v' }] },
          { $eq: [{ $size: '$shares' }, { $size: { $setUnion: ['$shares.user', []] } }] },
          { $eq: ['$split.participants.user', '$shares.user'] },
          {
            $eq: [
              {
                $sum: {
                  $map: {
                    input: '$shares',
                    as: 's',
                    in: {
                      $convert: {
                        input: { $convert: { input: '$$s.amountMinor', to: 'long' } },
                        to: 'decimal',
                      },
                    },
                  },
                },
              },
              {
                $convert: {
                  input: { $convert: { input: '$amountMinor', to: 'long' } },
                  to: 'decimal',
                },
              },
            ],
          },
          {
            $allElementsTrue: [
              {
                $map: {
                  input: '$shares',
                  as: 's',
                  in: { $eq: ['$$s.amountMinor', { $trunc: '$$s.amountMinor' }] },
                },
              },
            ],
          },
          {
            $switch: {
              branches: [
                {
                  case: { $eq: ['$split.method', 'equal'] },
                  then: {
                    $allElementsTrue: [
                      {
                        $map: {
                          input: '$split.participants',
                          as: 'p',
                          in: {
                            $and: [
                              { $eq: [{ $type: '$$p.amountMinor' }, 'missing'] },
                              { $eq: [{ $type: '$$p.basisPoints' }, 'missing'] },
                            ],
                          },
                        },
                      },
                    ],
                  },
                },
                {
                  case: { $eq: ['$split.method', 'exact'] },
                  then: {
                    $and: [
                      { $eq: ['$split.participants.amountMinor', '$shares.amountMinor'] },
                      {
                        $allElementsTrue: [
                          {
                            $map: {
                              input: '$split.participants',
                              as: 'p',
                              in: { $eq: [{ $type: '$$p.basisPoints' }, 'missing'] },
                            },
                          },
                        ],
                      },
                    ],
                  },
                },
                {
                  case: { $eq: ['$split.method', 'percentage'] },
                  then: {
                    $and: [
                      { $eq: [{ $sum: '$split.participants.basisPoints' }, 10000] },
                      {
                        $allElementsTrue: [
                          {
                            $map: {
                              input: '$split.participants',
                              as: 'p',
                              in: {
                                $and: [
                                  { $eq: ['$$p.basisPoints', { $trunc: '$$p.basisPoints' }] },
                                  { $eq: [{ $type: '$$p.amountMinor' }, 'missing'] },
                                ],
                              },
                            },
                          },
                        ],
                      },
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
