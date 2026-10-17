import { parseArgs } from 'node:util';
import { migrateCycles } from '../src/migrations/cycle-v1/migrate.js';
try {
  const { values } = parseArgs({
    options: {
      uri: { type: 'string' },
      database: { type: 'string' },
      'maintenance-id': { type: 'string' },
      'backup-manifest': { type: 'string' },
      offline: { type: 'boolean' },
      disposable: { type: 'boolean' },
      'writers-stopped': { type: 'boolean' },
    },
  });
  const result = await migrateCycles({
    uri: values.uri,
    database: values.database,
    maintenanceId: values['maintenance-id'],
    backupManifest: values['backup-manifest'],
    offline: values.offline,
    disposable: values.disposable,
    writersStopped: values['writers-stopped'],
  });
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 2;
} catch (error) {
  console.error(
    JSON.stringify({
      ok: false,
      code: error.code && /^[A-Z_]+$/.test(error.code) ? error.code : 'MIGRATION_STOPPED',
    }),
  );
  process.exitCode = 1;
}
