import assert from 'node:assert/strict';
import test from 'node:test';
import { Group } from '../src/models/group.model.js';
import { createGroupRepository } from '../src/repositories/group.repository.js';
import { createGroupService } from '../src/services/group.service.js';
import { membershipFor } from '../src/services/group-authorization.js';
import { ownerA, ownerB } from './helpers/transaction-api.js';
import { groupApiSetup, groupApiContract, group } from './helpers/group-api.js';
import { isolatedGroups } from './helpers/group-repository.js';
const member = (user = ownerA, role = 'owner') => ({
  user,
  role,
  createdAt: new Date('2026-10-13T00:00:00.000Z'),
});
groupApiContract((t) => groupApiSetup(t, isolatedGroups()));
test('group model validates owner consistency, membership uniqueness, roles and bounded arrays', async () => {
  await new Group({ ...group, creator: ownerA, members: [member()] }).validate();
  for (const members of [
    [],
    [member(ownerB)],
    [member(), member()],
    [member(), member(ownerB, 'owner')],
    [member(ownerA, 'member')],
    [member(), member(ownerB, 'admin')],
    [member(), { user: ownerB, role: 'member' }],
    Array(101).fill(member()),
  ])
    await assert.rejects(new Group({ ...group, creator: ownerA, members }).validate());
  for (const change of [
    { creator: undefined },
    { creator: 'bad' },
    { name: '' },
    { currency: 'USD' },
    { description: 'x'.repeat(2001) },
    { __v: 0.5 },
  ])
    await assert.rejects(
      new Group({ ...group, creator: ownerA, members: [member()], ...change }).validate(),
    );
  assert.throws(() => new Group({ ...group, creator: ownerA, members: [member()], owner: ownerB }));
  assert.deepEqual(Group.schema.indexes(), [
    [{ 'members.user': 1, _id: -1 }, {}],
    [{ 'invitations.tokenHash': 1 }, { unique: true, sparse: true }],
  ]);
});
test('membership helpers and API enforce member-read versus owner-write without exposing roster', async (t) => {
  const repository = isolatedGroups(),
    row = await repository.createForOwner(ownerA, group);
  await repository.seedMember(String(row._id), ownerB);
  assert.equal(membershipFor(row, ownerA).role, 'owner');
  const request = await groupApiSetup(t, repository),
    path = '/' + row._id;
  const read = await request(path, { user: ownerB });
  assert.equal(read.status, 200);
  assert.equal(read.body.data.group.membership.role, 'member');
  assert.equal(read.body.data.group.members, undefined);
  assert.equal(read.body.data.group.creator, undefined);
  assert.equal((await request('', { user: ownerB })).body.data.groups.length, 1);
  for (const method of ['PATCH', 'DELETE']) {
    const response = await request(path, {
      user: ownerB,
      method,
      ...(method === 'PATCH'
        ? { body: { name: 'No' }, headers: { 'If-Match': read.headers.get('etag') } }
        : {}),
    });
    assert.equal(response.status, 403);
    assert.equal(response.body.code, 'GROUP_OWNER_REQUIRED');
  }
});
test('group service reports an atomic race as 409 and lost access as 404/403', async () => {
  for (const outcome of ['conflict', 'missing', 'demoted']) {
    const repository = isolatedGroups(),
      row = await repository.createForOwner(ownerA, group);
    const wrapped = {
      ...repository,
      async replaceForOwner() {
        if (outcome === 'missing') repository.records.delete(String(row._id));
        if (outcome === 'demoted')
          repository.records.get(String(row._id)).members[0].role = 'member';
        return null;
      },
    };
    const service = createGroupService({ repository: wrapped });
    await assert.rejects(
      service.update(ownerA, String(row._id), { name: 'Next' }, `"tn-${row._id}-v0"`),
      (error) => error.status === { conflict: 409, missing: 404, demoted: 403 }[outcome],
    );
  }
});
test('repository creation uses one validated write with complete owner membership; failed pre-write leaves nothing', async () => {
  let writes = 0,
    stored;
  class FailingGroup extends Group {
    async save() {
      writes++;
      assert.equal(this.members.length, 1);
      assert.equal(String(this.members[0].user), ownerA);
      throw new Error('before insert');
    }
  }
  await assert.rejects(createGroupRepository(FailingGroup).createForOwner(ownerA, group));
  assert.equal(writes, 1);
  assert.equal(stored, undefined);
  class CommittedGroup extends Group {
    async save() {
      stored = this;
      throw new Error('lost acknowledgement');
    }
  }
  await assert.rejects(createGroupRepository(CommittedGroup).createForOwner(ownerA, group));
  assert.equal(stored.members.length, 1);
  assert.equal(stored.members[0].role, 'owner');
  await stored.validate();
});
test('repository predicates enforce membership and authoritative ownership in database queries', async () => {
  const calls = [],
    model = {
      findOne(filter) {
        calls.push(filter);
        return {
          maxTimeMS() {
            return this;
          },
          exec: async () => null,
        };
      },
      findOneAndUpdate(filter) {
        calls.push(filter);
        return { exec: async () => null };
      },
      findOneAndDelete(filter) {
        calls.push(filter);
        return { exec: async () => null };
      },
    };
  const repository = createGroupRepository(model);
  await repository.findByIdForMember(ownerA, ownerB);
  await repository.replaceForOwner(ownerA, ownerB, 0, group);
  await repository.deleteForOwner(ownerA, ownerB);
  assert.deepEqual(calls, [
    { _id: ownerB, 'members.user': ownerA },
    {
      _id: ownerB,
      creator: ownerA,
      members: { $elemMatch: { user: ownerA, role: 'owner' } },
      __v: 0,
    },
    {
      _id: ownerB,
      creator: ownerA,
      members: { $elemMatch: { user: ownerA, role: 'owner' } },
      financialHistoryAt: { $exists: false },
    },
  ]);
  await assert.rejects(repository.replaceForOwner(ownerA, ownerB, Number.MAX_SAFE_INTEGER, group));
  assert.throws(() => repository.findByIdForMember({ $ne: null }, ownerB));
});
test('group errors sanitize unexpected failures in development and production', async (t) => {
  for (const nodeEnv of ['development', 'production']) {
    const request = await groupApiSetup(
      t,
      {
        ...isolatedGroups(),
        async createForOwner() {
          throw new Error('mongodb password secret stack');
        },
      },
      undefined,
      nodeEnv,
    );
    const response = await request('', { method: 'POST', body: group });
    assert.equal(response.status, 500);
    assert.equal(response.body.message, 'Internal server error');
    assert.equal(response.body.code, 'INTERNAL_ERROR');
    assert.equal(response.body.stack, undefined);
  }
});
