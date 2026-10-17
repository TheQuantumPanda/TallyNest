// Only the disposable cycle HTTP fixture uses this repository adapter.
// A single insert creates the group, its owner membership, and protocol state.
import mongoose from 'mongoose';
import { Group } from '../../src/models/group.model.js';
import { groupInputSchema } from '../../src/validators/group.validator.js';
import { ownerIdSchema } from '../../src/validators/transaction.validator.js';
import { durableWriteOptions } from '../../src/utils/durable-write.js';

export function createCycleFixtureGroupRepository(connection, repository) {
  if (!/^tallynest_cycle_http_test_\d{13}_[a-f0-9]{12}$/.test(connection.name))
    throw new Error('Cycle fixture group creation requires a disposable database');
  return {
    ...repository,
    async createForOwner(user, input) {
      const creator = new mongoose.Types.ObjectId(ownerIdSchema.parse(user));
      const group = new Group({
        ...groupInputSchema.parse(input),
        creator,
        members: [{ user: creator, role: 'owner', createdAt: new Date() }],
        financialProtocolVersion: 2,
        cycleEpoch: 0,
        __v: 0,
      });
      await group.validate();
      return group.save(durableWriteOptions());
    },
  };
}
