import assert from 'node:assert/strict';
import test from 'node:test';
import mongoose from 'mongoose';
import { createHash } from 'node:crypto';
import { invitationApiSetup, invitationApiContract, createInvite } from './helpers/invitation-api.js';
import { isolatedInvitations } from './helpers/invitation-repository.js';
import { ownerA, ownerB } from './helpers/transaction-api.js';
import { Group } from '../src/models/group.model.js';
import { invitationHash } from '../src/services/invitation.service.js';
import { createInvitationRepository } from '../src/repositories/invitation.repository.js';
import { createMembershipRepository } from '../src/repositories/membership.repository.js';
function setup(t, customize = value => value) {
  const data = isolatedInvitations();
  return invitationApiSetup(t, customize({ groupRepository: data.groups, invitationRepository: data.invitations, membershipRepository: data.memberships }));
}
invitationApiContract(setup);
test('hashing uses SHA-256 and stores no plaintext invitation secret in group persistence', async t => {
  const data = isolatedInvitations(), request = await invitationApiSetup(t, { groupRepository: data.groups, invitationRepository: data.invitations, membershipRepository: data.memberships });
  const created = await createInvite(request);
  const stored = data.groups.records.get(created.groupId).toObject();
  assert.equal(stored.invitations[0].tokenHash, createHash('sha256').update(created.token).digest('hex'));
  assert.equal(stored.invitations[0].tokenHash, invitationHash(created.token));
  assert.equal(JSON.stringify(stored).includes(created.token), false);
  assert.throws(() => invitationHash('bad'), error => error.status === 404);
});
test('expiration is enforced at the exact boundary without relying on cleanup', async t => {
  let instant = new Date();
  const data = isolatedInvitations(), request = await invitationApiSetup(t, { groupRepository: data.groups, invitationRepository: data.invitations, membershipRepository: data.memberships, invitationNow: () => instant });
  const created = await createInvite(request, { expiresInSeconds: 60 });
  instant = new Date(created.invitation.expiresAt);
  for (const [path, method, body] of [[created.inspectionPath, 'GET'], [created.acceptancePath, 'POST', {}]]) assert.equal((await request(path, { user: ownerB, method, body })).status, 404);
  assert.equal(data.groups.records.get(created.groupId).members.length, 1);
  assert.equal(data.groups.records.get(created.groupId).invitations.length, 1);
});
test('model rejects duplicate hashes/receipts, malformed dates, unsafe use limits and excess invitation count', async () => {
  const now = new Date(), invitation = { _id: new mongoose.Types.ObjectId(), tokenHash: 'a'.repeat(64), createdAt: now, expiresAt: new Date(now.getTime() + 60000), maxUses: 1, accepted: [] };
  const base = { name: 'Group', creator: ownerA, members: [{ user: ownerA, role: 'owner', createdAt: now }] };
  for (const patch of [{ tokenHash: 'bad' }, { maxUses: 0 }, { maxUses: 21 }, { maxUses: 1.1 }, { expiresAt: now }, { expiresAt: new Date(now.getTime() + 8 * 86400000) }, { accepted: [{ user: ownerB, acceptedAt: invitation.expiresAt }] }, { accepted: [{ user: ownerB, acceptedAt: now }, { user: ownerB, acceptedAt: now }], maxUses: 2 }]) await assert.rejects(new Group({ ...base, invitations: [{ ...invitation, ...patch }] }).validate());
  await assert.rejects(new Group({ ...base, invitations: [invitation, { ...invitation, _id: new mongoose.Types.ObjectId() }] }).validate());
  await assert.rejects(new Group({ ...base, invitations: Array(51).fill(invitation) }).validate());
});
test('acceptance before/after write failures leave either neither effect or both effects; retry never doubles usage', async t => {
  for (const stage of ['before', 'after']) {
    const data = isolatedInvitations(); let fail = true;
    const original = data.invitations.accept;
    data.invitations.accept = async (...args) => {
      if (fail && stage === 'before') { fail = false; throw new Error('private before commit'); }
      const result = await original(...args);
      if (fail && stage === 'after') { fail = false; throw new Error('private after commit'); }
      return result;
    };
    const request = await invitationApiSetup(t, { groupRepository: data.groups, invitationRepository: data.invitations, membershipRepository: data.memberships });
    const created = await createInvite(request);
    const failed = await request(created.acceptancePath, { method: 'POST', body: {}, user: ownerB });
    assert.equal(failed.status, 500); assert.equal(failed.body.message, 'Internal server error'); assert.equal(failed.body.stack, undefined);
    const stored = data.groups.records.get(created.groupId);
    assert.equal(stored.members.length, stage === 'before' ? 1 : 2); assert.equal(stored.invitations[0].accepted.length, stage === 'before' ? 0 : 1);
    const recovered = await request(created.acceptancePath, { method: 'POST', body: {}, user: ownerB });
    assert.equal(recovered.status, stage === 'before' ? 200 : 409);
    assert.equal(data.groups.records.get(created.groupId).invitations[0].accepted.length, 1);
  }
});
test('repositories apply token eligibility, Mongo clock, version and member-role predicates at database write', async () => {
  const calls = [], model = { findOneAndUpdate(filter, update, options) { calls.push({ filter, update, options }); return { exec: async () => null }; } };
  const invitation = { _id: new mongoose.Types.ObjectId(), tokenHash: 'a'.repeat(64) };
  await createInvitationRepository(model).accept(ownerB, ownerA, invitation, 2);
  const serialized = JSON.stringify(calls[0]);
  assert.ok(serialized.includes('$$NOW')); assert.ok(serialized.includes('members.99')); assert.ok(serialized.includes('accepted.user')); assert.equal(calls[0].filter.__v, 2);
  assert.equal(calls[0].options.updatePipeline, true); assert.equal(Array.isArray(calls[0].update), true);
  await createMembershipRepository(model).remove(ownerA, ownerA, ownerB, 2);
  assert.equal(String(calls[1].filter.creator), ownerA); assert.equal(calls[1].filter.__v, 2);
  assert.equal(calls[1].filter.members.$elemMatch.role, 'owner'); assert.equal(calls[1].filter.$and[0].members.$elemMatch.role, 'member');
  await assert.rejects(async () => createMembershipRepository(model).remove(ownerA, ownerA, ownerB, 2, true));
});
test('IP rate limit also bounds unauthenticated token probes', async t => {
  const request = await setup(t);
  for (let i = 0; i < 60; i++) assert.equal((await request('/invitations/bad', { user: null })).status, 401);
  const limited = await request('/invitations/bad', { user: null }); assert.equal(limited.status, 429); assert.equal(limited.headers.get('cache-control'), 'no-store');
});
test('membership revocation during public-profile lookup prevents disclosure to the former member', async t => {
  const data = isolatedInvitations(), original = data.memberships.publicProfiles;
  data.memberships.publicProfiles = async ids => {
    const rows = await original(ids);
    const group = [...data.groups.records.values()][0];
    group.members = group.members.filter(row => String(row.user) !== ownerB); group.__v++;
    return rows;
  };
  const request = await invitationApiSetup(t, { groupRepository: data.groups, invitationRepository: data.invitations, membershipRepository: data.memberships }), created = await createInvite(request);
  await request(created.acceptancePath, { method: 'POST', body: {}, user: ownerB });
  const result = await request(`/groups/${created.groupId}/members`, { user: ownerB }); assert.equal(result.status, 404); assert.equal(result.body.data, undefined);
});
