// This CLI has no local/remote fallback and is never invoked by the web server.
import { parseArgs } from 'node:util';
import { open, rename, readFile, unlink } from 'node:fs/promises';
import { dirname } from 'node:path';
import { privatePath } from '../src/config/operator-files.js';
import { randomUUID } from 'node:crypto';
import mongoose from 'mongoose';
import {
  freshApprovalPlan,
  approvedSchemaDigest,
  approvalDigest,
  validateSetupUri,
  provisionApprovedFresh,
} from '../src/config/approved-fresh-setup.js';

let client;

try {
  const { values } = parseArgs({
    options: {
      schema: { type: 'boolean' },
      review: { type: 'boolean' },
      plan: { type: 'string' },
      credentials: { type: 'string' },
      receipt: { type: 'string' },
      approve: { type: 'string' },
    },
    strict: true,
  });
  if (values.schema)
    process.stdout.write(JSON.stringify({ schemaDigest: approvedSchemaDigest }) + '\n');
  else {
    const plan = freshApprovalPlan.parse(
      JSON.parse(await readFile(await privatePath(values.plan), 'utf8')),
    );
    const digest = approvalDigest(plan);
    if (values.review)
      process.stdout.write(
        JSON.stringify({
          target: plan.target,
          setupId: plan.setupId,
          approvalDigest: digest,
          connected: false,
        }) + '\n',
      );
    else {
      if (values.approve !== digest) throw new Error('OPERATOR_APPROVAL_REQUIRED');
      const receiptPath = await privatePath(values.receipt, false);
      const credentials = JSON.parse(await readFile(await privatePath(values.credentials), 'utf8'));
      const uri = validateSetupUri(credentials.uri, plan);
      let receipt;
      try {
        receipt = JSON.parse(await readFile(receiptPath, 'utf8'));
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
      const lockPath = receiptPath + '.lock';
      const lock = await open(lockPath, 'wx', 0o600);
      try {
        client = new mongoose.mongo.MongoClient(uri, {
          appName: 'tallynest-approved-fresh-setup',
          maxPoolSize: 4,
          serverSelectionTimeoutMS: 10000,
          authSource: 'admin',
          readPreference: 'primary',
          readConcern: { level: 'majority' },
          writeConcern: { w: 'majority', j: true, wtimeoutMS: 10000 },
        });
        await client.connect();
        const hello = await client.db('admin').command({ hello: 1 });
        if (hello.setName !== plan.target.replicaSet)
          throw new Error('OPERATOR_REPLICA_SET_MISMATCH');
        await provisionApprovedFresh({
          db: client.db(plan.target.database),
          plan,
          approval: values.approve,
          receipt,
          saveReceipt: async (value) => {
            const temporary = receiptPath + '.' + randomUUID();
            const file = await open(temporary, 'wx', 0o600);
            try {
              await file.writeFile(JSON.stringify(value) + '\n');
              await file.sync();
            } finally {
              await file.close();
            }
            await rename(temporary, receiptPath);
            const directory = await open(dirname(receiptPath), 'r');
            try {
              await directory.sync();
            } finally {
              await directory.close();
            }
          },
        });
        process.stdout.write(
          JSON.stringify({ status: 'ready', target: plan.target, setupId: plan.setupId }) + '\n',
        );
      } finally {
        await client?.close();
        client = undefined;
        await lock.close();
        await unlink(lockPath);
      }
    }
  }
} catch (error) {
  // Parse/driver/tool errors may contain credentials or documents. Emit only fixed codes.
  process.stderr.write(
    /^OPERATOR_[A-Z_]+$/.test(error.message) || /^FRESH_[A-Z_]+$/.test(error.message)
      ? error.message + '\n'
      : 'OPERATOR_SETUP_FAILED\n',
  );
  process.exitCode = 1;
} finally {
  await client?.close();
}
