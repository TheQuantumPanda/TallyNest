import { parseArgs } from 'node:util';
import mongoose from 'mongoose';
import { installFreshCycleSchema } from '../src/config/fresh-cycle-setup.js';

const TEST_DATABASE = /^tallynest_fresh_v2_test_\d{13}_[a-f0-9]{12}$/;
const { values } = parseArgs({
  options: { database: { type: 'string' } },
  strict: true,
});
if (!TEST_DATABASE.test(values.database ?? ''))
  throw new Error('Setup accepts only a uniquely named disposable local fresh-v2 test database');

const uri = `mongodb://127.0.0.1:27017/${values.database}`;
const client = new mongoose.mongo.MongoClient(uri, {
  serverSelectionTimeoutMS: 10000,
  appName: 'tallynest-fresh-test-setup',
});
try {
  await client.connect();
  const result = await installFreshCycleSchema(client.db());
  console.log(JSON.stringify({ status: 'ok', database: values.database, ...result }));
} catch (error) {
  console.error(
    `Fresh setup failed: ${error.message.startsWith('FRESH_') ? error.message : 'database setup error'}`,
  );
  process.exitCode = 1;
} finally {
  await client.close();
}
