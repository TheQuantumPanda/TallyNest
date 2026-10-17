import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { safeTarget } from '../src/migrations/cycle-v1/safety.js';
import { canonical } from '../src/migrations/cycle-v1/reconcile.js';
const database = 'tallynest_cycle_rehearsal_1792240000000_abcdef123456';
const base = {
  database,
  uri: `mongodb://127.0.0.1:27017/${database}`,
  maintenanceId: randomUUID(),
  offline: true,
  disposable: true,
  writersStopped: true,
};
test('migration target safety rejects implicit, development, production and ambiguous database destinations', () => {
  assert.equal(safeTarget(base).database, database);
  for (const patch of [
    { database: 'smart_finance_manager' },
    { database: 'tallynest' },
    { database: 'production' },
    { database: 'admin' },
    { database: undefined },
    { uri: `mongodb://localhost:27017/${database}` },
    { uri: `mongodb://127.0.0.1:27017/${database}?authSource=admin` },
    { uri: `mongodb+srv://example/${database}` },
    { uri: `mongodb://user:secret@127.0.0.1:27017/${database}` },
    { offline: false },
    { disposable: false },
    { writersStopped: false },
    { maintenanceId: 'yes' },
  ])
    assert.throws(() => safeTarget({ ...base, ...patch }));
});
test('canonical BSON fingerprint retains exact types and ignores object-key order', () => {
  assert.equal(canonical({ b: 1, a: '2' }), canonical({ a: '2', b: 1 }));
  assert.notEqual(canonical({ amount: 1 }), canonical({ amount: '1' }));
  assert.notEqual(canonical({ at: new Date('2026-10-01') }), canonical({ at: '2026-10-01' }));
});
