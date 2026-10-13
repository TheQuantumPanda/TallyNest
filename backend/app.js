import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { createTransactionService } from './src/services/transaction.service.js';
import { createTransactionRoutes } from './src/routes/transaction.routes.js';
import { createAuthService } from './src/services/auth.service.js';
import { createAuthRoutes } from './src/routes/auth.routes.js';
import healthRoutes from './src/routes/health.routes.js';
import { notFound } from './src/middleware/notFound.js';
import { errorHandler } from './src/middleware/errorHandler.js';

// The server passes validated configuration. Tests can supply configuration
// directly without loading a .env file or opening a database connection.
export function createApp({
  nodeEnv = process.env.NODE_ENV ?? 'development',
  clientOrigin = process.env.CLIENT_ORIGIN ?? 'http://localhost:5173',
  jwtSecret = process.env.JWT_SECRET,
  jwtTtlSeconds = 900,
} = {}, { repository, transactionRepository } = {}) {
  const app = express();
  app.set('env', nodeEnv);
  app.disable('x-powered-by');
  app.use(helmet());
  app.use(cors({
    origin: clientOrigin, credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'X-CSRF-Protection', 'If-Match'],
    exposedHeaders: ['ETag'],
  }));
  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());
  app.use('/api/health', healthRoutes);
  const authService = createAuthService({ repository, jwtSecret, jwtTtlSeconds });
  app.use('/api/auth', createAuthRoutes(authService, {
    clientOrigin, jwtTtlSeconds,
    cookieName: nodeEnv === 'production' ? '__Host-sfm_access' : 'sfm_access',
    cookieOptions: { httpOnly: true, secure: nodeEnv === 'production', sameSite: 'lax', path: '/' },
  }));
  app.use('/api/transactions', createTransactionRoutes(
    createTransactionService({ repository: transactionRepository, cursorSecret: jwtSecret }), authService, {
      clientOrigin, cookieName: nodeEnv === 'production' ? '__Host-sfm_access' : 'sfm_access',
    },
  ));
  app.use(notFound);
  app.use(errorHandler);
  return app;
}

export default createApp();
