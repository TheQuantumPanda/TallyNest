import mongoose from 'mongoose';
import { GroupExpense, groupExpenseCollectionValidator } from '../models/group-expense.model.js';
import {
  GroupSettlement,
  settlementCollectionValidator,
} from '../models/group-settlement.model.js';
import { exactMoneyStage } from '../utils/financial-aggregation.js';
import { ownerIdSchema } from '../validators/transaction.validator.js';
const objectId = (value) => new mongoose.Types.ObjectId(ownerIdSchema.parse(String(value)));
export function createGroupBalanceRepository(
  expenses = GroupExpense,
  settlements = GroupSettlement,
) {
  return {
    async hasHistory(group) {
      const match = { group: objectId(group) };
      const results = await Promise.all([
        expenses.exists(match).readConcern('majority').maxTimeMS(1000).exec(),
        settlements.exists(match).readConcern('majority').maxTimeMS(1000).exec(),
      ]);
      return results.some(Boolean);
    },
    async aggregate(group, memberIds, cycleId) {
      const members = memberIds.map(objectId),
        match = { group: objectId(group), ...(cycleId ? { cycleId: objectId(cycleId) } : {}) };
      const [expense, settlement] = await Promise.all([
        expenses
          .aggregate([
            { $match: match },
            {
              $facet: {
                invalid: [
                  {
                    $match: {
                      $or: [
                        { $nor: [groupExpenseCollectionValidator] },
                        {
                          $expr: {
                            $not: [
                              {
                                $and: [
                                  { $in: ['$creator', members] },
                                  { $in: ['$payer', members] },
                                  { $setIsSubset: ['$shares.user', members] },
                                ],
                              },
                            ],
                          },
                        },
                      ],
                    },
                  },
                  { $count: 'count' },
                ],
                paid: [
                  { $match: { deletedAt: { $exists: false } } },
                  exactMoneyStage(),
                  { $group: { _id: '$payer', amount: { $sum: '$money' } } },
                ],
                assigned: [
                  { $match: { deletedAt: { $exists: false } } },
                  { $unwind: '$shares' },
                  { $set: { amountMinor: '$shares.amountMinor' } },
                  exactMoneyStage(),
                  {
                    $group: { _id: '$shares.user', amount: { $sum: '$money' } },
                  },
                ],
              },
            },
          ])
          .option({ maxTimeMS: 5000, readConcern: { level: 'majority' } })
          .exec(),
        settlements
          .aggregate([
            { $match: match },
            {
              $facet: {
                invalid: [
                  {
                    $match: {
                      $or: [
                        { $nor: [settlementCollectionValidator] },
                        {
                          $expr: {
                            $not: [
                              {
                                $and: [
                                  { $in: ['$sender', members] },
                                  { $in: ['$recipient', members] },
                                ],
                              },
                            ],
                          },
                        },
                      ],
                    },
                  },
                  { $count: 'count' },
                ],
                sent: [
                  { $match: { status: 'confirmed' } },
                  exactMoneyStage(),
                  { $group: { _id: '$sender', amount: { $sum: '$money' } } },
                ],
                received: [
                  { $match: { status: 'confirmed' } },
                  exactMoneyStage(),
                  { $group: { _id: '$recipient', amount: { $sum: '$money' } } },
                ],
                reservedSent: [
                  { $match: { status: 'pending' } },
                  exactMoneyStage(),
                  { $group: { _id: '$sender', amount: { $sum: '$money' } } },
                ],
                reservedReceived: [
                  { $match: { status: 'pending' } },
                  exactMoneyStage(),
                  { $group: { _id: '$recipient', amount: { $sum: '$money' } } },
                ],
              },
            },
          ])
          .option({ maxTimeMS: 5000, readConcern: { level: 'majority' } })
          .exec(),
      ]);
      return { expenses: expense[0], settlements: settlement[0] };
    },
  };
}
export const groupBalanceRepository = createGroupBalanceRepository();
