import { budgetRepository } from '../repositories/budget.repository.js';
import {
  budgetInputSchema,
  budgetPatchSchema,
  budgetQuerySchema,
} from '../validators/budget.validator.js';
import { ownerIdSchema } from '../validators/transaction.validator.js';
import { ifMatchSchema } from '../validators/transaction-query.validator.js';
import { HttpError } from '../utils/httpError.js';

function parse(schema, input, code = 'INVALID_BUDGET') {
  const result = schema.safeParse(input);
  if (!result.success)
    throw new HttpError(
      400,
      code === 'INVALID_QUERY' ? 'Invalid budget query' : 'Invalid budget data',
      code,
    );
  return result.data;
}
function budgetId(id) {
  if (!ownerIdSchema.safeParse(id).success)
    throw new HttpError(400, 'Invalid budget ID', 'INVALID_BUDGET_ID');
  return id;
}
const notFound = () => new HttpError(404, 'Budget not found', 'BUDGET_NOT_FOUND');
function editable(document) {
  return {
    category: document.category,
    currency: document.currency,
    amountMinor: document.amountMinor,
    month: document.month,
  };
}
export function toPublicBudget(document) {
  return {
    id: String(document._id),
    version: document.__v,
    ...editable(document),
    createdAt: document.createdAt.toISOString(),
    updatedAt: document.updatedAt.toISOString(),
  };
}
async function write(operation) {
  try {
    return await operation();
  } catch (error) {
    if (error.code === 11000)
      throw new HttpError(
        409,
        'A budget already exists for this category, currency and month',
        'BUDGET_EXISTS',
      );
    throw error;
  }
}
export function createBudgetService({ repository = budgetRepository } = {}) {
  return {
    async create(owner, input) {
      const data = parse(budgetInputSchema, input);
      return toPublicBudget(await write(() => repository.createForOwner(owner, data)));
    },
    async list(owner, query) {
      return (
        await repository.findForOwner(owner, parse(budgetQuerySchema, query, 'INVALID_QUERY'))
      ).map(toPublicBudget);
    },
    async get(owner, id) {
      const document = await repository.findByIdForOwner(owner, budgetId(id));
      if (!document) throw notFound();
      return toPublicBudget(document);
    },
    async update(owner, id, input, ifMatch) {
      budgetId(id);
      const patch = parse(budgetPatchSchema, input);
      const existing = await repository.findByIdForOwner(owner, id);
      if (!existing) throw notFound();
      if (ifMatch === undefined)
        throw new HttpError(428, 'If-Match is required', 'PRECONDITION_REQUIRED');
      const expected = ifMatchSchema.safeParse(ifMatch);
      if (!expected.success || expected.data.id !== id.toLowerCase())
        throw new HttpError(400, 'Invalid If-Match budget version', 'INVALID_VERSION');
      if (expected.data.version !== existing.__v)
        throw new HttpError(
          412,
          'Budget version is stale; reload before updating',
          'VERSION_MISMATCH',
        );
      if (existing.__v >= Number.MAX_SAFE_INTEGER)
        throw new HttpError(409, 'Budget version exhausted', 'BUDGET_CONFLICT');
      const data = parse(budgetInputSchema, { ...editable(existing), ...patch });
      const updated = await write(() => repository.replaceForOwner(owner, id, existing.__v, data));
      if (!updated) {
        if (!(await repository.findByIdForOwner(owner, id))) throw notFound();
        throw new HttpError(409, 'Budget changed; reload and retry', 'BUDGET_CONFLICT');
      }
      return toPublicBudget(updated);
    },
    async remove(owner, id) {
      if (!(await repository.deleteForOwner(owner, budgetId(id)))) throw notFound();
    },
  };
}
