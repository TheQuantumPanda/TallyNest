import mongoose from 'mongoose';
import { Budget } from '../models/budget.model.js';
import { Transaction } from '../models/transaction.model.js';
import { ownerIdSchema } from '../validators/transaction.validator.js';
import { budgetSummaryQuerySchema } from '../validators/budget.validator.js';
import { TRANSACTION_CATEGORIES } from '../constants/transaction.constants.js';
import { exactMoneyStage, validMoneyExpressions, validCategoryExpression } from '../utils/financial-aggregation.js';

// Avoid Date.UTC's special treatment of years 00–99. Month validation is shared
// with CRUD. December 9999's exclusive end is a valid extended-year JS Date.
export function budgetMonthRange(month) {
  const input = budgetSummaryQuerySchema.parse({ month });
  const from = new Date(`${input.month}-01T00:00:00.000Z`);
  const to = new Date(from);
  to.setUTCMonth(to.getUTCMonth() + 1);
  return { from, to };
}
export function createBudgetSummaryRepository({ budgetModel = Budget, transactionModel = Transaction } = {}) {
  return {
    async summarize(owner, query) {
      const ownerId = new mongoose.Types.ObjectId(ownerIdSchema.parse(owner));
      const options = budgetSummaryQuerySchema.parse(query);
      const { from, to } = budgetMonthRange(options.month);
      const pipeline = [
        { $match: { owner: ownerId, deletedAt: { $exists: false }, type: 'expense', currency: options.currency,
          transactionDate: { $gte: from, $lt: to } } },
        exactMoneyStage(),
        { $facet: {
          integrity: [{ $group: { _id: null, invalid: { $sum: { $cond: [
            { $and: [...validMoneyExpressions(), validCategoryExpression('expense'),
              { $eq: [{ $type: '$owner' }, 'objectId'] }, { $eq: [{ $type: '$transactionDate' }, 'date'] }] }, 0, 1,
          ] } } } }],
          totals: [{ $group: { _id: null, amount: { $sum: '$money' }, count: { $sum: 1 } } }],
          categories: [{ $group: { _id: '$category', amount: { $sum: '$money' }, count: { $sum: 1 } } }],
        } },
      ];
      // Two bounded, owner-scoped reads, not a snapshot. Limit +1 detects corrupt
      // duplicate/unsupported budget rows rather than silently hiding them.
      const [budgets, [expenses]] = await Promise.all([
        budgetModel.find({ owner: ownerId, month: options.month, currency: options.currency })
          .select('owner category currency month amountMinor __v').sort({ category: 1 })
          .limit(TRANSACTION_CATEGORIES.filter(category => category.types.includes('expense')).length + 1)
          .maxTimeMS(1000).lean().exec(),
        transactionModel.aggregate(pipeline).option({ maxTimeMS: 5000 }).exec(),
      ]);
      return { budgets, expenses };
    },
  };
}
export const budgetSummaryRepository = createBudgetSummaryRepository();
