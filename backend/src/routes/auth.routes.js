import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { createAuthController } from '../controllers/auth.controller.js';
import { requireAuth } from '../middleware/auth.middleware.js';
import { protectCsrf } from '../middleware/csrf.middleware.js';
import { loginSchema, registerSchema, validateAuth } from '../validators/auth.validator.js';

function authLimiter(limit) {
  return rateLimit({
    windowMs: 15 * 60 * 1000,
    limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { status: 'error', message: 'Too many authentication attempts; try again later' },
  });
}

export function createAuthRoutes(authService, config) {
  const router = Router();
  const controller = createAuthController(authService, config);
  const csrf = protectCsrf(config.clientOrigin);
  router.use((_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });
  router.post('/register', csrf, authLimiter(5), validateAuth(registerSchema), controller.register);
  router.post('/login', csrf, authLimiter(10), validateAuth(loginSchema), controller.login);
  router.post('/logout', csrf, controller.logout);
  router.get('/me', requireAuth(authService, config.cookieName), controller.me);
  return router;
}
