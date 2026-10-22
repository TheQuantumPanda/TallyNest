import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import {
  approvedSchemaDigest,
  freshApprovalPlan,
  approvalDigest,
  validateSetupUri,
  provisionApprovedFresh,
} from '../src/config/approved-fresh-setup.js';
const plan = () => ({
  formatVersion: 1,
  setupId: randomUUID(),
  purpose: 'generated-data-only',
  target: {
    srvHost: 'cluster0.fixture.mongodb.net',
    database: 'tn_rehearsal_012345abcdef',
    replicaSet: 'atlas-fixture-shard-0',
  },
  schemaDigest: approvedSchemaDigest,
  writersStopped: true,
  runtimeCredentialWithheld: true,
});
test('approval binds the exact fresh schema, target, unique setup and stopped-writer attestation', async () => {
  const value = plan();
  assert.notEqual(approvalDigest(value), approvalDigest({ ...value, setupId: randomUUID() }));
  for (const extra of [
    { writersStopped: false },
    { schemaDigest: '0'.repeat(64) },
    { purpose: 'production' },
    { target: { ...value.target, database: 'production' } },
  ])
    assert.throws(() => freshApprovalPlan.parse({ ...value, ...extra }));
  let contacted = false;
  await assert.rejects(
    provisionApprovedFresh({
      db: {
        get databaseName() {
          contacted = true;
          return 'unexpected';
        },
      },
      plan: value,
      approval: 'not approved',
    }),
    /OPERATOR_APPROVAL_REQUIRED/,
  );
  assert.equal(contacted, false);
});
test('hosted URI identity requires SRV TLS defaults, credentials, exact DB/host and safe options', () => {
  const value = plan(),
    uri = `mongodb+srv://user:private-password@${value.target.srvHost}/${value.target.database}`;
  assert.equal(
    validateSetupUri(uri + '?retryWrites=true&w=majority', value),
    uri + '?retryWrites=true&w=majority',
  );
  for (const bad of [
    uri.replace('cluster0', 'other'),
    uri.replace(value.target.database, 'other'),
    uri + '?tls=false',
    uri + '?readPreference=secondary',
    uri.replace('mongodb+srv', 'mongodb'),
    uri.replace('user:private-password@', ''),
  ])
    assert.throws(() => validateSetupUri(bad, value), /OPERATOR_URI_TARGET_MISMATCH/);
});
test('operator CLI review is offline; approval is required before reading credentials or connecting', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'tallynest-operator-plan-'));
  try {
    const file = join(directory, 'plan.json');
    await writeFile(file, JSON.stringify(plan()), { mode: 0o600 });
    const run = promisify(execFile);
    const reviewed = await run(process.execPath, [
      'scripts/provision-approved-fresh.js',
      '--plan',
      file,
      '--review',
    ]);
    assert.equal(JSON.parse(reviewed.stdout).connected, false);
    const refused = await run(process.execPath, [
      'scripts/provision-approved-fresh.js',
      '--plan',
      file,
    ]).catch((error) => error);
    assert.equal(refused.code, 1);
    assert.match(refused.stderr, /OPERATOR_APPROVAL_REQUIRED/);
    assert.ok(!refused.stderr.includes('private-password'));
    const auditRefused = await run(process.execPath, [
      'scripts/audit-fresh-backup.js',
      '--plan',
      file,
    ]).catch((error) => error);
    assert.equal(auditRefused.code, 1);
    assert.match(auditRefused.stderr, /OPERATOR_APPROVAL_REQUIRED/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
