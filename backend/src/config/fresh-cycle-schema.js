import { isDeepStrictEqual } from 'node:util';
import { User } from '../models/user.model.js';
import { Transaction } from '../models/transaction.model.js';
import { Budget } from '../models/budget.model.js';
import { RecurringSchedule } from '../models/recurring.model.js';
import { Group, groupCollectionValidator } from '../models/group.model.js';
import { GroupExpense, groupExpenseCollectionValidator } from '../models/group-expense.model.js';
import {
  GroupSettlement,
  settlementCollectionValidator,
} from '../models/group-settlement.model.js';
import {
  GroupFinancialCycle,
  groupFinancialCycleCollectionValidator,
} from '../models/group-financial-cycle.model.js';
import {
  GroupCycleTransition,
  cycleTransitionValidator,
} from '../models/group-cycle-transition.model.js';
import { TRANSACTION_CATEGORIES } from '../constants/transaction.constants.js';

export const FRESH_PROFILE = 'fresh-cycle-v2';
export const FRESH_PROFILE_VERSION = 1;
export const FRESH_MANIFEST_COLLECTION = 'freshschemamanifests';
export const FRESH_MANIFEST_ID = 'tallynest-fresh-cycle-v2';

const oid = { bsonType: 'objectId' };
const date = { bsonType: 'date' };
const minor = { bsonType: ['int', 'long', 'double'], minimum: 1, maximum: Number.MAX_SAFE_INTEGER };
const digest = { bsonType: 'string', pattern: '^[a-f0-9]{64}$' };
const categories = (type) =>
  TRANSACTION_CATEGORIES.filter((item) => item.types.includes(type)).map((item) => item.id);
const common = {
  _id: oid,
  createdAt: date,
  updatedAt: date,
  __v: { bsonType: ['int', 'long', 'double'], minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
};
const validator = (required, properties, amount = false) => ({
  $and: [
    { $jsonSchema: { bsonType: 'object', additionalProperties: false, required, properties } },
    ...(amount ? [{ $expr: { $eq: ['$amountMinor', { $trunc: '$amountMinor' }] } }] : []),
  ],
});

const userValidator = validator(
  ['_id', 'name', 'email', 'passwordHash', 'createdAt', 'updatedAt'],
  {
    ...common,
    name: { bsonType: 'string', minLength: 1, maxLength: 100 },
    email: { bsonType: 'string', maxLength: 254 },
    passwordHash: { bsonType: 'string', pattern: '^\\$2[ab]\\$12\\$[./A-Za-z0-9]{53}$' },
  },
);
const receipt = { creationKey: digest, creationHash: digest };
const transactionValidator = validator(
  [
    '_id',
    'owner',
    'type',
    'title',
    'amountMinor',
    'currency',
    'category',
    'transactionDate',
    'createdAt',
    'updatedAt',
  ],
  {
    ...common,
    ...receipt,
    owner: oid,
    type: { enum: ['income', 'expense'] },
    title: { bsonType: 'string', minLength: 1, maxLength: 200 },
    amountMinor: minor,
    currency: { enum: ['INR'] },
    category: { enum: TRANSACTION_CATEGORIES.map((item) => item.id) },
    transactionDate: date,
    recurringSchedule: oid,
    scheduledDate: date,
    deletedAt: date,
    notes: { bsonType: 'string', maxLength: 2000 },
  },
  true,
);
const budgetValidator = validator(
  ['_id', 'owner', 'category', 'currency', 'amountMinor', 'month', 'createdAt', 'updatedAt'],
  {
    ...common,
    owner: oid,
    category: { enum: categories('expense') },
    currency: { enum: ['INR'] },
    amountMinor: minor,
    month: { bsonType: 'string', pattern: '^\\d{4}-(0[1-9]|1[0-2])$' },
  },
  true,
);
const recurringValidator = validator(
  [
    '_id',
    'owner',
    'type',
    'title',
    'amountMinor',
    'currency',
    'category',
    'frequency',
    'status',
    'startDate',
    'occurrenceNumber',
    'createdAt',
    'updatedAt',
  ],
  {
    ...common,
    ...receipt,
    owner: oid,
    type: { enum: ['income', 'expense'] },
    title: { bsonType: 'string', minLength: 1, maxLength: 200 },
    amountMinor: minor,
    currency: { enum: ['INR'] },
    category: { enum: TRANSACTION_CATEGORIES.map((item) => item.id) },
    frequency: { enum: ['daily', 'weekly', 'monthly', 'yearly'] },
    status: { enum: ['active', 'paused'] },
    startDate: date,
    endDate: date,
    nextOccurrenceDate: { bsonType: ['date', 'null'] },
    lastOccurrenceDate: { bsonType: ['date', 'null'] },
    deletedAt: date,
    notes: { bsonType: 'string', maxLength: 2000 },
    occurrenceNumber: {
      bsonType: ['int', 'long', 'double'],
      minimum: 0,
      maximum: Number.MAX_SAFE_INTEGER,
    },
    pending: {
      bsonType: 'object',
      required: ['date', 'transactionId'],
      additionalProperties: false,
      properties: { date, transactionId: oid },
    },
  },
  true,
);

// The mixed migration profile remains unchanged. Fresh installs require v2 on every group.
export const freshGroupValidator = {
  $and: [
    groupCollectionValidator,
    {
      $jsonSchema: {
        required: ['financialProtocolVersion', 'cycleEpoch'],
        properties: { financialProtocolVersion: { enum: [2] } },
      },
    },
    {
      $expr: {
        $and: [
          { $eq: [{ $type: '$cycleMigration' }, 'missing'] },
          {
            $cond: [
              { $eq: [{ $type: '$currentCycleId' }, 'missing'] },
              {
                $and: [
                  { $eq: [{ $type: '$currentCycleState' }, 'missing'] },
                  { $eq: ['$cycleEpoch', 0] },
                ],
              },
              {
                $and: [
                  { $in: ['$currentCycleState', ['open', 'frozen', 'closed']] },
                  { $gte: ['$cycleEpoch', 1] },
                  { $eq: [{ $type: '$financialHistoryAt' }, 'date'] },
                ],
              },
            ],
          },
        ],
      },
    },
  ],
};
const requireCycle = (base) => ({ $and: [base, { $jsonSchema: { required: ['cycleId'] } }] });

export const freshCollections = [
  [User, userValidator],
  [Transaction, transactionValidator],
  [Budget, budgetValidator],
  [RecurringSchedule, recurringValidator],
  [Group, freshGroupValidator],
  [GroupFinancialCycle, groupFinancialCycleCollectionValidator],
  [GroupExpense, requireCycle(groupExpenseCollectionValidator)],
  [GroupSettlement, requireCycle(settlementCollectionValidator)],
  [GroupCycleTransition, cycleTransitionValidator],
].map(([model, definition]) => ({
  name: model.collection.name,
  definition,
  indexes: model.schema.indexes(),
}));

export const manifestValidator = {
  $jsonSchema: {
    bsonType: 'object',
    additionalProperties: false,
    required: ['_id', 'profile', 'version', 'state', 'checkpoint'],
    properties: {
      _id: { enum: [FRESH_MANIFEST_ID] },
      profile: { enum: [FRESH_PROFILE] },
      version: { enum: [FRESH_PROFILE_VERSION] },
      state: { enum: ['initializing', 'ready'] },
      checkpoint: { bsonType: ['int', 'long'], minimum: 0, maximum: freshCollections.length },
    },
  },
};

export function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, canonical(item)]),
    );
  return value;
}
export const sameDefinition = (left, right) => isDeepStrictEqual(canonical(left), canonical(right));

export function indexMatches(actual, [key, options]) {
  return (
    JSON.stringify(actual.key) === JSON.stringify(key) &&
    !!actual.unique === !!options.unique &&
    !!actual.sparse === !!options.sparse &&
    sameDefinition(actual.partialFilterExpression ?? {}, options.partialFilterExpression ?? {}) &&
    sameDefinition(actual.collation ?? {}, options.collation ?? {}) &&
    actual.expireAfterSeconds === undefined
  );
}
