// Explicit local disposable launcher; absent from ordinary API startup and the root verification gate.
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import mongoose from 'mongoose';

const backend = fileURLToPath(new URL('../', import.meta.url));
const frontend = fileURLToPath(new URL('../../frontend/', import.meta.url));
const databasePattern = /^tallynest_cycle_http_test_\d{13}_[a-f0-9]{12}$/;
if (process.env.MONGO_URI && process.env.MONGO_URI !== 'mongodb://127.0.0.1:27017')
  throw new Error('Browser verification requires local disposable MongoDB');

const password = randomBytes(27).toString('base64url');
let api, vite, database;

function awaitLine(child, pattern, timeoutMs = 60000) {
  return new Promise((resolve, reject) => {
    let output = '';
    const timeout = setTimeout(
      () => reject(new Error('Disposable service did not become ready')),
      timeoutMs,
    );
    const receive = (chunk) => {
      output += chunk.toString();
      const match = pattern.exec(output);
      if (match) {
        clearTimeout(timeout);
        child.stdout.off('data', receive);
        resolve(match);
      }
      if (output.length > 8000) output = output.slice(-4000);
    };
    child.stdout.on('data', receive);
    child.once('exit', (code) => {
      clearTimeout(timeout);
      reject(new Error(`Disposable service exited before readiness (${code})`));
    });
  });
}
async function waitFor(url) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // The process is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('Disposable browser service did not respond');
}
async function stop(child) {
  if (!child || child.exitCode !== null) return;
  child.kill('SIGINT');
  await new Promise((resolve) => {
    const timeout = setTimeout(resolve, 15000);
    child.once('exit', () => {
      clearTimeout(timeout);
      resolve();
    });
  });
  if (child.exitCode === null) child.kill('SIGKILL');
}
async function assertClean() {
  if (!database) return;
  if (!databasePattern.test(database)) throw new Error('Unexpected disposable database identity');
  const client = new mongoose.mongo.MongoClient('mongodb://127.0.0.1:27017', {
    serverSelectionTimeoutMS: 10000,
  });
  await client.connect();
  try {
    const exists = async () =>
      (await client.db().admin().listDatabases({ nameOnly: true })).databases.some(
        (row) => row.name === database,
      );
    // Check after all Mongoose/fixture workers have stopped, then recheck for late recreation.
    await new Promise((resolve) => setTimeout(resolve, 1000));
    if (await exists()) {
      await client.db(database).dropDatabase();
      throw new Error('Fixture left a disposable database behind; it was removed');
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
    if (await exists()) throw new Error('Disposable database was recreated after fixture exit');
    process.stdout.write('Verified disposable browser database cleanup\n');
  } finally {
    await client.close();
  }
}

let failed;
try {
  api = spawn(process.execPath, ['integration/cycle-ui-server.js'], {
    cwd: backend,
    env: {
      ...process.env,
      NODE_ENV: 'test',
      TALLYNEST_CYCLE_FIXTURE: 'disposable-local',
      TALLYNEST_CYCLE_FIXTURE_PASSWORD: password,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const match = await awaitLine(api, /Database: (tallynest_cycle_http_test_\d{13}_[a-f0-9]{12})/);
  database = match[1];
  vite = spawn(
    fileURLToPath(new URL('../../frontend/node_modules/.bin/vite', import.meta.url)),
    ['--config', 'vite.cycle.config.js'],
    {
      cwd: frontend,
      env: { ...process.env, VITE_API_URL: 'http://localhost:5007/api' },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  await waitFor('http://localhost:5174');
  const tests = spawn(
    fileURLToPath(new URL('../../frontend/node_modules/.bin/playwright', import.meta.url)),
    ['test', '--config', 'playwright.cycle.config.js'],
    {
      cwd: frontend,
      env: { ...process.env, TALLYNEST_CYCLE_E2E_PASSWORD: password },
      stdio: 'inherit',
    },
  );
  const result = await new Promise((resolve) => tests.once('exit', resolve));
  failed = result !== 0;
} catch (error) {
  failed = true;
  process.stderr.write(`${error.message}\n`);
} finally {
  await stop(vite);
  await stop(api);
  try {
    await assertClean();
  } catch (error) {
    failed = true;
    process.stderr.write(`${error.message}\n`);
  }
}
process.exitCode = failed ? 1 : 0;
