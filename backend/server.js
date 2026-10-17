import { ensureSettlementIndexes } from './src/repositories/settlement.repository.js';
import { ensureGroupExpenseIndexes } from './src/repositories/group-expense.repository.js';
import { ensureGroupIndexes } from './src/repositories/group.repository.js';
import { ensureGroupFinancialCycleIndexes } from './src/repositories/group-financial-cycle.repository.js';
import { ensureRecurringIndexes } from './src/repositories/recurring.repository.js';
import { startRecurringJob } from './src/jobs/recurring.job.js';
import { createServer } from 'node:http';
import { createApp } from './app.js';
import { loadEnv } from './src/config/env.js';
import { assertNoCycleMaintenance } from './src/config/cycle-maintenance.js';
import { connectDB, disconnectDB } from './src/config/db.js';
import { ensureUserIndexes } from './src/repositories/user.repository.js';
import { ensureBudgetIndexes } from './src/repositories/budget.repository.js';

let server;
let stopRecurringJob;
let shuttingDown = false;

async function shutdown(signal, exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.info(`Shutting down (${signal})`);

  // Bound shutdown if requests or database operations fail to finish.
  const deadline = setTimeout(() => {
    console.error('Shutdown timed out');
    process.exit(1);
  }, 10000);
  deadline.unref();

  try {
    if (server?.listening) {
      await new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
    await stopRecurringJob?.();
    await disconnectDB();
    process.exitCode = exitCode;
  } catch {
    console.error('Failed to close HTTP server or MongoDB connection');
    process.exitCode = 1;
  } finally {
    clearTimeout(deadline);
  }
}

async function start() {
  try {
    const config = loadEnv();
    await assertNoCycleMaintenance(config.mongoUri);
    await connectDB(config.mongoUri);
    await ensureUserIndexes();
    await ensureBudgetIndexes();
    await ensureRecurringIndexes();
    await ensureGroupIndexes();
    await ensureGroupFinancialCycleIndexes();
    await ensureGroupExpenseIndexes();
    await ensureSettlementIndexes();
    if (shuttingDown) {
      await disconnectDB();
      return;
    }

    server = createServer(createApp(config));
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(config.port, () => {
        server.removeListener('error', reject);
        resolve();
      });
    });
    server.on('error', () => {
      console.error('HTTP server error');
      void shutdown('HTTP server error', 1);
    });
    stopRecurringJob = startRecurringJob();
    console.info(`TallyNest API listening on port ${config.port}`);
  } catch (error) {
    // Never log raw driver errors: they may contain connection credentials.
    console.error(
      error.message.startsWith('Invalid environment configuration:')
        ? error.message
        : 'Startup failed: unable to connect to MongoDB, initialize indexes, or start HTTP server',
    );
    await shutdown('startup failure', 1);
  }
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

await start();
