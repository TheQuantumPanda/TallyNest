import mongoose from 'mongoose';
import { Group } from '../models/group.model.js';
import { ownerIdSchema } from '../validators/transaction.validator.js';
import { GROUP_MEMBER_LIMIT } from '../validators/group.validator.js';
import { durableWriteOptions } from '../utils/durable-write.js';
const id = (value) => new mongoose.Types.ObjectId(ownerIdSchema.parse(String(value)));
const version = (value) => {
  if (!Number.isSafeInteger(value) || value < 0 || value >= Number.MAX_SAFE_INTEGER)
    throw new RangeError('Invalid group version');
  return value;
};
const owner = (user) => ({
  creator: id(user),
  members: { $elemMatch: { user: id(user), role: 'owner' } },
});
const options = () => ({ returnDocument: 'after', ...durableWriteOptions(), maxTimeMS: 2000 });
export function createInvitationRepository(model = Group) {
  return {
    replaceInvitationsForOwner(user, groupId, expected, invitations) {
      return model
        .findOneAndUpdate(
          { _id: id(groupId), ...owner(user), __v: version(expected) },
          { $set: { invitations }, $inc: { __v: 1 } },
          { ...options(), runValidators: true },
        )
        .exec();
    },
    revokeForOwner(user, groupId, invitationId, expected) {
      return model
        .findOneAndUpdate(
          {
            _id: id(groupId),
            ...owner(user),
            __v: version(expected),
            'invitations._id': id(invitationId),
          },
          { $set: { 'invitations.$.revokedAt': new Date() }, $inc: { __v: 1 } },
          options(),
        )
        .exec();
    },
    // A valid random token is a narrow inspection/join capability, not general member access.
    findByHash(hash) {
      if (!/^[a-f0-9]{64}$/.test(hash)) throw new TypeError('Invalid invitation hash');
      return model
        .findOne({ 'invitations.tokenHash': hash })
        .maxTimeMS(1000)
        .readConcern('majority')
        .exec();
    },
    accept(user, groupId, invitation, expected) {
      // All eligibility is rechecked at the write, including MongoDB's current UTC clock.
      const target = {
        $arrayElemAt: [
          {
            $filter: {
              input: { $ifNull: ['$invitations', []] },
              as: 'i',
              cond: { $eq: ['$$i._id', id(invitation._id)] },
            },
          },
          0,
        ],
      };
      return model
        .findOneAndUpdate(
          {
            _id: id(groupId),
            __v: version(expected),
            'members.user': { $ne: id(user) },
            [`members.${GROUP_MEMBER_LIMIT - 1}`]: { $exists: false },
            invitations: {
              $elemMatch: {
                _id: id(invitation._id),
                tokenHash: invitation.tokenHash,
                revokedAt: { $exists: false },
                'accepted.user': { $ne: id(user) },
              },
            },
            $expr: {
              $let: {
                vars: { i: target },
                in: {
                  $and: [
                    { $gt: ['$$i.expiresAt', '$$NOW'] },
                    { $lte: ['$$i.createdAt', '$$NOW'] },
                    { $lt: [{ $size: '$$i.accepted' }, '$$i.maxUses'] },
                  ],
                },
              },
            },
          },
          [
            {
              $set: {
                members: {
                  $concatArrays: [
                    '$members',
                    [{ user: id(user), role: 'member', createdAt: '$$NOW' }],
                  ],
                },
                invitations: {
                  $map: {
                    input: '$invitations',
                    as: 'i',
                    in: {
                      $cond: [
                        { $eq: ['$$i._id', id(invitation._id)] },
                        {
                          $mergeObjects: [
                            '$$i',
                            {
                              accepted: {
                                $concatArrays: [
                                  '$$i.accepted',
                                  [{ user: id(user), acceptedAt: '$$NOW' }],
                                ],
                              },
                            },
                          ],
                        },
                        '$$i',
                      ],
                    },
                  },
                },
                __v: { $add: ['$__v', 1] },
                updatedAt: '$$NOW',
              },
            },
          ],
          { ...options(), updatePipeline: true },
        )
        .exec();
    },
  };
}
export const invitationRepository = createInvitationRepository();
