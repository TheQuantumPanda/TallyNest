import mongoose from 'mongoose';
import { recurringRepository } from '../repositories/recurring.repository.js';
import { transactionRepository } from '../repositories/transaction.repository.js';
import { recurringInputSchema, processInputSchema } from '../validators/recurring.validator.js';
import { ownerIdSchema, transactionInputSchema } from '../validators/transaction.validator.js';
import { cursorAfter, scheduleValues } from '../utils/recurrence.js';

export function createRecurringEngine({
  repository = recurringRepository,
  transactions = transactionRepository,
  now = () => new Date(),
  clock = Date.now,
} = {}) {
  return {
    async processDueSchedules({ owner, limit = 20 } = {}) {
      processInputSchema.parse({ limit });
      if (owner !== undefined) ownerIdSchema.parse(owner);
      const asOf = now();
      if (!(asOf instanceof Date) || !Number.isFinite(asOf.getTime()))
        throw new RangeError('Invalid clock');
      const deadline = clock() + 5000,
        failed = [];
      const result = {
        attempted: 0,
        generated: 0,
        recovered: 0,
        advanced: 0,
        conflicts: 0,
        errors: 0,
        hasMoreDue: false,
      };
      while (result.attempted < limit && clock() < deadline) {
        const document = await repository.findDue({ owner, asOf, exclude: failed });
        if (!document) break;
        result.attempted++;
        try {
          await document.validate();
          if (
            !Number.isSafeInteger(document.__v) ||
            document.__v < 0 ||
            document.__v >= Number.MAX_SAFE_INTEGER - 2
          )
            throw new RangeError('Version exhausted');
          const template = recurringInputSchema.parse(scheduleValues(document));
          const claimed = document.pending
            ? document
            : await repository.reserve(document, new mongoose.Types.ObjectId());
          if (!claimed) {
            result.conflicts++;
            continue;
          }
          const input = transactionInputSchema.parse({
            type: template.type,
            title: template.title,
            amountMinor: template.amountMinor,
            currency: template.currency,
            category: template.category,
            transactionDate: claimed.pending.date.toISOString(),
            ...(template.notes !== undefined ? { notes: template.notes } : {}),
          });
          const receipt = await transactions.createGeneratedForOwner(
            String(claimed.owner),
            String(claimed.pending.transactionId),
            String(claimed._id),
            claimed.pending.date,
            input,
          );
          if (receipt.created) result.generated++;
          else result.recovered++;
          const updated = await repository.advance(
            claimed,
            cursorAfter(template, claimed.pending.date),
          );
          if (updated) result.advanced++;
          else result.conflicts++;
        } catch {
          // Do not expose/log raw driver failures, owner IDs, payloads, or secrets.
          result.errors++;
          failed.push(String(document._id));
        }
      }
      result.hasMoreDue = !!(await repository.findDue({ owner, asOf }));
      return result;
    },
  };
}
export const recurringEngine = createRecurringEngine();
export const processDueSchedules = (options) => recurringEngine.processDueSchedules(options);
