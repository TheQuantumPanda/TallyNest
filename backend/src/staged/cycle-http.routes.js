// Not imported by app.js/server.js. Only the disposable integration server constructs this router.
import { empty, parse } from './contract.js';
import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { requireAuth } from '../middleware/auth.middleware.js';
import { protectCsrf } from '../middleware/csrf.middleware.js';
import { requireTransactionJson } from '../validators/transaction.validator.js';
import { createCycleHttpController } from './cycle-http.controller.js';
export function createStagedCycleRoutes(service, auth, { clientOrigin, readiness }) {
  const router = Router(),
    controller = createCycleHttpController(service),
    csrf = protectCsrf(clientOrigin);
  router.use((_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });
  router.use(requireAuth(auth, 'sfm_access'));
  router.use(
    rateLimit({
      windowMs: 900000,
      limit: 300,
      keyGenerator: (req) => req.user.id,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      message: {
        status: 'error',
        code: 'RATE_LIMITED',
        message: 'Too many requests; try again later',
      },
    }),
  );
  router.use(async (_req, _res, next) => {
    await readiness();
    next();
  });
  router.use((req, _res, next) => {
    if (req.method !== 'GET' && req.method !== 'OPTIONS') parse(empty, req.query, 'INVALID_QUERY');
    next();
  });
  router.get('/:groupId/cycles', controller.list('cycles'));
  router.get('/:groupId/cycles/:target', controller.get('cycles'));
  router.post('/:groupId/cycles', csrf, requireTransactionJson, controller.transition('open'));
  router.post(
    '/:groupId/cycles/:target/freeze',
    csrf,
    requireTransactionJson,
    controller.transition('freeze'),
  );
  router.post(
    '/:groupId/cycles/:target/close',
    csrf,
    requireTransactionJson,
    controller.transition('close'),
  );
  for (const kind of ['expenses', 'settlements']) {
    router.get(`/:groupId/${kind}`, controller.list(kind));
    router.get(`/:groupId/${kind}/:target`, controller.get(kind));
    router.post(`/:groupId/${kind}`, csrf, requireTransactionJson, controller.create(kind));
  }
  router.patch(
    '/:groupId/expenses/:target',
    csrf,
    requireTransactionJson,
    controller.mutate('expenses', 'update'),
  );
  router.delete('/:groupId/expenses/:target', csrf, controller.mutate('expenses', 'delete'));
  router.post(
    '/:groupId/settlements/:target/confirm',
    csrf,
    requireTransactionJson,
    controller.mutate('settlements', 'confirm'),
  );
  router.post(
    '/:groupId/settlements/:target/reject',
    csrf,
    requireTransactionJson,
    controller.mutate('settlements', 'reject'),
  );
  router.get('/:groupId/balances', controller.balances);
  router.post('/:groupId/financial-recovery', csrf, requireTransactionJson, controller.recover);
  return router;
}
