import { transactionRepository } from '../repositories/transaction.repository.js';
import { transactionInputSchema, transactionPatchSchema, ownerIdSchema } from '../validators/transaction.validator.js';
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
    type: document.type, title: document.title, amountMinor: document.amountMinor,
    currency: document.currency, category: document.category,
    transactionDate: document.transactionDate.toISOString(),
    ...(document.notes !== undefined ? { notes: document.notes } : {}),
  };
}

export function toPublicTransaction(document) {
  return {
    id: String(document._id), ...editableValues(document),
    createdAt: document.createdAt.toISOString(), updatedAt: document.updatedAt.toISOString(),
  };
}

export function createTransactionService({ repository = transactionRepository } = {}) {
  return {
    async create(ownerId, input) {
      const data = parse(transactionInputSchema, input);
      return toPublicTransaction(await repository.createForOwner(ownerId, data));
    },
    async list(ownerId, query) {
      if (Object.keys(query).length) throw new HttpError(400, 'Query parameters are not supported yet', 'INVALID_QUERY');
      return (await repository.findForOwner(ownerId, { limit: 50 })).map(toPublicTransaction);
    },
    async get(ownerId, id) {
      const document = await repository.findByIdForOwner(ownerId, transactionId(id));
      if (!document) throw notFound();
      return toPublicTransaction(document);
    },
    async update(ownerId, id, input) {
      transactionId(id);
      const patch = parse(transactionPatchSchema, input);
      const existing = await repository.findByIdForOwner(ownerId, id);
      if (!existing) throw notFound();
      const merged = { ...editableValues(existing), ...patch };
      if (patch.notes === null) delete merged.notes;
      const data = parse(transactionInputSchema, merged);
      const updated = await repository.replaceForOwner(ownerId, id, existing.__v, data);
      if (!updated) {
        if (!await repository.findByIdForOwner(ownerId, id)) throw notFound();
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
