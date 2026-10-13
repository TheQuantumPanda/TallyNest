import { z } from 'zod';
import { DASHBOARD_PERIODS } from '../../../shared/dashboard.js';
export const dashboardQuerySchema = z.object({
  period: z.enum(DASHBOARD_PERIODS.map(period => period.id)).default('this_month'),
  currency: z.literal('INR').default('INR'),
}).strict();
