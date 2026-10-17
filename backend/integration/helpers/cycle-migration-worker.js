import { once } from 'node:events';
import { migrateCycles } from '../../src/migrations/cycle-v1/migrate.js';
const input = JSON.parse(process.env.TALLYNEST_MIGRATION_INPUT);
try {
  const result = await migrateCycles(input, {
    batchSize: 1,
    fault: async (stage) => {
      if (stage === process.env.TALLYNEST_MIGRATION_STOP) {
        process.send?.({ stage });
        await once(process, 'message');
      }
    },
  });
  process.send?.({ ok: result.ok });
  if (!result.ok) process.exitCode = 2;
} catch (error) {
  process.send?.({ error: error.code ?? 'MIGRATION_STOPPED' });
  process.exitCode = 1;
} finally {
  if (process.connected) process.disconnect();
}
