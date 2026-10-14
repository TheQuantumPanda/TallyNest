import { createInvitationService } from './src/services/invitation.service.js';
import { createMembershipService } from './src/services/membership.service.js';
import { createInvitationRoutes } from './src/routes/invitation.routes.js';
import { createGroupService } from './src/services/group.service.js';
import { createGroupRoutes } from './src/routes/group.routes.js';
import { createRecurringService } from './src/services/recurring.service.js';
import { createRecurringEngine } from './src/services/recurring-engine.service.js';
import { createRecurringRoutes } from './src/routes/recurring.routes.js';
import { createBudgetSummaryService } from './src/services/budget-summary.service.js';
import { createBudgetService } from './src/services/budget.service.js';
import { createBudgetRoutes } from './src/routes/budget.routes.js';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { createDashboardService } from './src/services/dashboard.service.js';
import { createDashboardRoutes } from './src/routes/dashboard.routes.js';
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
} = {}, { repository, transactionRepository, dashboardRepository, dashboardNow, budgetRepository, budgetSummaryRepository, recurringRepository, recurringTransactions, recurringNow, groupRepository, invitationRepository, membershipRepository, invitationNow } = {}) {
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
  app.use('/api/dashboard', createDashboardRoutes(createDashboardService({ repository: dashboardRepository, now: dashboardNow }), authService, nodeEnv === 'production' ? '__Host-sfm_access' : 'sfm_access'));
  app.use('/api/budgets', createBudgetRoutes(createBudgetService({ repository: budgetRepository }), authService, {
    clientOrigin, cookieName: nodeEnv === 'production' ? '__Host-sfm_access' : 'sfm_access',
  }, createBudgetSummaryService({ repository: budgetSummaryRepository, recurringRepository, recurringTransactions, recurringNow })));
  app.use('/api/recurring', createRecurringRoutes(createRecurringService({ repository: recurringRepository }),
    createRecurringEngine({ repository: recurringRepository, transactions: recurringTransactions, now: recurringNow }), authService, {
      clientOrigin, cookieName: nodeEnv === 'production' ? '__Host-sfm_access' : 'sfm_access',
    }));
  const invitationService = createInvitationService({ repository: invitationRepository, groups: groupRepository, now: invitationNow });
  const membershipService = createMembershipService({ repository: membershipRepository, groups: groupRepository });
  app.use('/api/invitations', createInvitationRoutes(invitationService, authService, { clientOrigin, cookieName: nodeEnv === 'production' ? '__Host-sfm_access' : 'sfm_access' }));
  app.use('/api/groups', createGroupRoutes(createGroupService({ repository: groupRepository }), authService, {
    clientOrigin, cookieName: nodeEnv === 'production' ? '__Host-sfm_access' : 'sfm_access',
  }, invitationService, membershipService));
  app.use(notFound);
  app.use(errorHandler);
  return app;
}

export default createApp();
