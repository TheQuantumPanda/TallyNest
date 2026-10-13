import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { requireAuth } from '../middleware/auth.middleware.js';
import { createDashboardController } from '../controllers/dashboard.controller.js';
export function createDashboardRoutes(service, authService, cookieName) {
  const router = Router();
  router.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  router.use(requireAuth(authService, cookieName));
  router.use(rateLimit({ windowMs: 15 * 60 * 1000, limit: 120, keyGenerator: req => req.user.id,
    standardHeaders: 'draft-8', legacyHeaders: false,
    message: { status: 'error', code: 'RATE_LIMITED', message: 'Too many requests; try again later' } }));
  router.get('/summary', createDashboardController(service).summary);
  return router;
}
