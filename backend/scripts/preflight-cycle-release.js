// Read-only inspection of a uniquely named local disposable migration rehearsal.
import mongoose from 'mongoose';
import { TEST_DATABASE } from '../src/migrations/cycle-v1/safety.js';
import { assessCycleReleasePreflight } from '../src/staged/release-preflight.js';

const [, , option, database] = process.argv;
if (option !== '--database' || !TEST_DATABASE.test(database ?? '')) {
  console.error('Specify one uniquely named disposable local rehearsal database with --database');
  process.exitCode = 1;
} else {
  let connection;
  try {
    connection = await mongoose
      .createConnection(`mongodb://127.0.0.1:27017/${database}`, {
        autoIndex: false,
        autoCreate: false,
        serverSelectionTimeoutMS: 10000,
        appName: 'tallynest-cycle-read-only-preflight',
      })
      .asPromise();
    const report = await assessCycleReleasePreflight(connection);
    console.log(JSON.stringify(report));
    process.exitCode = report.status === 'FAIL' ? 1 : 2;
  } catch {
    console.error('Read-only cycle preflight could not inspect the disposable database');
    process.exitCode = 1;
  } finally {
    await connection?.close();
  }
}
