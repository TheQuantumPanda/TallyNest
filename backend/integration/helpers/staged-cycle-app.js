// Test-only composition root; there is no activation option in the production createApp.
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { createApp } from '../../app.js';
import { createAuthService } from '../../src/services/auth.service.js';
import { createCycleFinancialService } from '../../src/services/cycle-financial.service.js';
import { createCycleLifecycleService } from '../../src/services/cycle-lifecycle.service.js';
import { createCycleHttpService } from '../../src/staged/cycle-http.service.js';
import { createStagedCycleRoutes } from '../../src/staged/cycle-http.routes.js';
import { createCycleHistoryRepository } from '../../src/staged/history.repository.js';
import {
  assertCycleHttpReadiness,
  assertCycleGroupConsistency,
} from '../../src/staged/readiness.js';
import { errorHandler } from '../../src/middleware/errorHandler.js';
export async function createDisposableCycleApp({
  connection,
  config,
  repositories,
  models,
  fault,
}) {
  if (
    !/^tallynest_cycle_http_test_\d{13}_[a-f0-9]{12}$/.test(connection.name) ||
    config.nodeEnv !== 'test'
  )
    throw new Error('Staged HTTP construction requires an explicit disposable test database');
  if (repositories.groups.offlineMigrationRunId)
    throw new Error('Maintenance overrides are forbidden');
  await assertCycleHttpReadiness(connection.db);
  await assertCycleGroupConsistency(connection.db);
  const auth = createAuthService({ repository: repositories.users, ...config });
  const financial = createCycleFinancialService({ internalEnabled: true, ...repositories, fault });
  const lifecycle = createCycleLifecycleService({
    internalEnabled: true,
    ...repositories,
    financial,
    fault,
  });
  const service = createCycleHttpService({
    ...repositories,
    financial,
    lifecycle,
    history: createCycleHistoryRepository({ ...models, secret: config.jwtSecret }),
  });
  const app = express();
  app.set('env', 'test');
  app.disable('x-powered-by');
  app.use(helmet());
  app.use((_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });
  app.use(
    cors({
      origin: config.clientOrigin,
      credentials: true,
      methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: [
        'Content-Type',
        'X-CSRF-Protection',
        'If-Match',
        'If-Group-Match',
        'If-Cycle-Match',
        'Idempotency-Key',
      ],
      exposedHeaders: ['ETag', 'X-Group-ETag'],
    }),
  );
  app.use(express.json({ limit: '100kb' }), cookieParser());
  app.use(
    '/api/groups',
    createStagedCycleRoutes(service, auth, {
      clientOrigin: config.clientOrigin,
      readiness: () => assertCycleHttpReadiness(connection.db, { allowRecovery: true }),
    }),
  );
  // Existing auth, invitations, roster and legacy routes remain the actual application.
  app.use(
    createApp(config, { repository: repositories.users, groupRepository: repositories.groups }),
  );
  app.use(errorHandler);
  return app;
}
