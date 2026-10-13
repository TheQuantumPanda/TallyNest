import { createBudgetSummaryController } from '../controllers/budget-summary.controller.js';
import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { createBudgetController } from '../controllers/budget.controller.js';
import { requireAuth } from '../middleware/auth.middleware.js';
import { protectCsrf } from '../middleware/csrf.middleware.js';
import { requireTransactionJson as requireJson } from '../validators/transaction.validator.js';

export function createBudgetRoutes(service, authService, { cookieName, clientOrigin }, summaryService) {
  const router = Router();
  const controller = createBudgetController(service);
  const csrf = protectCsrf(clientOrigin);
  router.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  router.use(requireAuth(authService, cookieName));
  router.use(rateLimit({ windowMs: 15 * 60 * 1000, limit: 300, keyGenerator: req => req.user.id,
    standardHeaders: 'draft-8', legacyHeaders: false,
    message: { status: 'error', code: 'RATE_LIMITED', message: 'Too many requests; try again later' } }));
  router.post('/', csrf, requireJson, controller.create);
  router.get('/', controller.list);
  router.get('/summary', createBudgetSummaryController(summaryService));
  router.get('/:id', controller.get);
  router.patch('/:id', csrf, requireJson, controller.update);
  router.delete('/:id', csrf, controller.remove);
  return router;
}
