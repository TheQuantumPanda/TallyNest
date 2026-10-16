import mongoose from 'mongoose';
import { Group, groupCollectionValidator } from '../models/group.model.js';
import { ownerIdSchema } from '../validators/transaction.validator.js';
import { groupInputSchema, groupPageSchema } from '../validators/group.validator.js';
import { durableWriteOptions } from '../utils/durable-write.js';
const objectId = (value) =>
  ownerIdSchema.parse(value instanceof mongoose.Types.ObjectId ? value.toHexString() : value);
const memberFilter = (user) => ({ 'members.user': objectId(user) });
const ownerFilter = (user) => ({
  creator: objectId(user),
  members: { $elemMatch: { user: objectId(user), role: 'owner' } },
});
export function createGroupRepository(model = Group) {
  return {
    async createForOwner(user, input) {
      const creator = objectId(user);
      // One validated insert: group and initial owner membership share commit outcome.
      const document = new model({
        ...groupInputSchema.parse(input),
        creator,
        __v: 0,
        members: [{ user: creator, role: 'owner', createdAt: new Date() }],
      });
      await document.validate();
      return document.save(durableWriteOptions());
    },
    findByIdForMember(user, id) {
      return model
        .findOne({ _id: objectId(id), ...memberFilter(user) })
        .maxTimeMS(1000)
        .exec();
    },
    findPageForMember(user, input) {
      const { limit, after } = groupPageSchema.parse(input);
      return model
        .find({ ...memberFilter(user), ...(after ? { _id: { $lt: objectId(after) } } : {}) })
        .sort({ _id: -1 })
        .limit(limit + 1)
        .maxTimeMS(1000)
        .exec();
    },
    async replaceForOwner(user, id, version, input) {
      if (!Number.isSafeInteger(version) || version < 0 || version >= Number.MAX_SAFE_INTEGER)
        throw new RangeError('Invalid group version');
      const data = groupInputSchema.parse(input);
      return model
        .findOneAndUpdate(
          { _id: objectId(id), ...ownerFilter(user), __v: version },
          {
            $set: {
              name: data.name,
              currency: data.currency,
              ...(data.description !== undefined ? { description: data.description } : {}),
            },
            ...(data.description === undefined ? { $unset: { description: 1 } } : {}),
            $inc: { __v: 1 },
          },
          {
            returnDocument: 'after',
            runValidators: true,
            ...durableWriteOptions(),
            maxTimeMS: 2000,
          },
        )
        .exec();
    },
    lockHistoryForMember(user, id, expected, identities) {
      if (
        !Number.isSafeInteger(expected) ||
        expected < 0 ||
        expected >= Number.MAX_SAFE_INTEGER ||
        !Array.isArray(identities) ||
        identities.length > 102
      )
        throw new RangeError('Invalid history lock');
      return model
        .findOneAndUpdate(
          {
            _id: objectId(id),
            ...memberFilter(user),
            __v: expected,
            currency: 'INR',
            financialHistoryAt: { $exists: false },
            financialProtocolVersion: { $exists: false },
            $and: identities.map((value) => ({ 'members.user': objectId(value) })),
          },
          { $set: { financialHistoryAt: new Date() }, $inc: { __v: 1 } },
          {
            returnDocument: 'after',
            overwriteImmutable: true,
            ...durableWriteOptions(),
            maxTimeMS: 2000,
          },
        )
        .exec();
    },
    reserveFinancial(user, id, expected, op) {
      if (
        !Number.isSafeInteger(expected) ||
        expected >= Number.MAX_SAFE_INTEGER - 4 ||
        expected < 0
      )
        throw new RangeError('Invalid financial reservation version');
      return model
        .findOneAndUpdate(
          {
            _id: objectId(id),
            ...memberFilter(user),
            __v: expected,
            financialHistoryAt: { $exists: true },
            financialProtocolVersion: { $exists: false },
            financialOperation: { $exists: false },
            ...(op.kind.startsWith('expense_') ? { settlementStartedAt: { $exists: false } } : {}),
          },
          { $set: { financialOperation: op }, $inc: { __v: 1 } },
          { returnDocument: 'after', ...durableWriteOptions(), maxTimeMS: 2000 },
        )
        .exec();
    },
    beginSettlementMode(id, opId) {
      return model
        .findOneAndUpdate(
          {
            _id: objectId(id),
            'financialOperation._id': objectId(opId),
            financialProtocolVersion: { $exists: false },
            settlementStartedAt: { $exists: false },
          },
          { $set: { settlementStartedAt: new Date() } },
          {
            returnDocument: 'after',
            overwriteImmutable: true,
            ...durableWriteOptions(),
            maxTimeMS: 2000,
          },
        )
        .exec();
    },
    finishFinancial(id, opId) {
      return model
        .findOneAndUpdate(
          {
            _id: objectId(id),
            financialProtocolVersion: { $exists: false },
            'financialOperation._id': objectId(opId),
          },
          { $unset: { financialOperation: 1 }, $inc: { __v: 1 } },
          { returnDocument: 'after', ...durableWriteOptions(), maxTimeMS: 2000 },
        )
        .exec();
    },
    reserveCycleFinancial(user, id, expected, cycleId, epoch, state, operation) {
      if (
        !Number.isSafeInteger(expected) ||
        expected < 0 ||
        expected >= Number.MAX_SAFE_INTEGER - 6 ||
        !Number.isSafeInteger(epoch) ||
        epoch < 0 ||
        !['open', 'frozen'].includes(state)
      )
        throw new RangeError('Invalid cycle financial reservation');
      return model
        .findOneAndUpdate(
          {
            _id: objectId(id),
            ...memberFilter(user),
            __v: expected,
            financialProtocolVersion: 2,
            currentCycleId: objectId(cycleId),
            cycleEpoch: epoch,
            currentCycleState: state,
            financialHistoryAt: { $exists: true },
            financialOperation: { $exists: false },
          },
          { $set: { financialOperation: operation }, $inc: { __v: 1 } },
          { returnDocument: 'after', ...durableWriteOptions(), maxTimeMS: 2000 },
        )
        .exec();
    },
    promoteCycleFinancial(id, opId, cycleId, epoch) {
      return model
        .findOneAndUpdate(
          {
            _id: objectId(id),
            financialProtocolVersion: 2,
            currentCycleId: objectId(cycleId),
            cycleEpoch: epoch,
            'financialOperation._id': objectId(opId),
            'financialOperation.protocolVersion': 2,
            'financialOperation.phase': 'checking',
          },
          { $set: { 'financialOperation.phase': 'applying' }, $inc: { __v: 1 } },
          { returnDocument: 'after', ...durableWriteOptions(), maxTimeMS: 2000 },
        )
        .exec();
    },
    cancelCycleChecking(id, opId, cycleId, epoch) {
      return model
        .findOneAndUpdate(
          {
            _id: objectId(id),
            financialProtocolVersion: 2,
            currentCycleId: objectId(cycleId),
            cycleEpoch: epoch,
            'financialOperation._id': objectId(opId),
            'financialOperation.phase': 'checking',
          },
          { $unset: { financialOperation: 1 }, $inc: { __v: 1 } },
          { returnDocument: 'after', ...durableWriteOptions(), maxTimeMS: 2000 },
        )
        .exec();
    },
    markCycleFrozen(id, opId, cycleId, epoch, hasLegacyMarker) {
      return model
        .findOneAndUpdate(
          {
            _id: objectId(id),
            financialProtocolVersion: 2,
            currentCycleId: objectId(cycleId),
            cycleEpoch: epoch,
            currentCycleState: 'open',
            'financialOperation._id': objectId(opId),
            'financialOperation.phase': 'applying',
            settlementStartedAt: { $exists: !!hasLegacyMarker },
          },
          {
            $set: {
              currentCycleState: 'frozen',
              ...(!hasLegacyMarker ? { settlementStartedAt: new Date() } : {}),
            },
            $inc: { __v: 1 },
          },
          {
            returnDocument: 'after',
            overwriteImmutable: true,
            ...durableWriteOptions(),
            maxTimeMS: 2000,
          },
        )
        .exec();
    },
    finishCycleFinancial(id, opId, cycleId, epoch) {
      return model
        .findOneAndUpdate(
          {
            _id: objectId(id),
            financialProtocolVersion: 2,
            currentCycleId: objectId(cycleId),
            cycleEpoch: epoch,
            'financialOperation._id': objectId(opId),
            'financialOperation.phase': 'applying',
          },
          { $unset: { financialOperation: 1 }, $inc: { __v: 1 } },
          { returnDocument: 'after', ...durableWriteOptions(), maxTimeMS: 2000 },
        )
        .exec();
    },
    deleteForOwner(user, id) {
      return model
        .findOneAndDelete(
          { _id: objectId(id), ...ownerFilter(user), financialHistoryAt: { $exists: false } },
          { ...durableWriteOptions(), maxTimeMS: 2000 },
        )
        .exec();
    },
  };
}
export const groupRepository = createGroupRepository();
export async function ensureGroupIndexes() {
  const db = Group.db.db,
    name = Group.collection.name;
  // Startup fails closed if collection-validator installation lacks permissions.
  try {
    await db.createCollection(name, {
      validator: groupCollectionValidator,
      validationLevel: 'strict',
      validationAction: 'error',
    });
  } catch (error) {
    if (error.code !== 48) throw error;
  }
  await db.command({
    collMod: name,
    validator: groupCollectionValidator,
    validationLevel: 'strict',
    validationAction: 'error',
  });
  await Group.init();
}
