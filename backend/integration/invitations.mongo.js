import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { before, after, beforeEach, test } from 'node:test';
import mongoose from 'mongoose';
import { Group } from '../src/models/group.model.js';
import { User } from '../src/models/user.model.js';
import { Transaction } from '../src/models/transaction.model.js';
import { Budget } from '../src/models/budget.model.js';
import { RecurringSchedule } from '../src/models/recurring.model.js';
import { userRepository } from '../src/repositories/user.repository.js';
import { hashPassword } from '../src/services/password.service.js';
import { createGroupRepository, ensureGroupIndexes } from '../src/repositories/group.repository.js';
import { createInvitationRepository } from '../src/repositories/invitation.repository.js';
import { createMembershipRepository } from '../src/repositories/membership.repository.js';
import {
  invitationApiSetup,
  invitationApiContract,
  createInvite,
  ownerC,
} from '../tests/helpers/invitation-api.js';
import { ownerA, ownerB, expense } from '../tests/helpers/transaction-api.js';
const database = `tallynest_invitation_test_${Date.now()}_${randomBytes(6).toString('hex')}`;
let passwordHash;
before(async () => {
  await mongoose.connect(`mongodb://127.0.0.1:27017/${database}`, {
    serverSelectionTimeoutMS: 10000,
  });
  assert.equal(mongoose.connection.name, database);
  await ensureGroupIndexes();
  await Promise.all([User.init(), Transaction.init(), Budget.init(), RecurringSchedule.init()]);
  passwordHash = await hashPassword('disposable group integration password');
  console.log(`Disposable MongoDB database: ${database}`);
});
beforeEach(async () => {
  assert.equal(mongoose.connection.name, database);
  await Promise.all([
    Group.deleteMany({}),
    User.deleteMany({}),
    Transaction.deleteMany({}),
    Budget.deleteMany({}),
    RecurringSchedule.deleteMany({}),
  ]);
  await User.create([
    { _id: ownerA, name: 'Owner A', email: 'a@example.test', passwordHash },
    { _id: ownerB, name: 'Owner B', email: 'b@example.test', passwordHash },
    { _id: ownerC, name: 'Owner C', email: 'c@example.test', passwordHash },
  ]);
});
after(async () => {
  if (mongoose.connection.readyState === 1) {
    assert.equal(mongoose.connection.name, database);
    await mongoose.connection.dropDatabase();
    const { databases } = await mongoose.connection.db.admin().listDatabases({ nameOnly: true });
    assert.equal(
      databases.some((row) => row.name === database),
      false,
    );
    await mongoose.disconnect();
    console.log(`Dropped disposable database: ${database}`);
  }
});
const dependencies = () => ({
  groupRepository: createGroupRepository(),
  invitationRepository: createInvitationRepository(),
  membershipRepository: createMembershipRepository(),
});
invitationApiContract((t) => invitationApiSetup(t, dependencies(), userRepository));

test('real MongoDB unique hash index and invitation collection constraints protect stored secrets', async (t) => {
  const request = await invitationApiSetup(t, dependencies(), userRepository),
    created = await createInvite(request, { maxUses: 2 });
  const indexes = await Group.collection.indexes();
  assert.ok(
    indexes.some(
      (index) => index.unique && index.sparse && index.key['invitations.tokenHash'] === 1,
    ),
  );
  const stored = await Group.findById(created.groupId);
  assert.equal(JSON.stringify(stored.toObject()).includes(created.token), false);
  assert.equal(stored.invitations[0].tokenHash.length, 64);
  const invitation = stored.invitations[0].toObject();
  for (const patch of [
    {
      accepted: [
        { user: new mongoose.Types.ObjectId(ownerB), acceptedAt: invitation.createdAt },
        { user: new mongoose.Types.ObjectId(ownerB), acceptedAt: invitation.createdAt },
      ],
    },
    { maxUses: 0 },
    { maxUses: 1.5 },
    { expiresAt: invitation.createdAt },
    { tokenHash: 'bad' },
    { token: 'plaintext should never be stored' },
  ]) {
    const data = { ...invitation, ...patch };
    await assert.rejects(
      Group.collection.updateOne({ _id: stored._id }, { $set: { invitations: [data] } }),
      (error) => error.code === 121,
    );
  }
  await assert.rejects(
    Group.collection.updateOne(
      { _id: stored._id },
      { $push: { invitations: { ...invitation, _id: new mongoose.Types.ObjectId() } } },
    ),
    (error) => error.code === 121,
  );
  const other = await dependencies().groupRepository.createForOwner(ownerA, { name: 'Other' });
  await assert.rejects(
    Group.collection.updateOne({ _id: other._id }, { $set: { invitations: [invitation] } }),
    (error) => error.code === 11000,
  );
});
test('actual registered accounts join and collaborate with privacy-preserving profiles', async (t) => {
  const request = await invitationApiSetup(t, dependencies(), userRepository),
    users = [];
  for (let i = 0; i < 3; i++) {
    const result = await request('/auth/register', {
      method: 'POST',
      user: null,
      body: {
        name: `Registered ${i}`,
        email: `registered-${i}@example.test`,
        password: 'disposable registration phrase',
      },
    });
    assert.equal(result.status, 201);
    users.push(result.body.data.user.id);
  }
  const created = await request('/groups', {
    method: 'POST',
    user: users[0],
    body: { name: 'Registered collaboration' },
  });
  const groupId = created.body.data.group.id;
  const invitation = await request(`/groups/${groupId}/invitations`, {
    method: 'POST',
    user: users[0],
    body: { maxUses: 2 },
    headers: { 'If-Match': created.etag },
  });
  const path = invitation.body.data.acceptancePath;
  for (const user of users.slice(1))
    assert.equal((await request(path, { method: 'POST', body: {}, user })).status, 200);
  const result = await request(`/groups/${groupId}/members`, { user: users[1] });
  assert.deepEqual(
    result.body.data.members.map((row) => row.name),
    ['Registered 0', 'Registered 1', 'Registered 2'],
  );
  for (const row of result.body.data.members)
    assert.deepEqual(Object.keys(row).sort(), ['id', 'name', 'role', 'joinedAt'].sort());
});
test('database-clock expiry is rechecked during acceptance and expired slots are lazily reclaimed', async (t) => {
  const deps = dependencies(),
    original = deps.invitationRepository.accept;
  deps.invitationRepository.accept = async (...args) => {
    const groupId = args[1],
      invitationId = args[2]._id;
    const now = new Date();
    await Group.collection.updateOne(
      { _id: new mongoose.Types.ObjectId(groupId), 'invitations._id': invitationId },
      {
        $set: {
          'invitations.$.createdAt': new Date(now.getTime() - 120000),
          'invitations.$.expiresAt': new Date(now.getTime() - 60000),
        },
      },
    );
    return original(...args);
  };
  const request = await invitationApiSetup(t, deps, userRepository),
    created = await createInvite(request);
  assert.equal(
    (await request(created.acceptancePath, { method: 'POST', body: {}, user: ownerB })).status,
    404,
  );
  const stored = await Group.findById(created.groupId);
  assert.equal(stored.members.length, 1);
  assert.equal(stored.invitations[0].accepted.length, 0);
  const replacement = await request(`/groups/${created.groupId}/invitations`, {
    method: 'POST',
    body: {},
    headers: { 'If-Match': created.etag },
  });
  assert.equal(replacement.status, 201);
  assert.equal((await Group.findById(created.groupId)).invitations.length, 1);
});
test('full groups cannot consume invitations; concurrent final-seat admissions have one winner', async (t) => {
  const request = await invitationApiSetup(t, dependencies(), userRepository),
    created = await createInvite(request, { maxUses: 2 });
  const group = await Group.findById(created.groupId);
  // Trusted capacity fixtures; acceptance itself still resolves live registered users.
  for (let i = 0; i < 98; i++)
    group.members.push({
      user: new mongoose.Types.ObjectId(),
      role: 'member',
      createdAt: new Date(),
    });
  await group.save();
  const results = await Promise.all(
    [ownerB, ownerC].map((user) =>
      request(created.acceptancePath, { method: 'POST', body: {}, user }),
    ),
  );
  assert.equal(results.filter((row) => row.status === 200).length, 1);
  const stored = await Group.findById(created.groupId);
  assert.equal(stored.members.length, 100);
  assert.equal(stored.invitations[0].accepted.length, 1);
  const loser = results[0].status === 200 ? ownerC : ownerB;
  const rejected = await request(created.acceptancePath, { method: 'POST', body: {}, user: loser });
  assert.equal(rejected.status, 409);
  assert.equal(rejected.body.code, 'GROUP_FULL');
  assert.equal((await Group.findById(created.groupId)).invitations[0].accepted.length, 1);
});
test('membership removal races and metadata changes preserve version and sole-owner constraints', async (t) => {
  const request = await invitationApiSetup(t, dependencies(), userRepository),
    created = await createInvite(request, { maxUses: 2 });
  await request(created.acceptancePath, { method: 'POST', body: {}, user: ownerB });
  const current = await request(`/groups/${created.groupId}`),
    headers = { 'If-Match': current.etag };
  const results = await Promise.all([
    request(`/groups/${created.groupId}/members/${ownerB}`, { method: 'DELETE', headers }),
    request(`/groups/${created.groupId}`, {
      method: 'PATCH',
      body: { name: 'Concurrent metadata' },
      headers,
    }),
  ]);
  assert.equal(results.filter((row) => row.status === 200).length, 1);
  assert.ok([409, 412].includes(results.find((row) => row.status !== 200).status));
  const group = await Group.findById(created.groupId);
  assert.equal(group.__v, 3);
  assert.equal(group.members.filter((row) => row.role === 'owner').length, 1);
  await assert.rejects(
    Group.collection.updateOne(
      { _id: group._id },
      { $pull: { members: { user: new mongoose.Types.ObjectId(ownerA) } } },
    ),
    (error) => error.code === 121,
  );
});
test('interrupted atomic acceptance recovers with fresh service instances and no partial membership/use', async (t) => {
  for (const stage of ['before', 'after']) {
    const deps = dependencies(),
      original = deps.invitationRepository.accept;
    deps.invitationRepository.accept = async (...args) => {
      if (stage === 'before') throw new Error('before atomic write');
      await original(...args);
      throw new Error('lost acknowledgement');
    };
    const request = await invitationApiSetup(t, deps, userRepository),
      created = await createInvite(request);
    assert.equal(
      (await request(created.acceptancePath, { method: 'POST', body: {}, user: ownerB })).status,
      500,
    );
    const stored = await Group.findById(created.groupId);
    assert.equal(stored.members.length, stage === 'before' ? 1 : 2);
    assert.equal(stored.invitations[0].accepted.length, stage === 'before' ? 0 : 1);
    const fresh = await invitationApiSetup(t, dependencies(), userRepository);
    assert.equal(
      (await fresh(created.acceptancePath, { method: 'POST', body: {}, user: ownerB })).status,
      stage === 'before' ? 200 : 409,
    );
    const completed = await Group.findById(created.groupId);
    assert.equal(completed.members.length, 2);
    assert.equal(completed.invitations[0].accepted.length, 1);
  }
});
test('revocation/deletion between invitation read and acceptance cannot create an orphan membership', async (t) => {
  for (const action of ['revoke', 'delete']) {
    const deps = dependencies(),
      original = deps.invitationRepository.accept;
    deps.invitationRepository.accept = async (...args) => {
      const user = ownerA,
        groupId = args[1];
      if (action === 'delete') await deps.groupRepository.deleteForOwner(user, groupId);
      else
        await deps.invitationRepository.revokeForOwner(user, groupId, String(args[2]._id), args[3]);
      return original(...args);
    };
    const request = await invitationApiSetup(t, deps, userRepository),
      created = await createInvite(request);
    const result = await request(created.acceptancePath, {
      method: 'POST',
      body: {},
      user: ownerB,
    });
    assert.equal(result.status, 404);
    assert.equal(result.body.code, 'INVITATION_UNAVAILABLE');
    const group = await Group.findById(created.groupId);
    if (action === 'delete') assert.equal(group, null);
    else {
      assert.equal(group.members.length, 1);
      assert.equal(group.invitations[0].accepted.length, 0);
    }
  }
});
test('invitation capacity is bounded and revoked slots can be reused without resurrecting secrets', async (t) => {
  const deps = dependencies(),
    request = await invitationApiSetup(t, deps, userRepository),
    created = await createInvite(request);
  const group = await Group.findById(created.groupId),
    template = group.invitations[0].toObject();
  for (let i = 0; i < 49; i++)
    group.invitations.push({
      ...template,
      _id: new mongoose.Types.ObjectId(),
      tokenHash: randomBytes(32).toString('hex'),
    });
  await group.save();
  const current = await request(`/groups/${created.groupId}`);
  assert.equal(
    (
      await request(`/groups/${created.groupId}/invitations`, {
        method: 'POST',
        body: {},
        headers: { 'If-Match': current.etag },
      })
    ).body.code,
    'INVITATION_LIMIT',
  );
  const revoked = await request(`/groups/${created.groupId}/invitations/${created.invitation.id}`, {
    method: 'DELETE',
    headers: { 'If-Match': current.etag },
  });
  assert.equal(revoked.status, 200);
  const next = await request(`/groups/${created.groupId}/invitations`, {
    method: 'POST',
    body: {},
    headers: { 'If-Match': revoked.etag },
  });
  assert.equal(next.status, 201);
  assert.equal((await Group.findById(created.groupId)).invitations.length, 50);
  assert.equal((await request(created.inspectionPath, { user: ownerB })).status, 404);
});
test('cross-group invitation/member mutations cannot bypass scoped authorization or change personal finance', async (t) => {
  const transaction = await Transaction.create({ ...expense, owner: ownerA }),
    original = transaction.toObject();
  const request = await invitationApiSetup(t, dependencies(), userRepository),
    created = await createInvite(request);
  const other = await request('/groups', {
    method: 'POST',
    body: { name: 'Foreign group' },
    user: ownerB,
  });
  const result = await request(
    `/groups/${other.body.data.group.id}/invitations/${created.invitation.id}`,
    { method: 'DELETE', user: ownerB, headers: { 'If-Match': other.etag } },
  );
  assert.equal(result.status, 404);
  await request(created.acceptancePath, { method: 'POST', body: {}, user: ownerB });
  const current = await request(`/groups/${created.groupId}`);
  await request(`/groups/${created.groupId}/members/${ownerB}`, {
    method: 'DELETE',
    headers: { 'If-Match': current.etag },
  });
  assert.deepEqual((await Transaction.findById(transaction._id)).toObject(), original);
});
