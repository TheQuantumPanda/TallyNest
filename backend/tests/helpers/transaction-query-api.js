import test from 'node:test';
import assert from 'node:assert/strict';
import { expense, income, ownerA, ownerB } from './transaction-api.js';

const path = (query) => '?' + new URLSearchParams(query).toString();
async function seed(request, count) {
  const rows = [];
  for (let i = 0; i < count; i += 1) {
    const response = await request('', {
      method: 'POST',
      body: {
        ...expense,
        title: `Entry ${i}`,
        amountMinor: (Math.floor(i / 2) + 1) * 100,
        transactionDate: `2026-10-${String(10 + Math.floor(i / 4)).padStart(2, '0')}T00:00:00.000Z`,
      },
    });
    assert.equal(response.status, 201);
    rows.push(response.body.data.transaction);
  }
  return rows;
}
const etag = (row) => `"tn-${row.id}-v${row.version}"`;

export function transactionQueryContract(setup) {
  test('default pagination returns 20 plus an opaque next cursor, then final page', async (t) => {
    const request = await setup(t);
    await seed(request, 26);
    const first = await request();
    assert.equal(first.status, 200);
    assert.equal(first.body.data.transactions.length, 20);
    assert.equal(first.body.pagination.limit, 20);
    assert.equal(first.body.pagination.hasMore, true);
    assert.match(first.body.pagination.nextCursor, /^v1\.[A-Za-z0-9_-]+$/);
    assert.equal(first.body.pagination.nextCursor.includes(ownerA), false);
    const second = await request(path({ cursor: first.body.pagination.nextCursor }));
    assert.equal(second.body.data.transactions.length, 6);
    assert.deepEqual(second.body.pagination, { limit: 20, hasMore: false, nextCursor: null });
    assert.equal(
      new Set(
        [...first.body.data.transactions, ...second.body.data.transactions].map((row) => row.id),
      ).size,
      26,
    );
  });

  test('custom limit and maximum page size are enforced', async (t) => {
    const request = await setup(t);
    await seed(request, 5);
    const response = await request('?limit=2');
    assert.equal(response.body.data.transactions.length, 2);
    assert.equal(response.body.pagination.limit, 2);
    assert.equal((await request('?limit=100')).body.pagination.limit, 100);
    for (const limit of ['0', '101', '-1', '1.5', '1e2', '01', '', '1000']) {
      assert.equal((await request(path({ limit }))).status, 400);
    }
  });

  test('empty results and exact page-size endings return no cursor', async (t) => {
    const request = await setup(t);
    assert.deepEqual((await request()).body.pagination, {
      limit: 20,
      hasMore: false,
      nextCursor: null,
    });
    await seed(request, 2);
    const page = await request('?limit=2');
    assert.equal(page.body.pagination.hasMore, false);
    assert.equal(page.body.pagination.nextCursor, null);
  });

  for (const sortBy of ['transactionDate', 'amountMinor']) {
    for (const sortOrder of ['asc', 'desc']) {
      test(`keyset traversal is stable for ${sortBy} ${sortOrder} with duplicate values`, async (t) => {
        const request = await setup(t);
        const rows = await seed(request, 13);
        const direction = sortOrder === 'asc' ? 1 : -1;
        const expected = rows
          .sort((a, b) => {
            const primary =
              sortBy === 'transactionDate'
                ? a[sortBy].localeCompare(b[sortBy])
                : a[sortBy] - b[sortBy];
            return (primary || a.id.localeCompare(b.id)) * direction;
          })
          .map((row) => row.id);
        const actual = [];
        let cursor;
        do {
          const response = await request(
            path({ sortBy, sortOrder, limit: '3', ...(cursor ? { cursor } : {}) }),
          );
          assert.equal(response.status, 200);
          actual.push(...response.body.data.transactions.map((row) => row.id));
          cursor = response.body.pagination.nextCursor;
          assert.equal(response.body.pagination.hasMore, cursor !== null);
        } while (cursor);
        assert.deepEqual(actual, expected);
      });
    }
  }

  test('type, category, currency, UTC ranges, and combined filters behave consistently', async (t) => {
    const request = await setup(t);
    const fixtures = [
      { ...expense, title: 'Early lunch', transactionDate: '2026-10-01T00:00:00.000Z' },
      { ...income, title: 'Salary', transactionDate: '2026-10-02T00:00:00.000Z' },
      { ...expense, title: 'Late lunch', transactionDate: '2026-10-03T00:00:00.000Z' },
      {
        ...expense,
        category: 'other',
        title: 'Other',
        transactionDate: '2026-10-04T00:00:00.000Z',
      },
    ];
    for (const body of fixtures)
      assert.equal((await request('', { method: 'POST', body })).status, 201);
    await request('', { method: 'POST', body: expense, user: ownerB });
    assert.equal((await request('?type=income')).body.data.transactions.length, 1);
    assert.equal((await request('?category=food_dining')).body.data.transactions.length, 2);
    assert.equal((await request('?currency=INR')).body.data.transactions.length, 4);
    const dates = { from: '2026-10-02T00:00:00.000Z', to: '2026-10-04T00:00:00.000Z' };
    const range = await request(path(dates));
    assert.deepEqual(
      range.body.data.transactions.map((row) => row.title),
      ['Late lunch', 'Salary'],
    );
    const combined = await request(
      path({
        ...dates,
        type: 'expense',
        category: 'food_dining',
        currency: 'INR',
        search: 'LUNCH',
      }),
    );
    assert.deepEqual(
      combined.body.data.transactions.map((row) => row.title),
      ['Late lunch'],
    );
    assert.deepEqual((await request('?type=income&category=gifts')).body.data.transactions, []);
  });

  test('title search is a case-insensitive literal substring, including regex metacharacters', async (t) => {
    const request = await setup(t);
    for (const title of ['Budget .* literal', 'Budget ordinary', 'Other']) {
      await request('', { method: 'POST', body: { ...expense, title } });
    }
    const literal = await request(path({ search: '.*' }));
    assert.deepEqual(
      literal.body.data.transactions.map((row) => row.title),
      ['Budget .* literal'],
    );
    assert.equal((await request('?search=budget')).body.data.transactions.length, 2);
    assert.equal((await request(path({ search: '[a-z]+' }))).body.data.transactions.length, 0);
  });

  test('malformed and tampered cursors fail gracefully', async (t) => {
    const request = await setup(t);
    await seed(request, 3);
    const cursor = (await request('?limit=1')).body.pagination.nextCursor;
    const tampered = cursor.slice(0, 5) + (cursor[5] === 'A' ? 'B' : 'A') + cursor.slice(6);
    for (const bad of [
      'garbage',
      'v1.AA',
      'v1.',
      tampered,
      cursor + '=',
      'v1.' + 'A'.repeat(2050),
    ]) {
      const response = await request(path({ limit: '1', cursor: bad }));
      assert.equal(response.status, 400);
      assert.equal(response.body.stack, undefined);
    }
  });

  test('cursors bind filters and sorting, allow page size changes, and reject another owner', async (t) => {
    const request = await setup(t);
    await seed(request, 4);
    const query = { limit: '1', type: 'expense', sortBy: 'amountMinor', sortOrder: 'asc' };
    const cursor = (await request(path(query))).body.pagination.nextCursor;
    for (const change of [
      { type: 'income' },
      { category: 'other' },
      { sortBy: 'transactionDate' },
      { sortOrder: 'desc' },
      { search: 'Entry' },
      { from: '2026-10-01T00:00:00.000Z' },
    ]) {
      const response = await request(path({ ...query, ...change, cursor }));
      assert.equal(response.status, 400);
      assert.equal(response.body.code, 'INVALID_CURSOR');
    }
    const foreign = await request(path({ ...query, cursor }), { user: ownerB });
    assert.equal(foreign.status, 400);
    assert.equal(foreign.body.code, 'INVALID_CURSOR');
    const resized = await request(path({ ...query, limit: '2', cursor }));
    assert.equal(resized.status, 200);
    assert.equal(resized.body.data.transactions.length, 2);
  });

  test('every query parameter is strict, validated and protected against operator injection', async (t) => {
    const request = await setup(t);
    const invalid = [
      '?type=transfer',
      '?category=unknown',
      '?currency=USD',
      '?type=income&category=food_dining',
      '?sortBy=title',
      '?sortOrder=up',
      '?limit=2&limit=3',
      '?sortBy=amountMinor&sortBy=transactionDate',
      '?owner=' + ownerB,
      '?type[$ne]=expense',
      '?$where=true',
      '?search[$regex]=.*',
      '?from=2026-10-01',
      '?from=2026-02-30T00:00:00.000Z',
      '?search=',
      '?search=' + 'a'.repeat(81),
      path({ from: expense.transactionDate, to: expense.transactionDate }),
      path({ from: '2026-10-14T00:00:00.000Z', to: expense.transactionDate }),
      '?cursor[$ne]=null',
    ];
    for (const query of invalid) {
      const response = await request(query);
      assert.equal(response.status, 400, query);
      assert.equal(response.body.code, 'INVALID_QUERY');
    }
    assert.equal((await request('?limit=2', { user: null })).status, 401);
  });

  test('client-visible versions and strong ETags permit matching updates and reject stale clients', async (t) => {
    const request = await setup(t);
    const created = await request('', { method: 'POST', body: expense });
    const row = created.body.data.transaction;
    assert.equal(row.version, 0);
    assert.equal(created.headers.get('etag'), etag(row));
    const rejected = await request('/' + row.id, {
      method: 'PATCH',
      body: { version: 0 },
      headers: { 'If-Match': etag(row) },
    });
    assert.equal(rejected.status, 400);
    assert.equal(rejected.body.code, 'INVALID_TRANSACTION');
    const fetched = await request('/' + row.id);
    assert.equal(fetched.headers.get('etag'), etag(row));
    assert.equal((await request()).body.data.transactions[0].version, 0);
    const updated = await request('/' + row.id, {
      method: 'PATCH',
      body: { title: 'New' },
      headers: { 'If-Match': etag(row) },
    });
    assert.equal(updated.status, 200);
    assert.equal(updated.body.data.transaction.version, 1);
    assert.equal(updated.headers.get('etag'), etag(updated.body.data.transaction));
    const stale = await request('/' + row.id, {
      method: 'PATCH',
      body: { title: 'Stale' },
      headers: { 'If-Match': etag(row) },
    });
    assert.equal(stale.status, 412);
    assert.equal(stale.body.code, 'VERSION_MISMATCH');
    assert.equal((await request('/' + row.id)).body.data.transaction.title, 'New');
  });

  test('PATCH requires a single resource-specific strong If-Match; ownership checks remain scoped', async (t) => {
    const request = await setup(t);
    const row = (await request('', { method: 'POST', body: expense })).body.data.transaction;
    const missing = await request('/' + row.id, { method: 'PATCH', body: { title: 'Edit' } });
    assert.equal(missing.status, 428);
    assert.equal(missing.body.code, 'PRECONDITION_REQUIRED');
    for (const header of [
      '',
      '*',
      'W/' + etag(row),
      etag(row) + ', ' + etag(row),
      `"tn-${ownerB}-v0"`,
      `"tn-${row.id}-v9007199254740992"`,
    ]) {
      const response = await request('/' + row.id, {
        method: 'PATCH',
        body: { title: 'Edit' },
        headers: { 'If-Match': header },
      });
      assert.equal(response.status, 400);
      assert.equal(response.body.code, 'INVALID_VERSION');
    }
    const foreign = await request('/' + row.id, {
      method: 'PATCH',
      body: { title: 'Edit' },
      user: ownerB,
      headers: { 'If-Match': etag(row) },
    });
    assert.equal(foreign.status, 404);
    const preflight = await request('', {
      method: 'OPTIONS',
      headers: { 'Access-Control-Request-Headers': 'If-Match' },
    });
    assert.match(preflight.headers.get('access-control-allow-headers'), /If-Match/i);
    assert.match(foreign.headers.get('access-control-expose-headers'), /ETag/i);
  });

  test('a deleted cursor anchor does not prevent traversal of remaining matching records', async (t) => {
    const request = await setup(t);
    const rows = await seed(request, 4);
    const first = await request('?limit=2&sortBy=amountMinor&sortOrder=asc');
    const anchor = first.body.data.transactions.at(-1);
    assert.equal((await request('/' + anchor.id, { method: 'DELETE' })).status, 200);
    const next = await request(
      path({
        limit: '2',
        sortBy: 'amountMinor',
        sortOrder: 'asc',
        cursor: first.body.pagination.nextCursor,
      }),
    );
    assert.equal(next.status, 200);
    const seen = [...first.body.data.transactions, ...next.body.data.transactions].map(
      (row) => row.id,
    );
    assert.equal(new Set(seen).size, 4);
    assert.deepEqual(new Set(seen), new Set(rows.map((row) => row.id)));
  });
}
