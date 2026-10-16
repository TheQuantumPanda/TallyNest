import {
  invitationSchema,
  invitationArrayBson,
  invitationIntegrityExpression,
} from './invitation.model.js';
import { GROUP_INVITATION_LIMIT } from '../validators/invitation.validator.js';
import mongoose from 'mongoose';
import {
  groupNameSchema,
  groupDescriptionSchema,
  groupRoleSchema,
  GROUP_MEMBER_LIMIT,
} from '../validators/group.validator.js';
import { ownerIdSchema, currencySchema } from '../validators/transaction.validator.js';

function field(type, validator, options = {}) {
  return {
    type,
    set(value) {
      return value === undefined ? value : validator.parse(value);
    },
    validate: (value) => validator.safeParse(value).success,
    ...options,
  };
}
function reference() {
  return {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    set(value) {
      return value === undefined
        ? value
        : ownerIdSchema.parse(
            value instanceof mongoose.Types.ObjectId ? value.toHexString() : value,
          );
    },
  };
}
const membershipSchema = new mongoose.Schema(
  {
    user: reference(),
    role: field(String, groupRoleSchema, { required: true }),
    createdAt: { type: Date, required: true },
  },
  { _id: false, strict: 'throw' },
);
const schema = new mongoose.Schema(
  {
    name: field(String, groupNameSchema, { required: true }),
    description: field(String, groupDescriptionSchema),
    currency: field(String, currencySchema, { required: true, default: 'INR' }),
    creator: { ...reference(), immutable: true },
    settlementStartedAt: { type: Date, immutable: true },
    // Reserved for the future cycle write protocol; absent on legacy groups.
    currentCycleId: { type: mongoose.Schema.Types.ObjectId, ref: 'GroupFinancialCycle' },
    cycleEpoch: {
      type: Number,
      validate: (value) => Number.isSafeInteger(value) && value >= 0,
    },
    currentCycleState: { type: String, enum: ['open', 'frozen', 'closed'] },
    financialProtocolVersion: {
      type: Number,
      validate: (value) => Number.isSafeInteger(value) && value >= 2,
    },
    financialOperation: {
      type: new mongoose.Schema(
        {
          actor: reference(),
          // Absent on durable legacy reservations. Version 2 is internal only.
          protocolVersion: { type: Number, enum: [2], immutable: true },
          groupId: { type: mongoose.Schema.Types.ObjectId, ref: 'Group', immutable: true },
          cycleId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'GroupFinancialCycle',
            immutable: true,
          },
          cycleEpoch: { type: Number, immutable: true },
          expectedGroupVersion: { type: Number, immutable: true },
          expectedCycleVersion: { type: Number, immutable: true },
          targetId: { type: mongoose.Schema.Types.ObjectId, immutable: true },
          payloadHash: { type: String, immutable: true, match: /^[a-f0-9]{64}$/ },
          phase: { type: String, enum: ['checking', 'applying'] },
          startState: { type: String, enum: ['open', 'frozen'], immutable: true },
          kind: {
            type: String,
            required: true,
            enum: [
              'expense_create',
              'expense_update',
              'expense_delete',
              'settlement_create',
              'settlement_confirm',
              'settlement_reject',
            ],
          },
          payload: { type: mongoose.Schema.Types.Mixed, required: true },
          createdAt: { type: Date, required: true },
        },
        { strict: 'throw' },
      ),
      default: undefined,
    },
    financialHistoryAt: { type: Date, immutable: true },
    invitations: { type: [invitationSchema], default: undefined },
    members: { type: [membershipSchema], required: true, default: undefined },
  },
  { timestamps: true, strict: 'throw', optimisticConcurrency: true },
);
schema.pre('validate', function () {
  const members = this.members ?? [];
  const owners = members.filter((row) => row.role === 'owner');
  if (
    members.length < 1 ||
    members.length > GROUP_MEMBER_LIMIT ||
    new Set(members.map((row) => String(row.user))).size !== members.length ||
    owners.length !== 1 ||
    String(owners[0]?.user) !== String(this.creator)
  )
    this.invalidate('members', 'Invalid group membership');
  const invitations = this.invitations ?? [];
  if (
    invitations.length > GROUP_INVITATION_LIMIT ||
    new Set(invitations.map((row) => row.tokenHash)).size !== invitations.length ||
    new Set(invitations.map((row) => String(row._id))).size !== invitations.length
  )
    this.invalidate('invitations', 'Invalid invitations');
  if (!Number.isSafeInteger(this.__v ?? 0) || (this.__v ?? 0) < 0)
    this.invalidate('__v', 'Invalid group version');
  const op = this.financialOperation;
  if (
    op?.protocolVersion === 2 &&
    (this.financialProtocolVersion !== 2 ||
      String(op.groupId) !== String(this._id) ||
      String(op.cycleId) !== String(this.currentCycleId) ||
      op.cycleEpoch !== this.cycleEpoch ||
      !['checking', 'applying'].includes(op.phase) ||
      !['open', 'frozen'].includes(op.startState) ||
      !Number.isSafeInteger(op.expectedGroupVersion) ||
      !Number.isSafeInteger(op.expectedCycleVersion) ||
      !op.targetId ||
      !op.payloadHash)
  )
    this.invalidate('financialOperation', 'Invalid cycle financial reservation');
});
schema.index({ 'members.user': 1, _id: -1 });
schema.index({ 'invitations.tokenHash': 1 }, { unique: true, sparse: true });
export const Group = mongoose.model('Group', schema);

// A unique multikey index cannot reject duplicate values inside one array.
// Collection validation enforces per-document membership uniqueness instead.
export const groupCollectionValidator = {
  $and: [
    {
      $jsonSchema: {
        bsonType: 'object',
        required: ['name', 'currency', 'creator', 'members', 'createdAt', 'updatedAt', '__v'],
        additionalProperties: false,
        properties: {
          _id: { bsonType: 'objectId' },
          financialHistoryAt: { bsonType: 'date' },
          settlementStartedAt: { bsonType: 'date' },
          currentCycleId: { bsonType: 'objectId' },
          cycleEpoch: {
            bsonType: ['int', 'long', 'double'],
            minimum: 0,
            maximum: Number.MAX_SAFE_INTEGER,
          },
          currentCycleState: { enum: ['open', 'frozen', 'closed'] },
          financialProtocolVersion: {
            bsonType: ['int', 'long', 'double'],
            minimum: 2,
            maximum: Number.MAX_SAFE_INTEGER,
          },
          financialOperation: {
            bsonType: 'object',
            additionalProperties: false,
            required: ['_id', 'actor', 'kind', 'payload', 'createdAt'],
            properties: {
              _id: { bsonType: 'objectId' },
              actor: { bsonType: 'objectId' },
              protocolVersion: { enum: [2] },
              groupId: { bsonType: 'objectId' },
              cycleId: { bsonType: 'objectId' },
              cycleEpoch: {
                bsonType: ['int', 'long', 'double'],
                minimum: 0,
                maximum: Number.MAX_SAFE_INTEGER,
              },
              expectedGroupVersion: {
                bsonType: ['int', 'long', 'double'],
                minimum: 0,
                maximum: Number.MAX_SAFE_INTEGER,
              },
              expectedCycleVersion: {
                bsonType: ['int', 'long', 'double'],
                minimum: 0,
                maximum: Number.MAX_SAFE_INTEGER,
              },
              targetId: { bsonType: 'objectId' },
              payloadHash: { bsonType: 'string', pattern: '^[a-f0-9]{64}$' },
              phase: { enum: ['checking', 'applying'] },
              startState: { enum: ['open', 'frozen'] },
              kind: {
                enum: [
                  'expense_create',
                  'expense_update',
                  'expense_delete',
                  'settlement_create',
                  'settlement_confirm',
                  'settlement_reject',
                ],
              },
              payload: { bsonType: 'object' },
              createdAt: { bsonType: 'date' },
            },
          },
          invitations: invitationArrayBson,
          name: { bsonType: 'string', minLength: 1, maxLength: 100, pattern: '\\S' },
          description: { bsonType: 'string', maxLength: 2000 },
          currency: { enum: ['INR'] },
          creator: { bsonType: 'objectId' },
          createdAt: { bsonType: 'date' },
          updatedAt: { bsonType: 'date' },
          __v: {
            bsonType: ['int', 'long', 'double'],
            minimum: 0,
            maximum: Number.MAX_SAFE_INTEGER,
          },
          members: {
            bsonType: 'array',
            minItems: 1,
            maxItems: GROUP_MEMBER_LIMIT,
            items: {
              bsonType: 'object',
              required: ['user', 'role', 'createdAt'],
              additionalProperties: false,
              properties: {
                user: { bsonType: 'objectId' },
                role: { enum: ['owner', 'member'] },
                createdAt: { bsonType: 'date' },
              },
            },
          },
        },
      },
    },
    { $expr: invitationIntegrityExpression },
    {
      $expr: {
        $and: [
          {
            $cond: [
              { $eq: [{ $type: '$settlementStartedAt' }, 'missing'] },
              true,
              { $eq: [{ $type: '$financialHistoryAt' }, 'date'] },
            ],
          },
          {
            $cond: [
              { $eq: [{ $type: '$financialOperation' }, 'missing'] },
              true,
              {
                $and: [
                  { $eq: [{ $type: '$financialHistoryAt' }, 'date'] },
                  { $in: ['$financialOperation.actor', '$members.user'] },
                  {
                    $cond: [
                      { $eq: [{ $type: '$financialOperation.protocolVersion' }, 'missing'] },
                      { $eq: [{ $type: '$financialProtocolVersion' }, 'missing'] },
                      {
                        $and: [
                          { $eq: ['$financialOperation.protocolVersion', 2] },
                          { $eq: ['$financialProtocolVersion', 2] },
                          { $eq: ['$financialOperation.groupId', '$_id'] },
                          { $eq: ['$financialOperation.cycleId', '$currentCycleId'] },
                          { $eq: ['$financialOperation.cycleEpoch', '$cycleEpoch'] },
                          { $in: ['$financialOperation.phase', ['checking', 'applying']] },
                          { $in: ['$financialOperation.startState', ['open', 'frozen']] },
                          ...['groupId', 'cycleId', 'targetId'].map((key) => ({
                            $eq: [{ $type: `$financialOperation.${key}` }, 'objectId'],
                          })),
                          ...['cycleEpoch', 'expectedGroupVersion', 'expectedCycleVersion'].map(
                            (key) => ({
                              $eq: [
                                `$financialOperation.${key}`,
                                { $trunc: `$financialOperation.${key}` },
                              ],
                            }),
                          ),
                          { $eq: [{ $type: '$financialOperation.payloadHash' }, 'string'] },
                        ],
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    },
    {
      $expr: {
        $let: {
          vars: { rows: { $cond: [{ $isArray: '$members' }, '$members', []] } },
          in: {
            $and: [
              {
                $eq: [
                  { $size: '$$rows' },
                  {
                    $size: {
                      $setUnion: [{ $map: { input: '$$rows', as: 'm', in: '$$m.user' } }, []],
                    },
                  },
                ],
              },
              {
                $eq: [
                  {
                    $size: {
                      $filter: { input: '$$rows', as: 'm', cond: { $eq: ['$$m.role', 'owner'] } },
                    },
                  },
                  1,
                ],
              },
              {
                $eq: [
                  {
                    $size: {
                      $filter: {
                        input: '$$rows',
                        as: 'm',
                        cond: {
                          $and: [{ $eq: ['$$m.role', 'owner'] }, { $eq: ['$$m.user', '$creator'] }],
                        },
                      },
                    },
                  },
                  1,
                ],
              },
              { $eq: ['$__v', { $trunc: '$__v' }] },
              {
                $and: ['cycleEpoch', 'financialProtocolVersion'].map((key) => ({
                  $cond: [
                    { $eq: [{ $type: `$${key}` }, 'missing'] },
                    true,
                    { $eq: [`$${key}`, { $trunc: `$${key}` }] },
                  ],
                })),
              },
            ],
          },
        },
      },
    },
  ],
};
