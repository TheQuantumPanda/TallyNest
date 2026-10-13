import mongoose from 'mongoose';
import { recurringInputSchema, frequencySchema } from '../validators/recurring.validator.js';
import { transactionDateSchema, ownerIdSchema } from '../validators/transaction.validator.js';
import { cursorAfter, scheduleValues } from '../utils/recurrence.js';

function field(type, validator, options = {}) {
  return { type, set(value) { return value === undefined || value === null ? value : validator.parse(value); }, ...options };
}
function date(options = {}) {
  return { type: Date, set(value) { return value == null ? value : new Date(transactionDateSchema.parse(value instanceof Date ? value.toISOString() : value)); }, ...options };
}
const fields = recurringInputSchema.shape;
const schema = new mongoose.Schema({
  owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, immutable: true,
    set(value) { return value === undefined ? value : ownerIdSchema.parse(value instanceof mongoose.Types.ObjectId ? value.toHexString() : value); } },
  type: field(String, fields.type, { required: true }), title: field(String, fields.title, { required: true }),
  amountMinor: field(Number, fields.amountMinor, { required: true }), currency: field(String, fields.currency, { required: true, default: 'INR' }),
  category: field(String, fields.category, { required: true }), notes: field(String, fields.notes),
  frequency: field(String, frequencySchema, { required: true }), status: field(String, fields.status, { required: true, default: 'active' }),
  startDate: date({ required: true }), endDate: date(), nextOccurrenceDate: date({ default: null }),
  lastOccurrenceDate: date({ default: null }), occurrenceNumber: { type: Number, required: true, min: 0, default: 0, validate: Number.isSafeInteger },
  pending: { type: new mongoose.Schema({ date: date({ required: true }), transactionId: { type: mongoose.Schema.Types.ObjectId, required: true } }, { _id: false }), default: undefined },
}, { timestamps: true, strict: 'throw', optimisticConcurrency: true });
schema.pre('validate', function () {
  const result = recurringInputSchema.safeParse(scheduleValues(this));
  if (!result.success) this.invalidate('category', 'Invalid recurring schedule');
  else {
    const cursor = cursorAfter(result.data, this.lastOccurrenceDate);
    if (this.occurrenceNumber !== cursor.occurrenceNumber || this.nextOccurrenceDate?.getTime() !== cursor.nextOccurrenceDate?.getTime()) this.invalidate('nextOccurrenceDate', 'Invalid recurrence cursor');
    if (this.pending && this.pending.date?.getTime() !== this.nextOccurrenceDate?.getTime()) this.invalidate('pending', 'Invalid pending occurrence');
  }
});
schema.index({ owner: 1, _id: -1 });
schema.index({ status: 1, nextOccurrenceDate: 1, _id: 1 });
export const RecurringSchedule = mongoose.model('RecurringSchedule', schema);
