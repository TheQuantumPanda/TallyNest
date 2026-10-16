import { creationContract } from './helpers/creation-api.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createTransactionService } from '../src/services/transaction.service.js';
import { createRecurringService } from '../src/services/recurring.service.js';
import { isolatedTransactions } from './helpers/transaction-repository.js';
import { isolatedRecurring } from './helpers/recurring-repository.js';
import { apiSetup, expense, ownerA } from './helpers/transaction-api.js';
import { recurringApiSetup, schedule } from './helpers/recurring-api.js';

creationContract(async (t, resource) =>
  resource === 'transaction'
    ? apiSetup(t, isolatedTransactions())
    : recurringApiSetup(t, isolatedRecurring()),
);
for (const resource of ['transaction', 'schedule'])
  test(`${resource} unknown acknowledgement is recovered by explicit same-key retry`, async () => {
    const repository =
      resource === 'transaction' ? isolatedTransactions() : isolatedRecurring().repository;
    const create = repository.createForOwner.bind(repository);
    repository.createForOwner = async (...args) => {
      await create(...args);
      throw new Error('private unknown write outcome');
    };
    const service =
      resource === 'transaction'
        ? createTransactionService({ repository })
        : createRecurringService({ repository });
    const input = resource === 'transaction' ? expense : schedule,
      key = randomUUID();
    await assert.rejects(service.create(ownerA, input, key));
    const recovered = await service.create(ownerA, input, key);
    assert.equal(recovered.replayed, true);
    assert.equal(recovered[resource].amountMinor, input.amountMinor);
  });
for (const resource of ['transaction', 'schedule'])
  test(`${resource} missing UUID is rejected before any receipt lookup`, async () => {
    const service =
      resource === 'transaction'
        ? createTransactionService({ repository: {} })
        : createRecurringService({ repository: {} });
    await assert.rejects(
      service.create(ownerA, resource === 'transaction' ? expense : schedule),
      (error) => error.status === 400 && error.code === 'IDEMPOTENCY_KEY_REQUIRED',
    );
  });
