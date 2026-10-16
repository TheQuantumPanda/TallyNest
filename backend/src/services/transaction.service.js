import { createWithIntent } from '../utils/creation-intent.js';
import { transactionRepository } from '../repositories/transaction.repository.js';
import {
  transactionInputSchema,
  transactionPatchSchema,
  ownerIdSchema,
} from '../validators/transaction.validator.js';
import {
  transactionQuerySchema,
  ifMatchSchema,
} from '../validators/transaction-query.validator.js';
import { createTransactionCursor } from '../utils/transaction-cursor.js';
import { HttpError } from '../utils/httpError.js';

function parse(schema, value) {
  const result = schema.safeParse(value);
  if (!result.success) throw new HttpError(400, 'Invalid transaction data', 'INVALID_TRANSACTION');
  return result.data;
}

function transactionId(value) {
  if (!ownerIdSchema.safeParse(value).success) {
    throw new HttpError(400, 'Invalid transaction ID', 'INVALID_TRANSACTION_ID');
  }
  return value;
}

function notFound() {
  return new HttpError(404, 'Transaction not found', 'TRANSACTION_NOT_FOUND');
}

function editableValues(document) {
  return {
    type: document.type,
    title: document.title,
    amountMinor: document.amountMinor,
    currency: document.currency,
    category: document.category,
    transactionDate: document.transactionDate.toISOString(),
    ...(document.notes !== undefined ? { notes: document.notes } : {}),
  };
}

export function toPublicTransaction(document) {
  return {
    id: String(document._id),
    version: document.__v,
    ...editableValues(document),
    ...(document.recurringSchedule
      ? {
          recurrence: {
            scheduleId: String(document.recurringSchedule),
            scheduledDate: document.scheduledDate.toISOString(),
          },
        }
      : {}),
    createdAt: document.createdAt.toISOString(),
    updatedAt: document.updatedAt.toISOString(),
  };
}

export function createTransactionService({
  repository = transactionRepository,
  cursorSecret,
} = {}) {
  const cursors = createTransactionCursor(cursorSecret);
  return {
    async create(ownerId, input, idempotencyKey) {
      const data = parse(transactionInputSchema, input);
      const result = await createWithIntent(repository, ownerId, data, idempotencyKey);
      return { transaction: toPublicTransaction(result.document), replayed: result.replayed };
    },
    async list(ownerId, query) {
      const result = transactionQuerySchema.safeParse(query);
      if (!result.success) throw new HttpError(400, 'Invalid transaction query', 'INVALID_QUERY');
      const { cursor, ...options } = result.data;
      const after = cursor ? cursors.decode(cursor, ownerId, options) : undefined;
      const records = await repository.findPageForOwner(ownerId, {
        ...options,
        ...(after ? { after } : {}),
      });
      const hasMore = records.length > options.limit;
      const page = records.slice(0, options.limit);
      return {
        transactions: page.map(toPublicTransaction),
        pagination: {
          limit: options.limit,
          hasMore,
          nextCursor: hasMore ? cursors.encode(ownerId, options, page.at(-1)) : null,
        },
      };
    },
    async get(ownerId, id) {
      const document = await repository.findByIdForOwner(ownerId, transactionId(id));
      if (!document) throw notFound();
      return toPublicTransaction(document);
    },
    async update(ownerId, id, input, ifMatch) {
      transactionId(id);
      const patch = parse(transactionPatchSchema, input);
      const existing = await repository.findByIdForOwner(ownerId, id);
      if (!existing) throw notFound();
      if (ifMatch === undefined)
        throw new HttpError(428, 'If-Match is required', 'PRECONDITION_REQUIRED');
      const expected = ifMatchSchema.safeParse(ifMatch);
      if (!expected.success || expected.data.id !== id.toLowerCase()) {
        throw new HttpError(400, 'Invalid If-Match transaction version', 'INVALID_VERSION');
      }
      if (expected.data.version !== existing.__v) {
        throw new HttpError(
          412,
          'Transaction version is stale; reload before updating',
          'VERSION_MISMATCH',
        );
      }
      const merged = { ...editableValues(existing), ...patch };
      if (patch.notes === null) delete merged.notes;
      const data = parse(transactionInputSchema, merged);
      const updated = await repository.replaceForOwner(ownerId, id, existing.__v, data);
      if (!updated) {
        if (!(await repository.findByIdForOwner(ownerId, id))) throw notFound();
        throw new HttpError(409, 'Transaction changed; reload and retry', 'TRANSACTION_CONFLICT');
      }
      return toPublicTransaction(updated);
    },
    async remove(ownerId, id) {
      const document = await repository.deleteForOwner(ownerId, transactionId(id));
      if (!document) throw notFound();
    },
  };
}
