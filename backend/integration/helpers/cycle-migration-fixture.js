import mongoose from 'mongoose';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { migrationModels, definitions } from '../../src/migrations/cycle-v1/preflight.js';
import { rehearsalBackup } from '../../src/migrations/cycle-v1/backup.js';
import { createGroupRepository } from '../../src/repositories/group.repository.js';
import { createGroupExpenseRepository } from '../../src/repositories/group-expense.repository.js';
import { createSettlementRepository } from '../../src/repositories/settlement.repository.js';
import { createGroupBalanceRepository } from '../../src/repositories/group-balance.repository.js';
import { createMembershipRepository } from '../../src/repositories/membership.repository.js';
import { createGroupExpenseService } from '../../src/services/group-expense.service.js';
import { createSettlementService } from '../../src/services/settlement.service.js';
import { createGroupFinancialService } from '../../src/services/group-financial.service.js';
export const name = () =>
  `tallynest_cycle_rehearsal_${Date.now()}_${randomBytes(6).toString('hex')}`;
export async function fixture() {
  const database = name(),
    uri = `mongodb://127.0.0.1:27017/${database}`;
  const connection = await mongoose
    .createConnection(uri, { autoIndex: false, autoCreate: false })
    .asPromise();
  const models = migrationModels(connection),
    { G, E, S, U } = models;
  for (const [model, validator] of definitions.slice(0, 3)) {
    const local = connection.model(model.modelName);
    await connection.db.createCollection(local.collection.name, {
      validator,
      validationLevel: 'strict',
      validationAction: 'error',
    });
    await local.createIndexes();
  }
  await U.createCollection();
  await U.createIndexes();
  const users = await U.create(
    ['A', 'B', 'C'].map((suffix) => ({
      name: `Disposable ${suffix}`,
      email: `${suffix.toLowerCase()}@example.test`,
      passwordHash: '$2b$12$' + 'a'.repeat(53),
    })),
  );
  const [a, b, c] = users.map((u) => String(u._id));
  const groups = createGroupRepository(G),
    expenses = createGroupExpenseRepository(E),
    settlements = createSettlementRepository(S),
    balances = createGroupBalanceRepository(E, S),
    profiles = createMembershipRepository(G, U);
  const expenseService = createGroupExpenseService({ repository: expenses, groups, profiles });
  const settlementService = createSettlementService({
    repository: settlements,
    groups,
    balances,
    profiles,
  });
  async function group(title) {
    const row = await groups.createForOwner(a, { name: title });
    row.members.push(...[b, c].map((user) => ({ user, role: 'member', createdAt: new Date() })));
    await row.save();
    return row;
  }
  const data = (amountMinor = 10000, split = { method: 'equal', participants: [a, b] }) => ({
    title: 'Legacy expense',
    payer: a,
    amountMinor,
    currency: 'INR',
    category: 'food_dining',
    expenseDate: '2026-10-01T00:00:00.000Z',
    split,
    notes: 'Private financial note must never be logged',
  });
  async function expense(g, amount, split, key = randomUUID()) {
    return expenseService.create(a, String(g._id), data(amount, split), key);
  }
  async function proposal(g, status) {
    const key = randomUUID();
    const result = await settlementService.create(
      b,
      String(g._id),
      { recipient: a, amountMinor: 1000, currency: 'INR' },
      key,
    );
    if (status !== 'pending')
      await settlementService.decide(
        a,
        String(g._id),
        result.settlement.id,
        status === 'confirmed' ? 'confirm' : 'reject',
        {},
        `"tn-${result.settlement.id}-v0"`,
      );
    return { ...result, key };
  }
  const backupDirectories = [];
  async function backup() {
    const directory = await mkdtemp(join(tmpdir(), 'tallynest-cycle-backup-'));
    backupDirectories.push(directory);
    const manifest = await rehearsalBackup({
      db: connection.db,
      database,
      restoreDatabase: name(),
      directory,
    });
    return { directory, manifest };
  }
  async function cleanup(directory) {
    await connection.dropDatabase();
    await connection.close();
    for (const path of new Set([...backupDirectories, ...(directory ? [directory] : [])]))
      await rm(path, { recursive: true, force: true });
  }
  const input = (manifest) => ({
    uri,
    database,
    maintenanceId: randomUUID(),
    backupManifest: manifest,
    offline: true,
    disposable: true,
    writersStopped: true,
  });
  const financial = (extra = {}) =>
    createGroupFinancialService({ groups, expenses, settlements, balances, ...extra });
  return {
    connection,
    models,
    database,
    uri,
    a,
    b,
    c,
    groups,
    expenses,
    settlements,
    balances,
    profiles,
    expenseService,
    settlementService,
    group,
    data,
    expense,
    proposal,
    backup,
    cleanup,
    input,
    financial,
  };
}
