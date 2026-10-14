import { GroupExpense, persistedSplit } from '../../src/models/group-expense.model.js';
import { allocateSplit } from '../../src/utils/split.js';
export function isolatedGroupExpenses() {
  const records = new Map(), copy = row => row ? GroupExpense.hydrate(row.toObject()) : null;
  const scoped = (group, id) => { const row = records.get(id); return row && String(row.group) === group && !row.deletedAt ? row : null; };
  function prepare(group, creator, data, key, hash, extra = {}) {
    const allocation = allocateSplit(data.amountMinor, data.split);
    return new GroupExpense({ ...data, group, creator, creationKey: key, creationHash: hash,
      split: persistedSplit(allocation.split), shares: allocation.shares, __v: 0,
      createdAt: new Date(), updatedAt: new Date(), ...extra });
  }
  return { records,
    async create(group, creator, data, key, hash, operationId, targetId) {
      const row = prepare(group, creator, data, key, hash, { _id: targetId, lastFinancialOperation: operationId }); await row.validate();
      if ([...records.values()].some(row => String(row.group) === group && String(row.creator) === creator && row.creationKey === key)) throw Object.assign(new Error('Duplicate'), { code: 11000 });
      records.set(String(row._id), row); return copy(row);
    },
    async findAny(group, target) { const row = records.get(target); return row && String(row.group) === group ? copy(row) : null; },
    async findReceipt(group, creator, key) { return copy([...records.values()].find(row => String(row.group) === group && String(row.creator) === creator && row.creationKey === key)); },
    async find(group, id) { return copy(scoped(group, id)); },
    async page(group, { limit, after }) { return [...records.values()].filter(row => String(row.group) === group && !row.deletedAt && (!after || row.expenseDate.toISOString() < after.expenseDate || (row.expenseDate.toISOString() === after.expenseDate && String(row._id) < after.id))).sort((a, b) => b.expenseDate - a.expenseDate || String(b._id).localeCompare(String(a._id))).slice(0, limit + 1).map(copy); },
    async replace(group, id, actor, owner, expected, data, creator, operationId) {
      const old = scoped(group, id); if (!old || old.__v !== expected || (!owner && String(old.creator) !== actor)) return null;
      const row = prepare(group, creator, data, old.creationKey, old.creationHash, { _id: id, __v: expected + 1, createdAt: old.createdAt, lastFinancialOperation: operationId }); await row.validate();
      if (records.get(id).__v !== expected) return null; records.set(id, row); return copy(row);
    },
    async remove(group, id, actor, owner, expected, operationId) { const row = scoped(group, id); if (!row || row.__v !== expected || (!owner && String(row.creator) !== actor)) return null; row.lastFinancialOperation = operationId; row.deletedAt = new Date(); row.__v++; return copy(row); },
  };
}
