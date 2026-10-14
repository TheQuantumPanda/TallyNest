import { invitationSchema, invitationArrayBson, invitationIntegrityExpression } from './invitation.model.js';
import { GROUP_INVITATION_LIMIT } from '../validators/invitation.validator.js';
import mongoose from 'mongoose';
import { groupNameSchema, groupDescriptionSchema, groupRoleSchema, GROUP_MEMBER_LIMIT } from '../validators/group.validator.js';
import { ownerIdSchema, currencySchema } from '../validators/transaction.validator.js';

function field(type, validator, options = {}) {
  return { type, set(value) { return value === undefined ? value : validator.parse(value); },
    validate: value => validator.safeParse(value).success, ...options };
}
function reference() {
  return { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true,
    set(value) { return value === undefined ? value : ownerIdSchema.parse(value instanceof mongoose.Types.ObjectId ? value.toHexString() : value); } };
}
const membershipSchema = new mongoose.Schema({
  user: reference(), role: field(String, groupRoleSchema, { required: true }),
  createdAt: { type: Date, required: true },
}, { _id: false, strict: 'throw' });
const schema = new mongoose.Schema({
  name: field(String, groupNameSchema, { required: true }), description: field(String, groupDescriptionSchema),
  currency: field(String, currencySchema, { required: true, default: 'INR' }),
  creator: { ...reference(), immutable: true },
  settlementStartedAt: { type: Date, immutable: true },
  financialOperation: { type: new mongoose.Schema({ actor: reference(), kind: { type: String, required: true, enum: ['expense_create', 'expense_update', 'expense_delete', 'settlement_create', 'settlement_confirm', 'settlement_reject'] }, payload: { type: mongoose.Schema.Types.Mixed, required: true }, createdAt: { type: Date, required: true } }, { strict: 'throw' }), default: undefined },
  financialHistoryAt: { type: Date, immutable: true },
  invitations: { type: [invitationSchema], default: undefined },
  members: { type: [membershipSchema], required: true, default: undefined },
}, { timestamps: true, strict: 'throw', optimisticConcurrency: true });
schema.pre('validate', function () {
  const members = this.members ?? [];
  const owners = members.filter(row => row.role === 'owner');
  if (members.length < 1 || members.length > GROUP_MEMBER_LIMIT ||
    new Set(members.map(row => String(row.user))).size !== members.length ||
    owners.length !== 1 || String(owners[0]?.user) !== String(this.creator)) this.invalidate('members', 'Invalid group membership');
  const invitations = this.invitations ?? [];
  if (invitations.length > GROUP_INVITATION_LIMIT || new Set(invitations.map(row => row.tokenHash)).size !== invitations.length ||
    new Set(invitations.map(row => String(row._id))).size !== invitations.length) this.invalidate('invitations', 'Invalid invitations');
  if (!Number.isSafeInteger(this.__v ?? 0) || (this.__v ?? 0) < 0) this.invalidate('__v', 'Invalid group version');
});
schema.index({ 'members.user': 1, _id: -1 });
schema.index({ 'invitations.tokenHash': 1 }, { unique: true, sparse: true });
export const Group = mongoose.model('Group', schema);

// A unique multikey index cannot reject duplicate values inside one array.
// Collection validation enforces per-document membership uniqueness instead.
export const groupCollectionValidator = {
  $and: [
    { $jsonSchema: { bsonType: 'object', required: ['name', 'currency', 'creator', 'members', 'createdAt', 'updatedAt', '__v'], additionalProperties: false,
      properties: {
        _id: { bsonType: 'objectId' }, financialHistoryAt: { bsonType: 'date' }, settlementStartedAt: { bsonType: 'date' },
        financialOperation: { bsonType: 'object', additionalProperties: false, required: ['_id', 'actor', 'kind', 'payload', 'createdAt'], properties: { _id: { bsonType: 'objectId' }, actor: { bsonType: 'objectId' }, kind: { enum: ['expense_create', 'expense_update', 'expense_delete', 'settlement_create', 'settlement_confirm', 'settlement_reject'] }, payload: { bsonType: 'object' }, createdAt: { bsonType: 'date' } } }, invitations: invitationArrayBson,
        name: { bsonType: 'string', minLength: 1, maxLength: 100, pattern: '\\S' },
        description: { bsonType: 'string', maxLength: 2000 }, currency: { enum: ['INR'] }, creator: { bsonType: 'objectId' },
        createdAt: { bsonType: 'date' }, updatedAt: { bsonType: 'date' }, __v: { bsonType: ['int', 'long', 'double'], minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
        members: { bsonType: 'array', minItems: 1, maxItems: GROUP_MEMBER_LIMIT, items: { bsonType: 'object', required: ['user', 'role', 'createdAt'], additionalProperties: false,
          properties: { user: { bsonType: 'objectId' }, role: { enum: ['owner', 'member'] }, createdAt: { bsonType: 'date' } } } },
      } } },
    { $expr: invitationIntegrityExpression },
    { $expr: { $and: [
      { $cond: [{ $eq: [{ $type: '$settlementStartedAt' }, 'missing'] }, true, { $eq: [{ $type: '$financialHistoryAt' }, 'date'] }] },
      { $cond: [{ $eq: [{ $type: '$financialOperation' }, 'missing'] }, true, { $and: [{ $eq: [{ $type: '$financialHistoryAt' }, 'date'] }, { $in: ['$financialOperation.actor', '$members.user'] }] }] },
    ] } },
    { $expr: { $let: { vars: { rows: { $cond: [{ $isArray: '$members' }, '$members', []] } }, in: {
      $and: [
        { $eq: [{ $size: '$$rows' }, { $size: { $setUnion: [{ $map: { input: '$$rows', as: 'm', in: '$$m.user' } }, []] } }] },
        { $eq: [{ $size: { $filter: { input: '$$rows', as: 'm', cond: { $eq: ['$$m.role', 'owner'] } } } }, 1] },
        { $eq: [{ $size: { $filter: { input: '$$rows', as: 'm', cond: { $and: [{ $eq: ['$$m.role', 'owner'] }, { $eq: ['$$m.user', '$creator'] }] } } } }, 1] },
        { $eq: ['$__v', { $trunc: '$__v' }] },
      ],
    } } } },
  ],
};
