import assert from 'node:assert/strict';
import test from 'node:test';
import mongoose from 'mongoose';
import { GroupFinancialCycle } from '../src/models/group-financial-cycle.model.js';
import {
  isCycleStatus,
  canTransitionCycle,
  nextCycleSequence,
  sortedCycleMembers,
  cycleBelongsToGroup,
} from '../src/utils/group-financial-cycle.js';
import { ownerA, ownerB } from './helpers/transaction-api.js';

const groupId = new mongoose.Types.ObjectId();
const operationId = new mongoose.Types.ObjectId();
const openedAt = new Date('2026-10-01T00:00:00.000Z');
const fixture = (fields = {}) => ({
  group: groupId,
  sequence: 1,
  currency: 'INR',
  status: 'open',
  activeSlot: true,
  memberIds: sortedCycleMembers([ownerB, ownerA]),
  openedAt,
  openOperationId: operationId,
  ...fields,
});

test('pure cycle helpers enforce ordered states, safe sequence and stable member IDs', () => {
  assert.deepEqual(['open', 'frozen', 'closed'].map(isCycleStatus), [true, true, true]);
  assert.equal(isCycleStatus('reopened'), false);
  assert.equal(canTransitionCycle('open', 'frozen'), true);
  assert.equal(canTransitionCycle('frozen', 'closed'), true);
  for (const [from, to] of [
    ['open', 'closed'],
    ['frozen', 'open'],
    ['closed', 'open'],
  ])
    assert.equal(canTransitionCycle(from, to), false);
  assert.equal(nextCycleSequence(1), 2);
  assert.equal(nextCycleSequence(Number.MAX_SAFE_INTEGER - 1), Number.MAX_SAFE_INTEGER);
  for (const value of [0, -1, 1.5, Number.MAX_SAFE_INTEGER, Infinity])
    assert.throws(() => nextCycleSequence(value));
  assert.deepEqual(sortedCycleMembers([ownerB, ownerA]), [ownerA, ownerB].sort());
  assert.throws(() => sortedCycleMembers([ownerA, ownerA]));
  assert.throws(() => sortedCycleMembers(['invalid']));
  assert.throws(() => sortedCycleMembers([]));
  assert.equal(cycleBelongsToGroup({ group: groupId }, String(groupId)), true);
  assert.equal(cycleBelongsToGroup({ group: groupId }, ownerA), false);
});

test('cycle model validates shape without enabling a financial write path', async () => {
  await new GroupFinancialCycle(fixture()).validate();
  const frozenAt = new Date('2026-10-02T00:00:00.000Z');
  await new GroupFinancialCycle(
    fixture({
      status: 'frozen',
      frozenAt,
      freezeOperationId: new mongoose.Types.ObjectId(),
    }),
  ).validate();
  await new GroupFinancialCycle(
    fixture({
      status: 'closed',
      activeSlot: undefined,
      frozenAt,
      freezeOperationId: new mongoose.Types.ObjectId(),
      closedAt: new Date('2026-10-03T00:00:00.000Z'),
      closeOperationId: new mongoose.Types.ObjectId(),
    }),
  ).validate();
  for (const fields of [
    { sequence: 0 },
    { sequence: 1.5 },
    { sequence: Number.MAX_SAFE_INTEGER + 1 },
    { status: 'invalid' },
    { activeSlot: undefined },
    { memberIds: [ownerA, ownerA] },
    { memberIds: [ownerB, ownerA].sort().reverse() },
    { previousCycleId: new mongoose.Types.ObjectId() },
    { status: 'closed', activeSlot: undefined },
    { __v: 0.5 },
  ])
    await assert.rejects(new GroupFinancialCycle(fixture(fields)).validate());
  assert.throws(() => new GroupFinancialCycle(fixture({ unsafe: true })));
});
