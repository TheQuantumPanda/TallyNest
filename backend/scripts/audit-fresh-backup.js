// Explicit read-only operator proof. Never called by startup, a route or a job.
import { parseArgs } from 'node:util';
import { readFile, open } from 'node:fs/promises';
import mongoose from 'mongoose';
import {
  freshApprovalPlan,
  approvalDigest,
  validateSetupUri,
} from '../src/config/approved-fresh-setup.js';
import { privatePath } from '../src/config/operator-files.js';
import { auditFreshBackup } from '../src/config/fresh-backup-audit.js';
let client;
try {
  const { values } = parseArgs({
    options: {
      plan: { type: 'string' },
      credentials: { type: 'string' },
      output: { type: 'string' },
      approve: { type: 'string' },
    },
    strict: true,
  });
  const plan = freshApprovalPlan.parse(
    JSON.parse(await readFile(await privatePath(values.plan), 'utf8')),
  );
  if (values.approve !== approvalDigest(plan)) throw new Error('OPERATOR_APPROVAL_REQUIRED');
  const credentials = JSON.parse(await readFile(await privatePath(values.credentials), 'utf8'));
  const uri = validateSetupUri(credentials.uri, plan),
    output = await privatePath(values.output, false);
  client = new mongoose.mongo.MongoClient(uri, {
    appName: 'tallynest-readonly-backup-proof',
    maxPoolSize: 2,
    authSource: 'admin',
    serverSelectionTimeoutMS: 10000,
    readConcern: { level: 'majority' },
    readPreference: 'primary',
  });
  await client.connect();
  if ((await client.db('admin').command({ hello: 1 })).setName !== plan.target.replicaSet)
    throw new Error('OPERATOR_REPLICA_SET_MISMATCH');
  const proof = await auditFreshBackup(client.db(plan.target.database));
  const file = await open(output, 'wx', 0o600);
  try {
    await file.writeFile(JSON.stringify(proof, null, 2) + '\n');
    await file.sync();
  } finally {
    await file.close();
  }
  // Detailed financial values belong only in the private proof file.
  process.stdout.write('Fresh backup audit passed; private proof written\n');
} catch (error) {
  process.stderr.write(
    /^OPERATOR_[A-Z_]+$|^FRESH_[A-Z_]+$/.test(error.message)
      ? error.message + '\n'
      : 'FRESH_BACKUP_AUDIT_FAILED\n',
  );
  process.exitCode = 1;
} finally {
  await client?.close();
}
