import { RecurringSchedule } from '../../src/models/recurring.model.js';
import { Transaction } from '../../src/models/transaction.model.js';
import { cursorAfter } from '../../src/utils/recurrence.js';
export function isolatedRecurring() {
  const schedules = new Map(), ledger = new Map();
  const copy = row => row ? RecurringSchedule.hydrate(row.toObject()) : null;
  const repository = {
    async createForOwner(owner, data) {
      const row = new RecurringSchedule({ ...data, owner, ...cursorAfter(data), __v: 0 }); await row.validate();
      row.createdAt = row.updatedAt = new Date('2024-01-01T00:00:00.000Z'); schedules.set(String(row._id), row); return copy(row);
    },
    async findByIdForOwner(owner, id) { const row = schedules.get(id); return row && String(row.owner) === owner ? copy(row) : null; },
    async listForOwner(owner, { status, limit, after }) { return [...schedules.values()].filter(row => String(row.owner) === owner && (!status || row.status === status) && (!after || String(row._id) < after))
      .sort((a, b) => String(b._id).localeCompare(String(a._id))).slice(0, limit + 1).map(copy); },
    async replaceForOwner(owner, id, version, data, lastOccurrenceDate) {
      const old = schedules.get(id); if (!old || String(old.owner) !== owner || old.__v !== version || old.pending) return null;
      const row = new RecurringSchedule({ ...data, owner, _id: id, __v: version + 1, ...cursorAfter(data, lastOccurrenceDate), lastOccurrenceDate, createdAt: old.createdAt, updatedAt: new Date() });
      await row.validate(); if (schedules.get(id)?.__v !== version || schedules.get(id)?.pending) return null;
      schedules.set(id, row); return copy(row);
    },
    async deleteForOwner(owner, id) { const row = await this.findByIdForOwner(owner, id); if (!row || row.pending) return null; schedules.delete(id); return row; },
    async findDue({ owner, asOf, exclude = [] }) { return copy([...schedules.values()].filter(row => (!owner || String(row.owner) === owner) && row.status === 'active' && row.nextOccurrenceDate && row.nextOccurrenceDate <= asOf && !exclude.includes(String(row._id)))
      .sort((a, b) => a.nextOccurrenceDate - b.nextOccurrenceDate || String(a._id).localeCompare(String(b._id)))[0]); },
    async reserve(document, transactionId) {
      const id = String(document._id), row = schedules.get(id);
      if (!row || row.__v !== document.__v || row.status !== 'active' || row.pending) return null;
      row.pending = { date: row.nextOccurrenceDate, transactionId }; row.__v++; return copy(row);
    },
    async advance(document, cursor) {
      const row = schedules.get(String(document._id));
      if (!row || row.__v !== document.__v || String(row.pending?.transactionId) !== String(document.pending.transactionId)) return null;
      row.lastOccurrenceDate = row.pending.date; Object.assign(row, cursor); row.pending = undefined; row.__v++; return copy(row);
    },
  };
  const transactions = {
    async createGeneratedForOwner(owner, id, scheduleId, date, data) {
      const existing = [...ledger.values()].find(row => String(row.recurringSchedule) === scheduleId && row.scheduledDate.getTime() === date.getTime());
      if (existing) return { document: existing, created: false };
      const row = new Transaction({ ...data, owner, _id: id, recurringSchedule: scheduleId, scheduledDate: date, __v: 0 }); await row.validate();
      const latest = ledger.get(id); if (latest) return { document: latest, created: false };
      row.createdAt = row.updatedAt = new Date(); ledger.set(id, row); return { document: row, created: true };
    },
  };
  return { repository, transactions, schedules, ledger };
}
