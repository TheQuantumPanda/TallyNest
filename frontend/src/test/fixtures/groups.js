import { allocateSplit } from '../../../../shared/split.js';
export const a = '507f1f77bcf86cd799439011',
  b = '507f1f77bcf86cd799439022',
  c = '507f1f77bcf86cd799439033',
  groupId = '507f1f77bcf86cd799439040',
  expenseId = '507f1f77bcf86cd799439050',
  settlementId = '507f1f77bcf86cd799439060';
export const date = '2026-10-14T12:00:00.000Z';
export const group = {
  id: groupId,
  name: 'Weekend house',
  description: 'A private shared record',
  currency: 'INR',
  version: 2,
  etag: `"tn-${groupId}-v2"`,
  membership: { role: 'owner', createdAt: date },
  createdAt: date,
  updatedAt: date,
  financialHistoryLocked: true,
};
export const members = [
  { id: a, name: 'Asha', role: 'owner', joinedAt: date },
  { id: b, name: 'Bala', role: 'member', joinedAt: date },
  { id: c, name: 'Charu', role: 'member', joinedAt: date },
];
const allocation = allocateSplit(10001, { method: 'equal', participants: [a, b, c] });
export const expense = {
  id: expenseId,
  groupId,
  creatorId: a,
  payer: a,
  title: 'Dinner together',
  amountMinor: 10001,
  currency: 'INR',
  category: 'food_dining',
  expenseDate: date,
  ...allocation,
  version: 0,
  etag: `"tn-${expenseId}-v0"`,
  createdAt: date,
  updatedAt: date,
};
export const pending = {
  id: settlementId,
  groupId,
  sender: b,
  recipient: a,
  amountMinor: 1000,
  currency: 'INR',
  status: 'pending',
  version: 0,
  etag: `"tn-${settlementId}-v0"`,
  createdAt: date,
};
export const confirmed = {
  ...pending,
  status: 'confirmed',
  version: 1,
  etag: `"tn-${settlementId}-v1"`,
  confirmedAt: date,
  decisionBy: a,
};
export const balances = {
  groupId,
  currency: 'INR',
  settlementMode: false,
  netTotalMinor: 0,
  members: [a, b, c].map((user, i) => ({
    user,
    paidMinor: i === 0 ? 10001 : 0,
    assignedMinor: i === 2 ? 3333 : 3334,
    confirmedSentMinor: 0,
    confirmedReceivedMinor: 0,
    netMinor: i === 0 ? 6667 : i === 1 ? -3334 : -3333,
    pendingSentMinor: 0,
    pendingReceivedMinor: 0,
  })),
  suggestions: [
    { sender: b, recipient: a, amountMinor: 3334, currency: 'INR' },
    { sender: c, recipient: a, amountMinor: 3333, currency: 'INR' },
  ],
};
export const page = (rows) => ({
  rows,
  pagination: { limit: 20, hasMore: false, nextAfter: null },
});
export const token = 'A'.repeat(43);
export const invitation = {
  id: '507f1f77bcf86cd799439070',
  createdAt: date,
  expiresAt: '2026-10-21T12:00:00.000Z',
  maxUses: 2,
  usedCount: 0,
  status: 'active',
};
export const failure = (status, code) =>
  Object.assign(new Error('Do not display private errors'), {
    response: { status, data: { code } },
  });
