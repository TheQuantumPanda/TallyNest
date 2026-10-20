// Keep disposable suites from outrunning WiredTiger's asynchronous dropped-ident reaper.
// This launcher reads server metrics only; each suite retains ownership of its own DB cleanup.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import mongoose from 'mongoose';

const base = 'mongodb://127.0.0.1:27017';
if (process.env.MONGO_URI && process.env.MONGO_URI !== base)
  throw new Error('Mongo verification permits only the existing local disposable test service');
const files = process.argv.slice(2);
if (!files.length || files.some((file) => !/^integration\/[a-z0-9-]+\.mongo\.js$/.test(file)))
  throw new Error('Explicit integration test files are required');
const cwd = fileURLToPath(new URL('../', import.meta.url));
const client = new mongoose.mongo.MongoClient(base, {
  maxPoolSize: 1,
  serverSelectionTimeoutMS: 10000,
});
const totals = { tests: 0, pass: 0, fail: 0, skipped: 0 };
let baseline;
let activeChild;
let interrupted = false;
for (const signal of ['SIGINT', 'SIGTERM'])
  process.once(signal, () => {
    interrupted = true;
    activeChild?.kill(signal);
  });
async function resources() {
  const status = await client.db('admin').command({ serverStatus: 1, maxTimeMS: 5000 });
  const open = status.wiredTiger?.connection?.['files currently open'];
  const pending = status.storageEngine?.dropPendingIdents;
  if (!Number.isSafeInteger(open) || !Number.isSafeInteger(pending))
    throw new Error('WiredTiger resource metrics are required for bounded local verification');
  return { open, pending };
}
async function waitForCleanup() {
  const deadline = Date.now() + 90000;
  let announced = false;
  while (true) {
    if (interrupted) throw new Error('MongoDB verification interrupted');
    const { open, pending } = await resources();
    if (open <= Math.min(baseline + 128, 384)) {
      if (announced) process.stdout.write(`Descriptor headroom restored (${open} open files)\n`);
      return;
    }
    if (!announced) {
      process.stdout.write(
        `Waiting for dropped-ident cleanup (${open} open files, ${pending} pending)\n`,
      );
      announced = true;
    }
    if (Date.now() >= deadline)
      throw new Error(
        'Dropped-ident cleanup did not leave safe headroom; no next suite was started',
      );
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}
async function run(file) {
  process.stdout.write(`Serial disposable MongoDB suite: ${file}\n`);
  const child = spawn(
    process.execPath,
    ['--test', '--test-concurrency=1', '--test-reporter=spec', file],
    { cwd, env: process.env, stdio: ['ignore', 'pipe', 'inherit'] },
  );
  activeChild = child;
  let summary = '';
  child.stdout.on('data', (chunk) => {
    process.stdout.write(chunk);
    summary = (summary + chunk.toString()).slice(-16000);
  });
  const code = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', resolve);
  });
  activeChild = null;
  if (code !== 0) throw new Error(`MongoDB suite failed: ${file}`);
  // Spec summaries include nested subtests, matching the previous single-runner counts.
  for (const field of Object.keys(totals)) {
    const match = new RegExp(`ℹ ${field} (\\d+)`).exec(summary);
    if (!match) throw new Error(`Missing ${field} summary for ${file}`);
    totals[field] += Number(match[1]);
  }
}
try {
  await client.connect();
  baseline = (await resources()).open;
  if (baseline > 512)
    throw new Error('Insufficient initial descriptor headroom for local MongoDB suites');
  process.stdout.write(
    `WiredTiger baseline: ${baseline} open files; container limits are unchanged\n`,
  );
  for (const file of files) {
    await waitForCleanup();
    await run(file);
    await waitForCleanup();
  }
  process.stdout.write(
    `MongoDB verification totals: ${JSON.stringify(totals)} across ${files.length} serial files\n`,
  );
} catch (error) {
  process.exitCode = 1;
  process.stderr.write(`${error.message}\n`);
} finally {
  await client.close();
}
