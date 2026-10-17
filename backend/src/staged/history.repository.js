import mongoose from 'mongoose';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { id, parse } from './contract.js';
import { transactionDateSchema } from '../validators/transaction.validator.js';
import { HttpError } from '../utils/httpError.js';
const position = z
  .object({
    id,
    date: transactionDateSchema.optional(),
    sequence: z.number().int().positive().safe().optional(),
  })
  .strict();
export function createCycleHistoryRepository({ cycles, expenses, settlements, secret }) {
  const models = { cycles, expenses, settlements };
  function seal(payload) {
    const data = Buffer.from(JSON.stringify(payload)).toString('base64url');
    return data + '.' + createHmac('sha256', secret).update(data).digest('base64url');
  }
  function unseal(token, scope) {
    try {
      const parts = token.split('.');
      if (
        parts.length !== 2 ||
        parts.some(
          (part) =>
            !/^[A-Za-z0-9_-]+$/.test(part) ||
            Buffer.from(part, 'base64url').toString('base64url') !== part,
        )
      )
        throw Error();
      const signature = createHmac('sha256', secret).update(parts[0]).digest();
      const received = Buffer.from(parts[1], 'base64url');
      if (received.length !== signature.length || !timingSafeEqual(signature, received))
        throw Error();
      const payload = JSON.parse(Buffer.from(parts[0], 'base64url'));
      if (JSON.stringify(payload.scope) !== JSON.stringify(scope)) throw Error();
      return parse(position, payload.position);
    } catch {
      throw new HttpError(400, 'Invalid history cursor', 'INVALID_CURSOR');
    }
  }
  return {
    async page(kind, user, group, query) {
      const scope = { v: 2, kind, user, group, cycle: query.cycleId ?? null, limit: query.limit };
      const after = query.after ? unseal(query.after, scope) : null;
      const objectId = (value) => new mongoose.Types.ObjectId(value);
      const filter = {
        group: objectId(group),
        ...(query.cycleId ? { cycleId: objectId(query.cycleId) } : {}),
        ...(kind === 'expenses' ? { deletedAt: { $exists: false } } : {}),
      };
      const field = kind === 'expenses' ? 'expenseDate' : kind === 'cycles' ? 'sequence' : '_id';
      if (after) {
        const value =
          field === 'expenseDate'
            ? new Date(after.date)
            : field === 'sequence'
              ? after.sequence
              : objectId(after.id);
        if (value === undefined || (field === 'expenseDate' && !after.date))
          throw new HttpError(400, 'Invalid cursor position', 'INVALID_CURSOR');
        Object.assign(
          filter,
          field === '_id'
            ? { _id: { $lt: value } }
            : {
                $or: [
                  { [field]: { $lt: value } },
                  { [field]: value, _id: { $lt: objectId(after.id) } },
                ],
              },
        );
      }
      const rows = await models[kind]
        .find(filter)
        .sort(field === '_id' ? { _id: -1 } : { [field]: -1, _id: -1 })
        .limit(query.limit + 1)
        .maxTimeMS(2000)
        .exec();
      const page = rows.slice(0, query.limit),
        last = page.at(-1),
        hasMore = rows.length > query.limit;
      return {
        rows: page,
        pagination: {
          limit: query.limit,
          hasMore,
          nextAfter: hasMore
            ? seal({
                scope,
                position: {
                  id: String(last._id),
                  ...(kind === 'expenses' ? { date: last.expenseDate.toISOString() } : {}),
                  ...(kind === 'cycles' ? { sequence: last.sequence } : {}),
                },
              })
            : null,
        },
      };
    },
  };
}
