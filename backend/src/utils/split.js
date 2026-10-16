import { amountMinorSchema } from '../validators/transaction.validator.js';
import { splitSchema } from '../validators/group-expense.validator.js';
import { allocateSplit as allocate } from '../../../shared/split.js';
export function allocateSplit(amountMinor, input) {
  return allocate(amountMinorSchema.parse(amountMinor), splitSchema.parse(input));
}
