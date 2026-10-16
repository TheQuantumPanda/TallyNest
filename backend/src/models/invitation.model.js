import mongoose from 'mongoose';
import {
  GROUP_INVITATION_LIMIT,
  INVITATION_USE_LIMIT,
} from '../validators/invitation.validator.js';
import { ownerIdSchema } from '../validators/transaction.validator.js';
const receiptSchema = new mongoose.Schema(
  {
    user: {
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
    },
    acceptedAt: { type: Date, required: true },
  },
  { _id: false, strict: 'throw' },
);
export const invitationSchema = new mongoose.Schema(
  {
    tokenHash: { type: String, required: true, match: /^[a-f0-9]{64}$/, immutable: true },
    createdAt: { type: Date, required: true },
    expiresAt: { type: Date, required: true },
    maxUses: {
      type: Number,
      required: true,
      min: 1,
      max: INVITATION_USE_LIMIT,
      validate: Number.isInteger,
    },
    revokedAt: { type: Date },
    accepted: { type: [receiptSchema], default: [] },
  },
  { strict: 'throw' },
);
invitationSchema.pre('validate', function () {
  if (
    !(this.expiresAt > this.createdAt) ||
    this.expiresAt - this.createdAt > 7 * 86400000 ||
    this.accepted.length > this.maxUses ||
    new Set(this.accepted.map((row) => String(row.user))).size !== this.accepted.length ||
    this.accepted.some((row) => row.acceptedAt < this.createdAt || row.acceptedAt >= this.expiresAt)
  )
    this.invalidate('accepted', 'Invalid invitation state');
});
export const invitationBsonProperties = {
  _id: { bsonType: 'objectId' },
  tokenHash: { bsonType: 'string', pattern: '^[a-f0-9]{64}$' },
  createdAt: { bsonType: 'date' },
  expiresAt: { bsonType: 'date' },
  revokedAt: { bsonType: 'date' },
  maxUses: { bsonType: ['int', 'long', 'double'], minimum: 1, maximum: INVITATION_USE_LIMIT },
  accepted: {
    bsonType: 'array',
    maxItems: INVITATION_USE_LIMIT,
    items: {
      bsonType: 'object',
      required: ['user', 'acceptedAt'],
      additionalProperties: false,
      properties: { user: { bsonType: 'objectId' }, acceptedAt: { bsonType: 'date' } },
    },
  },
};
export const invitationArrayBson = {
  bsonType: 'array',
  maxItems: GROUP_INVITATION_LIMIT,
  items: {
    bsonType: 'object',
    additionalProperties: false,
    required: ['_id', 'tokenHash', 'createdAt', 'expiresAt', 'maxUses', 'accepted'],
    properties: invitationBsonProperties,
  },
};
// Safe on legacy groups where invitations is absent. No TTL index on an embedded date:
// it would delete the entire containing group instead of an expired invitation.
export const invitationIntegrityExpression = {
  $let: {
    vars: { invites: { $ifNull: ['$invitations', []] } },
    in: {
      $and: [
        { $eq: [{ $size: '$$invites' }, { $size: { $setUnion: ['$$invites._id', []] } }] },
        { $eq: [{ $size: '$$invites' }, { $size: { $setUnion: ['$$invites.tokenHash', []] } }] },
        {
          $allElementsTrue: [
            {
              $map: {
                input: '$$invites',
                as: 'i',
                in: {
                  $and: [
                    { $gt: ['$$i.expiresAt', '$$i.createdAt'] },
                    { $lte: [{ $subtract: ['$$i.expiresAt', '$$i.createdAt'] }, 7 * 86400000] },
                    { $eq: ['$$i.maxUses', { $trunc: '$$i.maxUses' }] },
                    { $lte: [{ $size: '$$i.accepted' }, '$$i.maxUses'] },
                    {
                      $eq: [
                        { $size: '$$i.accepted' },
                        { $size: { $setUnion: ['$$i.accepted.user', []] } },
                      ],
                    },
                    {
                      $allElementsTrue: [
                        {
                          $map: {
                            input: '$$i.accepted',
                            as: 'r',
                            in: {
                              $and: [
                                { $gte: ['$$r.acceptedAt', '$$i.createdAt'] },
                                { $lt: ['$$r.acceptedAt', '$$i.expiresAt'] },
                              ],
                            },
                          },
                        },
                      ],
                    },
                  ],
                },
              },
            },
          ],
        },
      ],
    },
  },
};
