import mongoose from 'mongoose';
import { LIFECYCLE_KINDS, assertLifecycleReceipt } from '../utils/cycle-lifecycle.js';

const reference = (ref) => ({
  type: mongoose.Schema.Types.ObjectId,
  ref,
  required: true,
  immutable: true,
});
const digest = { type: String, required: true, immutable: true, match: /^[a-f0-9]{64}$/ };
const schema = new mongoose.Schema(
  {
    group: reference('Group'),
    actor: reference('User'),
    intentKey: digest,
    requestHash: digest,
    operationHash: digest,
    kind: { type: String, required: true, immutable: true, enum: LIFECYCLE_KINDS },
    operation: { type: mongoose.Schema.Types.Mixed, required: true, immutable: true },
    cycleId: reference('GroupFinancialCycle'),
    outcome: { type: String, required: true, immutable: true, enum: ['open', 'frozen', 'closed'] },
    createdAt: { type: Date, required: true, immutable: true },
    completedAt: Date,
  },
  { strict: 'throw', versionKey: '__v' },
);
schema.pre('validate', function () {
  try {
    assertLifecycleReceipt(this);
  } catch {
    this.invalidate('operation', 'Invalid cycle transition receipt');
  }
});
schema.index({ group: 1, intentKey: 1 }, { unique: true });
export const GroupCycleTransition = mongoose.model('GroupCycleTransition', schema);
export const cycleTransitionValidator = {
  $and: [
    {
      $jsonSchema: {
        bsonType: 'object',
        additionalProperties: false,
        required: [
          '_id',
          'group',
          'actor',
          'intentKey',
          'requestHash',
          'operationHash',
          'kind',
          'operation',
          'cycleId',
          'outcome',
          'createdAt',
          '__v',
        ],
        properties: {
          ...Object.fromEntries(
            ['_id', 'group', 'actor', 'cycleId'].map((key) => [key, { bsonType: 'objectId' }]),
          ),
          ...Object.fromEntries(
            ['intentKey', 'requestHash', 'operationHash'].map((key) => [
              key,
              { bsonType: 'string', pattern: '^[a-f0-9]{64}$' },
            ]),
          ),
          kind: { enum: LIFECYCLE_KINDS },
          operation: {
            bsonType: 'object',
            additionalProperties: false,
            required: [
              '_id',
              'actor',
              'kind',
              'protocolVersion',
              'groupId',
              'cycleId',
              'cycleEpoch',
              'expectedGroupVersion',
              'expectedCycleVersion',
              'targetId',
              'phase',
              'startState',
              'createdAt',
              'payload',
              'payloadHash',
            ],
            properties: {
              ...Object.fromEntries(
                ['_id', 'actor', 'groupId', 'cycleId', 'targetId'].map((key) => [
                  key,
                  { bsonType: 'string', pattern: '^[a-f0-9]{24}$' },
                ]),
              ),
              kind: { enum: LIFECYCLE_KINDS },
              protocolVersion: { enum: [2] },
              ...Object.fromEntries(
                ['cycleEpoch', 'expectedGroupVersion', 'expectedCycleVersion'].map((key) => [
                  key,
                  {
                    bsonType: ['int', 'long', 'double'],
                    minimum: 0,
                    maximum: Number.MAX_SAFE_INTEGER,
                  },
                ]),
              ),
              phase: { enum: ['checking', 'applying'] },
              startState: { enum: ['none', 'open', 'frozen', 'closed'] },
              createdAt: { bsonType: 'string' },
              payloadHash: { bsonType: 'string', pattern: '^[a-f0-9]{64}$' },
              payload: {
                bsonType: 'object',
                additionalProperties: false,
                required: [
                  'targetId',
                  'intentKey',
                  'requestHash',
                  'outcome',
                  'effectiveAt',
                  'hadHistory',
                  'hadSettlementMarker',
                ],
                properties: {
                  targetId: { bsonType: 'string', pattern: '^[a-f0-9]{24}$' },
                  ...Object.fromEntries(
                    ['intentKey', 'requestHash'].map((key) => [
                      key,
                      { bsonType: 'string', pattern: '^[a-f0-9]{64}$' },
                    ]),
                  ),
                  outcome: { enum: ['open', 'frozen', 'closed'] },
                  effectiveAt: { bsonType: 'string' },
                  hadHistory: { bsonType: 'bool' },
                  hadSettlementMarker: { bsonType: 'bool' },
                  sequence: {
                    bsonType: ['int', 'long', 'double'],
                    minimum: 1,
                    maximum: Number.MAX_SAFE_INTEGER,
                  },
                  memberIds: {
                    bsonType: 'array',
                    minItems: 1,
                    maxItems: 100,
                    uniqueItems: true,
                    items: { bsonType: 'string', pattern: '^[a-f0-9]{24}$' },
                  },
                },
              },
            },
          },
          outcome: { enum: ['open', 'frozen', 'closed'] },
          createdAt: { bsonType: 'date' },
          completedAt: { bsonType: 'date' },
          __v: { enum: [0, 1] },
        },
      },
    },
    {
      $expr: {
        $and: [
          {
            $cond: [
              { $eq: ['$__v', 0] },
              { $eq: [{ $type: '$completedAt' }, 'missing'] },
              { $gte: ['$completedAt', '$createdAt'] },
            ],
          },
          {
            $eq: [
              '$outcome',
              {
                $switch: {
                  branches: [
                    { case: { $eq: ['$kind', 'cycle_freeze'] }, then: 'frozen' },
                    { case: { $eq: ['$kind', 'cycle_close'] }, then: 'closed' },
                  ],
                  default: 'open',
                },
              },
            ],
          },
        ],
      },
    },
  ],
};
