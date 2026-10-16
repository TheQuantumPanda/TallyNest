import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { createRecurringController } from '../controllers/recurring.controller.js';
import { requireAuth } from '../middleware/auth.middleware.js';
import { protectCsrf } from '../middleware/csrf.middleware.js';
import { requireTransactionJson as requireJson } from '../validators/transaction.validator.js';
export function createRecurringRoutes(service, engine, authService, { cookieName, clientOrigin }) {
  const router = Router(),
    controller = createRecurringController(service, engine),
    csrf = protectCsrf(clientOrigin);
  const limiter = (limit) =>
    rateLimit({
      windowMs: 15 * 60 * 1000,
      limit,
      keyGenerator: (req) => req.user.id,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      message: {
        status: 'error',
        code: 'RATE_LIMITED',
        message: 'Too many requests; try again later',
      },
    });
  router.use((_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });
  router.use(requireAuth(authService, cookieName), limiter(300));
  router.post('/process', csrf, requireJson, limiter(10), controller.process);
  router.post('/', csrf, requireJson, controller.create);
  router.get('/', controller.list);
  router.get('/:id', controller.get);
  router.patch('/:id', csrf, requireJson, controller.update);
  router.post('/:id/pause', csrf, requireJson, controller.pause);
  router.post('/:id/resume', csrf, requireJson, controller.resume);
  router.delete('/:id', csrf, controller.remove);
  return router;
}
