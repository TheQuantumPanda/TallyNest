// Exercises the ordinary server.js + vite composition against one fresh disposable local DB.
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import mongoose from 'mongoose';

if (process.env.MONGO_URI && process.env.MONGO_URI !== 'mongodb://127.0.0.1:27017')
  throw new Error('Normal browser verification permits only local MongoDB');
const backend = fileURLToPath(new URL('../', import.meta.url));
const frontend = fileURLToPath(new URL('../../frontend/', import.meta.url));
const database = `tallynest_fresh_v2_test_${Date.now()}_${randomBytes(6).toString('hex')}`;
const password = `Browser-${randomBytes(18).toString('base64url')}!9a`;
const uri = `mongodb://127.0.0.1:27017/${database}`;
const pattern = /^tallynest_fresh_v2_test_\d{13}_[a-f0-9]{12}$/;
let api, vite, failed;

function waitForLine(child, pattern, message) {
  return new Promise((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => reject(new Error(message)), 60000);
    const onData = (chunk) => {
      output += chunk.toString();
      const match = pattern.exec(output);
      if (match) {
        clearTimeout(timer);
        child.stdout.off('data', onData);
        resolve(match);
      }
      if (output.length > 8000) output = output.slice(-4000);
    };
    child.stdout.on('data', onData);
    child.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`Service exited before readiness (${code})`));
    });
  });
}
async function waitFor(url) {
  for (let i = 0; i < 80; i += 1) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      // Service is starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('Disposable service did not become ready');
}
async function stop(child) {
  if (!child || child.exitCode !== null) return;
  child.kill('SIGINT');
  await Promise.race([
    new Promise((resolve) => child.once('exit', resolve)),
    new Promise((resolve) => setTimeout(resolve, 12000)),
  ]);
  if (child.exitCode === null) child.kill('SIGKILL');
}
async function setup() {
  const { MongoClient } = mongoose.mongo;
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 10000 });
  try {
    await client.connect();
    const { installFreshCycleSchema } = await import('../src/config/fresh-cycle-setup.js');
    await installFreshCycleSchema(client.db());
  } finally {
    await client.close();
  }
}
async function cleanup() {
  if (!pattern.test(database)) throw new Error('Unexpected cleanup target');
  const client = new mongoose.mongo.MongoClient('mongodb://127.0.0.1:27017', {
    serverSelectionTimeoutMS: 10000,
  });
  await client.connect();
  try {
    await new Promise((resolve) => setTimeout(resolve, 750));
    const listed = async () =>
      (await client.db().admin().listDatabases({ nameOnly: true })).databases.some(
        (entry) => entry.name === database,
      );
    if (await listed()) await client.db(database).dropDatabase();
    await new Promise((resolve) => setTimeout(resolve, 750));
    if (await listed()) throw new Error('Disposable database was recreated after cleanup');
    process.stdout.write(`Verified normal browser database cleanup: ${database}\n`);
  } finally {
    await client.close();
  }
}

try {
  await setup();
  api = spawn(process.execPath, ['server.js'], {
    cwd: backend,
    env: {
      ...process.env,
      NODE_ENV: 'test',
      PORT: '5500',
      MONGO_URI: uri,
      JWT_SECRET: randomBytes(32).toString('hex'),
      CLIENT_ORIGIN: 'http://localhost:5173',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await waitForLine(api, /TallyNest API listening on port 5500/, 'Normal API did not start');
  vite = spawn(
    fileURLToPath(new URL('../../frontend/node_modules/.bin/vite', import.meta.url)),
    ['--host', 'localhost', '--port', '5173', '--strictPort'],
    {
      cwd: frontend,
      env: { ...process.env, VITE_API_URL: 'http://localhost:5500/api' },
      stdio: 'ignore',
    },
  );
  await waitFor('http://localhost:5173');
  const tests = spawn(
    fileURLToPath(new URL('../../frontend/node_modules/.bin/playwright', import.meta.url)),
    ['test', '--config', 'playwright.normal.config.js'],
    {
      cwd: frontend,
      env: { ...process.env, TALLYNEST_NORMAL_E2E_PASSWORD: password },
      stdio: 'inherit',
    },
  );
  const code = await new Promise((resolve) => tests.once('exit', resolve));
  failed = code !== 0;
} catch (error) {
  failed = true;
  process.stderr.write(`${error.message}\n`);
} finally {
  await stop(vite);
  await stop(api);
  try {
    await cleanup();
  } catch (error) {
    failed = true;
    process.stderr.write(`${error.message}\n`);
  }
}
process.exitCode = failed ? 1 : 0;
