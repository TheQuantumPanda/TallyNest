import mongoose from 'mongoose';
import { Transaction } from '../models/transaction.model.js';
import { ownerIdSchema } from '../validators/transaction.validator.js';
import { exactMoneyStage, validMoneyExpressions, validCategoryExpression } from '../utils/financial-aggregation.js';

export function createDashboardRepository(model = Transaction) {
  return {
    async summarize(owner, { from, to, grouping }) {
      const ownerId = new mongoose.Types.ObjectId(ownerIdSchema.parse(owner));
      const categoryRules = ['income', 'expense'].map(validCategoryExpression);
      const bucket = { $dateTrunc: { date: '$transactionDate', unit: grouping, timezone: 'UTC', ...(grouping === 'week' ? { startOfWeek: 'monday' } : {}) } };
      // Exact Int64 conversion before Decimal128 avoids double->decimal precision loss.
      const pipeline = [
        { $match: { owner: ownerId, transactionDate: { $gte: from, $lt: to } } },
        exactMoneyStage(),
        { $facet: {
          integrity: [{ $group: { _id: null, invalid: { $sum: { $cond: [{ $and: [
            ...validMoneyExpressions(),
            { $eq: ['$currency', 'INR'] }, { $or: categoryRules },
          ] }, 0, 1] } } } }],
          totals: [{ $group: { _id: { currency: '$currency', type: '$type' }, amount: { $sum: '$money' }, count: { $sum: 1 } } }],
          categories: [{ $match: { type: 'expense' } }, { $group: { _id: { currency: '$currency', category: '$category' }, amount: { $sum: '$money' } } }],
          series: [{ $group: { _id: { currency: '$currency', type: '$type', bucket }, amount: { $sum: '$money' }, count: { $sum: 1 } } }],
          recent: [{ $sort: { transactionDate: -1, _id: -1 } }, { $limit: 5 }, { $project: { money: 0 } }],
        } },
      ];
      const [result] = await model.aggregate(pipeline).option({ maxTimeMS: 5000 }).exec();
      return result;
    },
  };
}
export const dashboardRepository = createDashboardRepository();
