import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  firstCycleInput,
  cycleTransitionInput,
  assertClosable,
  lifecycleHash,
} from '../src/utils/cycle-lifecycle.js';
import { createCycleLifecycleService } from '../src/services/cycle-lifecycle.service.js';
import { ownerA } from './helpers/transaction-api.js';

test('lifecycle input requires fixed UUID, expected versions and canonical associations', () => {
  const value = { intent: randomUUID(), groupVersion: 0 };
  assert.equal(firstCycleInput.safeParse(value).success, true);
  for (const patch of [
    { intent: '' },
    { groupVersion: -1 },
    { groupVersion: 1.5 },
    { owner: ownerA },
  ])
    assert.equal(firstCycleInput.safeParse({ ...value, ...patch }).success, false);
  const next = { ...value, cycleId: ownerA, epoch: 1, cycleVersion: 0 };
  assert.equal(cycleTransitionInput.safeParse(next).success, true);
  for (const patch of [
    { epoch: 0 },
    { epoch: Number.MAX_SAFE_INTEGER },
    { cycleId: { $ne: null } },
    { cycleVersion: Infinity },
  ])
    assert.equal(cycleTransitionInput.safeParse({ ...next, ...patch }).success, false);
});
test('closure requires exact zero debt and no pending capacity', () => {
  const zero = { net: 0n, reservedSent: 0n, reservedReceived: 0n };
  assert.doesNotThrow(() => assertClosable([zero]));
  assert.throws(
    () =>
      assertClosable([
        { ...zero, net: -1n },
        { ...zero, net: 1n },
      ]),
    { code: 'CYCLE_NOT_SETTLED' },
  );
  assert.throws(() => assertClosable([{ ...zero, reservedSent: 1n }]), {
    code: 'CYCLE_PENDING_SETTLEMENTS',
  });
});
test('lifecycle is inactive before any repository is consulted', async () => {
  await assert.rejects(createCycleLifecycleService().openFirst(ownerA, ownerA, {}), {
    code: 'CYCLE_PROTOCOL_INACTIVE',
  });
  await assert.rejects(createCycleLifecycleService().recover(ownerA, ownerA), {
    code: 'CYCLE_PROTOCOL_INACTIVE',
  });
});
test('intent hash binds actor, original versions, target and payload, but not recoverable phase', () => {
  const op = {
    _id: ownerA,
    actor: ownerA,
    kind: 'cycle_open_first',
    groupId: ownerA,
    cycleId: ownerA,
    cycleEpoch: 0,
    expectedGroupVersion: 0,
    expectedCycleVersion: 0,
    targetId: ownerA,
    startState: 'none',
    payload: { memberIds: [ownerA] },
    phase: 'checking',
  };
  const hash = lifecycleHash(op);
  assert.equal(hash, lifecycleHash({ ...op, phase: 'applying' }));
  for (const patch of [
    { actor: 'other' },
    { expectedGroupVersion: 1 },
    { targetId: 'other' },
    { payload: {} },
  ])
    assert.notEqual(hash, lifecycleHash({ ...op, ...patch }));
});
