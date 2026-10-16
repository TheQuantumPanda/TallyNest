import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { createTransactionController } from '../controllers/transaction.controller.js';
import { requireAuth } from '../middleware/auth.middleware.js';
import { protectCsrf } from '../middleware/csrf.middleware.js';
import { requireTransactionJson } from '../validators/transaction.validator.js';

export function createTransactionRoutes(service, authService, { cookieName, clientOrigin }) {
  const router = Router();
  const controller = createTransactionController(service);
  const csrf = protectCsrf(clientOrigin);
  router.use((_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });
  router.use(requireAuth(authService, cookieName));
  router.use(
    rateLimit({
      windowMs: 15 * 60 * 1000,
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
  router.post('/', csrf, requireTransactionJson, controller.create);
  router.get('/', controller.list);
  router.get('/:id', controller.get);
  router.patch('/:id', csrf, requireTransactionJson, controller.update);
  router.delete('/:id', csrf, controller.remove);
  return router;
}
