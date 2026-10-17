import { z } from 'zod';
import { allocateSplit } from '../../../shared/split.js';
import { positiveMinor, utcDate, categoriesFor, decimalAmount } from './transactions';
export { allocateSplit };
export const expenseCategories = categoriesFor('expense');
export const FREEZE_WARNING =
  'Proposing the first settlement permanently freezes shared expense creation, editing and deletion in this group. Rejected settlements do not unlock it. There is no reversal or unlock operation.';
export const PAYMENT_NOTICE =
  'Confirming records your acknowledgement of this settlement in TallyNest. It does not verify an external bank payment.';

export function groupError(error) {
  const code = error.response?.data?.code,
    status = error.response?.status;
  const messages = {
    INVALID_CURSOR:
      'This history cursor is no longer usable. Reload records to start a new traversal.',
    FINANCIAL_BUSY:
      'A durable financial operation is pending. Financial activity is blocked until the actor or owner recovers it.',
    RECOVERY_FORBIDDEN: 'Only the original operation actor or group owner may recover it.',
    EXPENSES_FROZEN: 'Settlement mode permanently freezes shared expense modifications.',
    FINANCIAL_HISTORY_LOCKED:
      'Financial history permanently prevents group deletion and membership departure.',
    SETTLEMENT_EXCESS:
      'This amount exceeds available debt or credit after pending reservations. Reload balances and review.',
    SETTLEMENT_DECIDED:
      'This settlement already has a decision. Reload its record to review the outcome.',
    IDEMPOTENCY_CONFLICT:
      'This submission key belongs to different data. Review the existing records before starting another submission.',
    EXPENSE_DELETED:
      'The original expense was deleted. Its receipt cannot be reused to recreate it.',
    BALANCE_OVERFLOW:
      'The financial totals exceed the safe reporting limit. No partial balance is shown.',
    BALANCE_DATA_INVALID:
      'The group financial records cannot be reconciled safely. No partial balance is shown.',
    ALREADY_MEMBER: 'You are already a member of this group.',
    ALREADY_ACCEPTED: 'This invitation was already accepted by this account.',
    GROUP_FULL: 'This group has reached its member limit.',
    INVITATION_LIMIT: 'Invitation capacity reached. Revoke an unused link or wait for expiry.',
    INVITATION_UNAVAILABLE: 'This invitation is invalid, expired, revoked or exhausted.',
    CYCLE_PROTOCOL_INACTIVE:
      'This group does not have the cycle protocol. It cannot be opened in the disposable cycle workspace. Return to the group list and use a group created by the current cycle-test fixture; restart that fixture if its groups are stale.',
  };
  if (messages[code]) return messages[code];
  if (status === 401) return 'Your session has ended. Please sign in again.';
  if (status === 404) return 'This record is no longer available, or you do not have access.';
  if ([409, 412, 428].includes(status))
    return 'The record needs a current version. Your draft is retained; reload and review before continuing.';
  if (status === 403) return 'This action could not be authorized.';
  if (status === 429) return 'Too many requests. Wait a moment before trying again.';
  if (status === 400) return 'Check your inputs and try again.';
  return 'The request could not be completed. Its outcome may be unknown; review the latest records before starting another submission.';
}
export function expenseValues(row, members, user) {
  return {
    title: row?.title || '',
    amount: row ? decimalAmount(row.amountMinor) : '',
    category: row?.category || 'food_dining',
    payer: row?.payer || user,
    date: row?.expenseDate.slice(0, 10) || new Date().toISOString().slice(0, 10),
    notes: row?.notes || '',
    method: row?.split.method || 'equal',
    participants: row
      ? row.split.participants.map((p) => (typeof p === 'string' ? p : p.user))
      : members.map((m) => m.id),
    allocations: row
      ? Object.fromEntries(
          row.split.participants
            .filter((p) => typeof p !== 'string')
            .map((p) => [
              p.user,
              row.split.method === 'exact'
                ? decimalAmount(p.amountMinor)
                : decimalAmount(p.basisPoints),
            ]),
        )
      : {},
  };
}
export function expenseForm(values, members, original) {
  const errors = {},
    roster = new Set(members.map((row) => row.id));
  const title = values.title.trim(),
    notes = values.notes.trim();
  if (!title || title.length > 200) errors.title = 'Enter a title of 1–200 characters.';
  if (notes.length > 2000) errors.notes = 'Use 2,000 characters or fewer.';
  if (!roster.has(values.payer)) errors.payer = 'Choose a current group member.';
  if (!expenseCategories.some((row) => row.id === values.category))
    errors.category = 'Choose an expense category.';
  let amountMinor, expenseDate, allocation;
  try {
    amountMinor = positiveMinor(values.amount);
  } catch {
    errors.amount = 'Enter a positive exact amount with up to 2 decimals, within the safe limit.';
  }
  try {
    expenseDate =
      original && values.date === original.expenseDate.slice(0, 10)
        ? original.expenseDate
        : utcDate(values.date);
  } catch {
    errors.date = 'Choose a valid UTC calendar date.';
  }
  try {
    if (values.participants.some((user) => !roster.has(user))) throw new Error();
    const split = {
      method: values.method,
      participants: values.participants.map((user) =>
        values.method === 'equal'
          ? user
          : values.method === 'exact'
            ? { user, amountMinor: positiveMinor(values.allocations[user] || '') }
            : { user, basisPoints: positiveMinor(values.allocations[user] || '') },
      ),
    };
    allocation = allocateSplit(amountMinor, split);
  } catch {
    errors.split =
      'Select unique members with positive shares. Exact shares must equal the total; percentages must total 100%, with no zero-paisa beneficiaries.';
  }
  if (Object.keys(errors).length)
    return { errors, ...(allocation ? { shares: allocation.shares } : {}) };
  return {
    errors,
    shares: allocation.shares,
    data: {
      title,
      amountMinor,
      currency: 'INR',
      category: values.category,
      payer: values.payer,
      expenseDate,
      split: allocation.split,
      ...(original ? { notes: notes || null } : notes ? { notes } : {}),
    },
  };
}
export function validateGroup(values, original) {
  const result = z
    .object({
      name: z
        .string()
        .trim()
        .min(1, 'Enter a group name.')
        .max(100, 'Use 100 characters or fewer.'),
      description: z.string().trim().max(2000, 'Use 2,000 characters or fewer.'),
    })
    .safeParse(values);
  if (!result.success)
    return {
      errors: Object.fromEntries(
        result.error.issues.map((issue) => [issue.path[0], issue.message]),
      ),
    };
  return {
    errors: {},
    data: {
      ...result.data,
      description: original ? result.data.description || null : result.data.description,
      currency: 'INR',
    },
  };
}
export function capacity(position, outgoing) {
  if (!position) return 0;
  const available = outgoing
    ? -BigInt(position.netMinor) - BigInt(position.pendingSentMinor)
    : BigInt(position.netMinor) - BigInt(position.pendingReceivedMinor);
  return Number(available > 0n ? available : 0n);
}
