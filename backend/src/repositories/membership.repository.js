import mongoose from 'mongoose';
import { Group } from '../models/group.model.js';
import { User } from '../models/user.model.js';
import { ownerIdSchema } from '../validators/transaction.validator.js';
import { durableWriteOptions } from '../utils/durable-write.js';
const id = value => new mongoose.Types.ObjectId(ownerIdSchema.parse(String(value)));
export function createMembershipRepository(model = Group, users = User) {
  return {
    publicProfiles(ids) {
      if (!Array.isArray(ids) || ids.length > 100) throw new TypeError('Invalid membership list');
      return users.find({ _id: { $in: ids.map(id) } }).select('_id name').limit(100).maxTimeMS(1000).lean().exec();
    },
    remove(user, groupId, target, expected, leaving = false) {
      if (!Number.isSafeInteger(expected) || expected < 0 || expected >= Number.MAX_SAFE_INTEGER) throw new RangeError('Invalid group version');
      if (leaving && String(user) !== String(target)) throw new TypeError('Invalid leaving identity');
      const actor = leaving ? { members: { $elemMatch: { user: id(user), role: 'member' } } }
        : { creator: id(user), members: { $elemMatch: { user: id(user), role: 'owner' } } };
      return model.findOneAndUpdate({ _id: id(groupId), ...actor, __v: expected, financialHistoryAt: { $exists: false },
        'members.user': id(target), creator: leaving ? { $ne: id(user) } : id(user),
        $and: [{ members: { $elemMatch: { user: id(target), role: 'member' } } }],
      }, { $pull: { members: { user: id(target), role: 'member' } }, $inc: { __v: 1 } },
      { returnDocument: 'after', ...durableWriteOptions(), maxTimeMS: 2000 }).exec();
    },
  };
}
export const membershipRepository = createMembershipRepository();
