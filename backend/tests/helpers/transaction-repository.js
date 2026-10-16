import { Transaction } from '../../src/models/transaction.model.js';

export function isolatedTransactions() {
  const records = new Map();
  const snapshot = document => document ? Transaction.hydrate(document.toObject()) : null;
  return {
    records,
    async createForOwner(owner, data, receipt = {}) {
      const document = new Transaction({ ...data, ...receipt, owner });
      await document.validate();
      document.createdAt = new Date();
      document.updatedAt = new Date();
      document.__v = 0;
      records.set(String(document._id), document);
      return snapshot(document);
    },
    async findCreationReceipt(owner, key) { return snapshot([...records.values()].find(row => String(row.owner) === owner && row.creationKey === key)); },
    async findByIdForOwner(owner, id) {
      const document = records.get(String(id));
      return document && !document.deletedAt && String(document.owner) === String(owner) ? snapshot(document) : null;
    },
    async findForOwner(owner, { limit = 50 } = {}) {
      return [...records.values()].filter(row => String(row.owner) === String(owner) && !row.deletedAt)
        .sort((a, b) => b.transactionDate - a.transactionDate || String(b._id).localeCompare(String(a._id)))
        .slice(0, limit).map(snapshot);
    },
    async findPageForOwner(owner, query) {
      const field = query.sortBy;
      const direction = query.sortOrder === 'asc' ? 1 : -1;
      return [...records.values()].filter(row => {
        if (row.deletedAt || String(row.owner) !== String(owner) || row.currency !== query.currency) return false;
        if (query.type && row.type !== query.type) return false;
        if (query.category && row.category !== query.category) return false;
        if (query.from && row.transactionDate < new Date(query.from)) return false;
        if (query.to && row.transactionDate >= new Date(query.to)) return false;
        if (query.search && !row.title.toLowerCase().includes(query.search.toLowerCase())) return false;
        if (query.after) {
          const value = field === 'transactionDate' ? new Date(query.after.value).getTime() : query.after.value;
          const actual = field === 'transactionDate' ? row[field].getTime() : row[field];
          if (actual === value) return String(row._id).localeCompare(query.after.id) * direction > 0;
          return (actual - value) * direction > 0;
        }
        return true;
      }).sort((a, b) => ((a[field] - b[field]) || String(a._id).localeCompare(String(b._id))) * direction)
        .slice(0, query.limit + 1).map(snapshot);
    },
    async replaceForOwner(owner, id, version, data) {
      const document = records.get(String(id));
      if (!document || document.deletedAt || String(document.owner) !== String(owner) || document.__v !== version) return null;
      const updated = new Transaction({ ...data, owner, _id: document._id,
        creationKey: document.creationKey, creationHash: document.creationHash, createdAt: document.createdAt, updatedAt: new Date(), __v: version + 1 });
      await updated.validate();
      // Repeat the CAS after async validation, like the atomic database write.
      if (records.get(String(id)).__v !== version) return null;
      records.set(String(id), updated);
      return snapshot(updated);
    },
    async deleteForOwner(owner, id) {
      const document = await this.findByIdForOwner(owner, id);
      if (document) { const stored = records.get(String(id)); if (stored.creationKey || stored.recurringSchedule) { stored.deletedAt = new Date(); stored.__v++; } else records.delete(String(id)); }
      return document;
    },
  };
}

