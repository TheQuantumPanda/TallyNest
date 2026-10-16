import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { expense, ownerB } from './transaction-api.js';
import { schedule } from './recurring-api.js';
export function creationContract(setup) {
  for (const resource of ['transaction', 'schedule']) {
    test(`${resource} creation requires UUID, replays normalized intent, retains receipts after edit and delete`, async (t) => {
      const request = await setup(t, resource),
        input = resource === 'transaction' ? expense : schedule;
      for (const key of ['', 'bad', 'a'.repeat(36)]) {
        const invalid = await request('', {
          method: 'POST',
          body: input,
          headers: { 'Idempotency-Key': key },
        });
        assert.equal(invalid.status, 400);
        assert.equal(invalid.body.code, 'IDEMPOTENCY_KEY_REQUIRED');
      }
      const key = randomUUID(),
        headers = { 'Idempotency-Key': key };
      const first = await request('', {
        method: 'POST',
        body: { ...input, currency: undefined, title: ` ${input.title} ` },
        headers,
      });
      assert.equal(first.status, 201);
      assert.equal(first.body.data.replayed, false);
      const row = first.body.data[resource];
      const replay = await request('', { method: 'POST', body: input, headers });
      assert.equal(replay.status, 200);
      assert.equal(replay.body.data.replayed, true);
      assert.equal(replay.body.data[resource].id, row.id);
      for (const field of ['creationKey', 'creationHash', 'deletedAt', 'owner'])
        assert.equal(Object.hasOwn(row, field), false);
      const other = await request('', { method: 'POST', body: input, user: ownerB, headers });
      assert.equal(other.status, 201);
      assert.notEqual(other.body.data[resource].id, row.id);
      const conflict = await request('', {
        method: 'POST',
        body: { ...input, amountMinor: 1 },
        headers,
      });
      assert.equal(conflict.status, 409);
      assert.equal(conflict.body.code, 'IDEMPOTENCY_CONFLICT');
      assert.equal(
        (
          await request('/' + row.id, {
            method: 'PATCH',
            body: { title: 'Edited later' },
            headers: { 'If-Match': first.headers.get('etag') },
          })
        ).status,
        200,
      );
      const edited = await request('', { method: 'POST', body: input, headers });
      assert.equal(edited.status, 200);
      assert.equal(edited.body.data[resource].title, 'Edited later');
      assert.equal(edited.body.data[resource].version, 1);
      assert.equal((await request('/' + row.id, { method: 'DELETE' })).status, 200);
      assert.equal((await request('/' + row.id)).status, 404);
      const deleted = await request('', { method: 'POST', body: input, headers });
      assert.equal(deleted.status, 409);
      assert.equal(deleted.body.code, 'CREATION_DELETED');
      assert.deepEqual(
        (await request()).body.data[resource === 'transaction' ? 'transactions' : 'schedules'],
        [],
      );
    });
  }
}
