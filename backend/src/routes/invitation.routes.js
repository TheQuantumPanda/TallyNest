import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { requireAuth } from '../middleware/auth.middleware.js';
import { protectCsrf } from '../middleware/csrf.middleware.js';
import { requireTransactionJson as requireJson } from '../validators/transaction.validator.js';
import { createInvitationController } from '../controllers/invitation.controller.js';
export function createInvitationRoutes(service, authService, { cookieName, clientOrigin }) {
  const router = Router(), controller = createInvitationController(service);
  const limiter = (limit, byUser = false) => rateLimit({ windowMs: 15 * 60 * 1000, limit,
    ...(byUser ? { keyGenerator: req => req.user.id } : {}), standardHeaders: 'draft-8', legacyHeaders: false,
    message: { status: 'error', code: 'RATE_LIMITED', message: 'Too many invitation requests; try again later' } });
  router.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); res.set('Referrer-Policy', 'no-referrer'); next(); });
  router.use(limiter(60), requireAuth(authService, cookieName));
  router.get('/:token', limiter(30, true), controller.inspect);
  router.post('/:token/accept', protectCsrf(clientOrigin), requireJson, limiter(15, true), controller.accept);
  return router;
}
