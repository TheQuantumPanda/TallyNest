import { GroupFinancialCycle } from '../models/group-financial-cycle.model.js';
import { GroupExpense } from '../models/group-expense.model.js';
import { GroupSettlement } from '../models/group-settlement.model.js';
import { groupRepository } from '../repositories/group.repository.js';
import { groupFinancialCycleRepository } from '../repositories/group-financial-cycle.repository.js';
import { groupExpenseRepository } from '../repositories/group-expense.repository.js';
import { settlementRepository } from '../repositories/settlement.repository.js';
import { groupBalanceRepository } from '../repositories/group-balance.repository.js';
import { membershipRepository } from '../repositories/membership.repository.js';
import { cycleTransitionRepository } from '../repositories/group-cycle-transition.repository.js';
import { createCycleFinancialService } from './cycle-financial.service.js';
import { createCycleLifecycleService } from './cycle-lifecycle.service.js';
import { createCycleHttpService } from '../staged/cycle-http.service.js';
import { createCycleHistoryRepository } from '../staged/history.repository.js';
import { createCycleRoutes } from '../routes/cycle.routes.js';
import { assertFreshCycleRequestReadiness } from '../config/fresh-cycle-setup.js';
import { createAuthService } from './auth.service.js';
import { userRepository } from '../repositories/user.repository.js';

// Constructed only by normal server startup after the read-only fresh-v2 gate passes.
// No request field, header, cookie or public environment flag can enable this composition.
export function createCycleHttpComposition(config, db) {
  const { clientOrigin, jwtSecret, jwtTtlSeconds = 900, nodeEnv = 'development' } = config;
  const auth = createAuthService({ repository: userRepository, jwtSecret, jwtTtlSeconds });
  const financial = createCycleFinancialService({
    internalEnabled: true,
    groups: groupRepository,
    expenses: groupExpenseRepository,
    settlements: settlementRepository,
    cycles: groupFinancialCycleRepository,
    receipts: cycleTransitionRepository,
    balances: groupBalanceRepository,
  });
  const lifecycle = createCycleLifecycleService({
    internalEnabled: true,
    groups: groupRepository,
    cycles: groupFinancialCycleRepository,
    expenses: groupExpenseRepository,
    settlements: settlementRepository,
    receipts: cycleTransitionRepository,
    profiles: membershipRepository,
    balances: groupBalanceRepository,
    financial,
  });
  const service = createCycleHttpService({
    groups: groupRepository,
    cycles: groupFinancialCycleRepository,
    expenses: groupExpenseRepository,
    settlements: settlementRepository,
    profiles: membershipRepository,
    financial,
    lifecycle,
    history: createCycleHistoryRepository({
      cycles: GroupFinancialCycle,
      expenses: GroupExpense,
      settlements: GroupSettlement,
      secret: jwtSecret,
    }),
  });
  return {
    service,
    routes: createCycleRoutes(service, auth, {
      clientOrigin,
      cookieName: nodeEnv === 'production' ? '__Host-sfm_access' : 'sfm_access',
      readiness: () => assertFreshCycleRequestReadiness(db),
    }),
  };
}
