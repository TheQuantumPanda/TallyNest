import mongoose from 'mongoose';
import { ownerIdSchema } from '../validators/transaction.validator.js';
import { CYCLE_STATUSES, sortedCycleMembers } from '../utils/group-financial-cycle.js';

const objectId = (value) =>
  value === undefined
    ? value
    : ownerIdSchema.parse(value instanceof mongoose.Types.ObjectId ? String(value) : value);
const reference = (ref, required = true) => ({
  type: mongoose.Schema.Types.ObjectId,
  ...(ref ? { ref } : {}),
  required,
  immutable: true,
  set: objectId,
});
const schema = new mongoose.Schema(
  {
    group: reference('Group'),
    sequence: {
      type: Number,
      required: true,
      immutable: true,
      validate: (value) => Number.isSafeInteger(value) && value > 0,
    },
    previousCycleId: reference('GroupFinancialCycle', false),
    migrationVersion: { type: Number, enum: [1], immutable: true },
    migrationRunId: reference(undefined, false),
    currency: { type: String, required: true, immutable: true, enum: ['INR'] },
    status: { type: String, required: true, enum: CYCLE_STATUSES },
    activeSlot: { type: Boolean, default: undefined },
    memberIds: { type: [reference('User')], required: true, immutable: true, default: undefined },
    openedAt: { type: Date, required: true, immutable: true },
    frozenAt: { type: Date, immutable: true },
    closedAt: { type: Date, immutable: true },
    openOperationId: reference(undefined),
    freezeOperationId: reference(undefined, false),
    closeOperationId: reference(undefined, false),
  },
  { timestamps: true, strict: 'throw', optimisticConcurrency: true },
);

schema.pre('validate', function () {
  const members = this.memberIds ?? [];
  if (
    (this.migrationVersion === undefined) !== (this.migrationRunId === undefined) ||
    (this.migrationVersion !== undefined && this.sequence !== 1)
  )
    this.invalidate('migrationVersion', 'Invalid cycle migration provenance');
  try {
    if (members.map(String).join(',') !== sortedCycleMembers(members).join(','))
      this.invalidate('memberIds', 'Cycle members must be unique and sorted');
  } catch {
    this.invalidate('memberIds', 'Invalid cycle membership snapshot');
  }
  if (this.sequence === 1 ? this.previousCycleId != null : this.previousCycleId == null)
    this.invalidate('previousCycleId', 'Invalid previous cycle');
  if (
    (this.status === 'closed' && this.activeSlot !== undefined) ||
    (this.status !== 'closed' && this.activeSlot !== true)
  )
    this.invalidate('activeSlot', 'Invalid active cycle slot');
  if (
    (this.status === 'open' &&
      (this.frozenAt || this.closedAt || this.freezeOperationId || this.closeOperationId)) ||
    (this.status === 'frozen' &&
      (!this.frozenAt || !this.freezeOperationId || this.closedAt || this.closeOperationId)) ||
    (this.status === 'closed' &&
      (!this.frozenAt || !this.freezeOperationId || !this.closedAt || !this.closeOperationId)) ||
    (this.frozenAt && this.frozenAt < this.openedAt) ||
    (this.closedAt && this.closedAt < this.frozenAt)
  )
    this.invalidate('status', 'Invalid cycle transition state');
  if (!Number.isSafeInteger(this.__v ?? 0) || (this.__v ?? 0) < 0)
    this.invalidate('__v', 'Invalid cycle version');
});

schema.index({ group: 1, sequence: 1 }, { unique: true });
schema.index({ group: 1 }, { unique: true, partialFilterExpression: { activeSlot: true } });
schema.index({ group: 1, sequence: -1, _id: -1 });
export const GroupFinancialCycle = mongoose.model('GroupFinancialCycle', schema);

const objectIdBson = { bsonType: 'objectId' };
const dateBson = { bsonType: 'date' };
const integerBson = {
  bsonType: ['int', 'long', 'double'],
  minimum: 0,
  maximum: Number.MAX_SAFE_INTEGER,
};
export const groupFinancialCycleCollectionValidator = {
  $and: [
    {
      $jsonSchema: {
        bsonType: 'object',
        additionalProperties: false,
        required: [
          '_id',
          'group',
          'sequence',
          'currency',
          'status',
          'memberIds',
          'openedAt',
          'openOperationId',
          'createdAt',
          'updatedAt',
          '__v',
        ],
        properties: {
          _id: objectIdBson,
          group: objectIdBson,
          sequence: { ...integerBson, minimum: 1 },
          previousCycleId: objectIdBson,
          migrationVersion: { enum: [1] },
          migrationRunId: objectIdBson,
          currency: { enum: ['INR'] },
          status: { enum: CYCLE_STATUSES },
          activeSlot: { enum: [true] },
          memberIds: { bsonType: 'array', minItems: 1, maxItems: 100, items: objectIdBson },
          openedAt: dateBson,
          frozenAt: dateBson,
          closedAt: dateBson,
          openOperationId: objectIdBson,
          freezeOperationId: objectIdBson,
          closeOperationId: objectIdBson,
          createdAt: dateBson,
          updatedAt: dateBson,
          __v: integerBson,
        },
      },
    },
    {
      $expr: {
        $and: [
          {
            $or: [
              {
                $and: [
                  { $eq: [{ $type: '$migrationVersion' }, 'missing'] },
                  { $eq: [{ $type: '$migrationRunId' }, 'missing'] },
                ],
              },
              {
                $and: [
                  { $eq: ['$migrationVersion', 1] },
                  { $eq: [{ $type: '$migrationRunId' }, 'objectId'] },
                  { $eq: ['$sequence', 1] },
                ],
              },
            ],
          },
          { $eq: ['$sequence', { $trunc: '$sequence' }] },
          { $eq: ['$__v', { $trunc: '$__v' }] },
          { $eq: [{ $eq: ['$sequence', 1] }, { $eq: [{ $type: '$previousCycleId' }, 'missing'] }] },
          { $eq: ['$memberIds', { $sortArray: { input: '$memberIds', sortBy: 1 } }] },
          { $eq: [{ $size: '$memberIds' }, { $size: { $setUnion: ['$memberIds', []] } }] },
          { $gte: ['$updatedAt', '$createdAt'] },
          {
            $switch: {
              branches: [
                {
                  case: { $eq: ['$status', 'open'] },
                  then: {
                    $and: [
                      { $eq: ['$activeSlot', true] },
                      ...['frozenAt', 'closedAt', 'freezeOperationId', 'closeOperationId'].map(
                        (key) => ({ $eq: [{ $type: `$${key}` }, 'missing'] }),
                      ),
                    ],
                  },
                },
                {
                  case: { $eq: ['$status', 'frozen'] },
                  then: {
                    $and: [
                      { $eq: ['$activeSlot', true] },
                      { $gte: ['$frozenAt', '$openedAt'] },
                      { $eq: [{ $type: '$freezeOperationId' }, 'objectId'] },
                      { $eq: [{ $type: '$closedAt' }, 'missing'] },
                      { $eq: [{ $type: '$closeOperationId' }, 'missing'] },
                    ],
                  },
                },
                {
                  case: { $eq: ['$status', 'closed'] },
                  then: {
                    $and: [
                      { $eq: [{ $type: '$activeSlot' }, 'missing'] },
                      { $gte: ['$frozenAt', '$openedAt'] },
                      { $gte: ['$closedAt', '$frozenAt'] },
                      { $eq: [{ $type: '$freezeOperationId' }, 'objectId'] },
                      { $eq: [{ $type: '$closeOperationId' }, 'objectId'] },
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
