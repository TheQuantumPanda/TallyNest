// Compatibility export for the disposable staged integration composition.
// Production constructs the same router from src/routes/cycle.routes.js only after readiness.
export { createCycleRoutes as createStagedCycleRoutes } from '../routes/cycle.routes.js';
