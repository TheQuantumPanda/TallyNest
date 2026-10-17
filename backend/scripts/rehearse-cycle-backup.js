import { parseArgs } from 'node:util';
import mongoose from 'mongoose';
import { safeTarget } from '../src/migrations/cycle-v1/safety.js';
import { rehearsalBackup } from '../src/migrations/cycle-v1/backup.js';
let connection;
try {
  const { values } = parseArgs({
    options: {
      uri: { type: 'string' },
      database: { type: 'string' },
      'maintenance-id': { type: 'string' },
      'restore-database': { type: 'string' },
      directory: { type: 'string' },
      offline: { type: 'boolean' },
      disposable: { type: 'boolean' },
      'writers-stopped': { type: 'boolean' },
    },
  });
  const target = safeTarget({
    uri: values.uri,
    database: values.database,
    maintenanceId: values['maintenance-id'],
    offline: values.offline,
    disposable: values.disposable,
    writersStopped: values['writers-stopped'],
  });
  if (!values.directory) throw new Error('Backup directory required');
  connection = await mongoose
    .createConnection(target.uri, { autoIndex: false, autoCreate: false })
    .asPromise();
  const manifest = await rehearsalBackup({
    db: connection.db,
    database: target.database,
    restoreDatabase: values['restore-database'],
    directory: values.directory,
  });
  console.log(JSON.stringify({ ok: true, manifest, restored: true }));
} catch {
  console.error(JSON.stringify({ ok: false, code: 'BACKUP_REHEARSAL_STOPPED' }));
  process.exitCode = 1;
} finally {
  await connection?.close();
}
