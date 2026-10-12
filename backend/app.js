import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import healthRoutes from './src/routes/health.routes.js';
import { notFound } from './src/middleware/notFound.js';
import { errorHandler } from './src/middleware/errorHandler.js';

// The server passes validated configuration. Tests can supply configuration
// directly without loading a .env file or opening a database connection.
export function createApp({
  nodeEnv = process.env.NODE_ENV ?? 'development',
  clientOrigin = process.env.CLIENT_ORIGIN ?? 'http://localhost:5173',
} = {}) {
  const app = express();
  app.set('env', nodeEnv);
  app.disable('x-powered-by');
  app.use(helmet());
  app.use(cors({ origin: clientOrigin }));
  app.use(express.json({ limit: '100kb' }));
  app.use('/api/health', healthRoutes);
  app.use(notFound);
  app.use(errorHandler);
  return app;
}

export default createApp();
