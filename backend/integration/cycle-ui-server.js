// Disposable local browser fixture. Never imported by normal startup or app.js.
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import mongoose from 'mongoose';
import { Group } from '../src/models/group.model.js';
import { GroupFinancialCycle } from '../src/models/group-financial-cycle.model.js';
import { GroupExpense } from '../src/models/group-expense.model.js';
import { GroupSettlement } from '../src/models/group-settlement.model.js';
import { User } from '../src/models/user.model.js';
import { ensureGroupIndexes, groupRepository } from '../src/repositories/group.repository.js';
import {
  ensureGroupFinancialCycleIndexes,
  groupFinancialCycleRepository,
} from '../src/repositories/group-financial-cycle.repository.js';
import {
  ensureGroupExpenseIndexes,
  groupExpenseRepository,
} from '../src/repositories/group-expense.repository.js';
import {
  ensureSettlementIndexes,
  settlementRepository,
} from '../src/repositories/settlement.repository.js';
import {
  ensureCycleTransitionIndexes,
  cycleTransitionRepository,
} from '../src/repositories/group-cycle-transition.repository.js';
import { groupBalanceRepository } from '../src/repositories/group-balance.repository.js';
import { membershipRepository } from '../src/repositories/membership.repository.js';
import { userRepository } from '../src/repositories/user.repository.js';
import { hashPassword } from '../src/services/password.service.js';
import { createDisposableCycleApp } from './helpers/staged-cycle-app.js';

if (process.env.NODE_ENV !== 'test' || process.env.TALLYNEST_CYCLE_FIXTURE !== 'disposable-local')
  throw new Error('Explicit disposable test context required');
if (process.env.MONGO_URI && process.env.MONGO_URI !== 'mongodb://127.0.0.1:27017')
  throw new Error('Only local standalone MongoDB is permitted');
const password = process.env.TALLYNEST_CYCLE_FIXTURE_PASSWORD;
if (!password || password.length < 16)
  throw new Error('Provide a private disposable test password');
const database = `tallynest_cycle_http_test_${Date.now()}_${randomBytes(6).toString('hex')}`;
const uri = `mongodb://127.0.0.1:27017/${database}`;
let server;
async function cleanup() {
  if (server) await new Promise((resolve) => server.close(resolve));
  if (mongoose.connection.readyState === 1) {
    if (mongoose.connection.name !== database) throw new Error('Database cleanup target changed');
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  }
}
try {
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });
  for (const install of [
    ensureGroupIndexes,
    ensureGroupFinancialCycleIndexes,
    ensureGroupExpenseIndexes,
    ensureSettlementIndexes,
    ensureCycleTransitionIndexes,
  ])
    await install();
  await User.init();
  const owner = await User.create({
    name: 'Cycle owner',
    email: 'cycle-owner@test.invalid',
    passwordHash: await hashPassword(password),
  });
  const member = await User.create({
    name: 'Cycle member',
    email: 'cycle-member@test.invalid',
    passwordHash: await hashPassword(password),
  });
  const group = await groupRepository.createForOwner(String(owner._id), {
    name: 'Disposable cycle group',
  });
  group.members.push({
    user: member._id,
    role: 'member',
    createdAt: new Date(),
  });
  await group.save();
  await Group.collection.updateOne({ _id: group._id }, { $set: { financialProtocolVersion: 2 } });
  const app = await createDisposableCycleApp({
    connection: mongoose.connection,
    config: {
      nodeEnv: 'test',
      clientOrigin: 'http://localhost:5174',
      jwtSecret: randomBytes(32).toString('hex'),
    },
    repositories: {
      groups: groupRepository,
      cycles: groupFinancialCycleRepository,
      expenses: groupExpenseRepository,
      settlements: settlementRepository,
      receipts: cycleTransitionRepository,
      profiles: membershipRepository,
      balances: groupBalanceRepository,
      users: userRepository,
    },
    models: {
      cycles: GroupFinancialCycle,
      expenses: GroupExpense,
      settlements: GroupSettlement,
    },
  });
  server = app.listen(5007, '127.0.0.1');
  await once(server, 'listening');
  process.stdout.write(
    `Disposable cycle API: http://localhost:5007/api\nGroup: ${group._id}\nDatabase: ${database}\n`,
  );
  for (const signal of ['SIGINT', 'SIGTERM'])
    process.once(signal, () => {
      void cleanup().then(
        () => process.exit(0),
        () => process.exit(1),
      );
    });
} catch (error) {
  await cleanup();
  throw error;
}
