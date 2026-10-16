import { HttpError } from './httpError.js';
const max = BigInt(Number.MAX_SAFE_INTEGER);
export const unsafeBalances = (code = 'BALANCE_DATA_INVALID') =>
  new HttpError(422, 'Group financial data cannot be safely reconciled', code);
function integer(value) {
  const text = value?.toString();
  if (!/^\d+$/.test(text ?? '')) throw unsafeBalances();
  return BigInt(text);
}
export function safeBalanceNumber(value) {
  if (typeof value !== 'bigint') throw unsafeBalances();
  if (value < -max || value > max) throw unsafeBalances('BALANCE_OVERFLOW');
  return Number(value);
}
export function calculateBalances(memberIds, result) {
  if (
    !result?.expenses ||
    !result?.settlements ||
    result.expenses.invalid?.length ||
    result.settlements.invalid?.length
  )
    throw unsafeBalances();
  const rows = new Map(
    memberIds.map((id) => [
      String(id),
      {
        user: String(id),
        paid: 0n,
        assigned: 0n,
        sent: 0n,
        received: 0n,
        reservedSent: 0n,
        reservedReceived: 0n,
      },
    ]),
  );
  if (rows.size !== memberIds.length || rows.size > 100) throw unsafeBalances();
  for (const [source, key, target] of [
    [result.expenses, 'paid', 'paid'],
    [result.expenses, 'assigned', 'assigned'],
    [result.settlements, 'sent', 'sent'],
    [result.settlements, 'received', 'received'],
    [result.settlements, 'reservedSent', 'reservedSent'],
    [result.settlements, 'reservedReceived', 'reservedReceived'],
  ]) {
    const seen = new Set();
    if (!Array.isArray(source[key]) || source[key].length > 100) throw unsafeBalances();
    for (const item of source[key]) {
      const id = String(item._id);
      if (!rows.has(id) || seen.has(id)) throw unsafeBalances();
      seen.add(id);
      rows.get(id)[target] = integer(item.amount);
    }
  }
  const sums = {
    paid: 0n,
    assigned: 0n,
    sent: 0n,
    received: 0n,
    reservedSent: 0n,
    reservedReceived: 0n,
    net: 0n,
  };
  for (const row of rows.values()) {
    row.net = row.paid - row.assigned + row.sent - row.received;
    if (
      row.reservedSent > (row.net < 0n ? -row.net : 0n) ||
      row.reservedReceived > (row.net > 0n ? row.net : 0n)
    )
      throw unsafeBalances();
    for (const key of Object.keys(sums)) {
      safeBalanceNumber(row[key]);
      sums[key] += row[key];
    }
  }
  for (const value of Object.values(sums)) safeBalanceNumber(value);
  if (
    sums.paid !== sums.assigned ||
    sums.sent !== sums.received ||
    sums.reservedSent !== sums.reservedReceived ||
    sums.net !== 0n
  )
    throw unsafeBalances();
  return [...rows.values()].sort((a, b) => (a.user < b.user ? -1 : a.user > b.user ? 1 : 0));
}
export function simplifyDebts(input) {
  if (!Array.isArray(input) || input.length > 100) throw unsafeBalances();
  const balances = input.map((row) => {
    if (!row || (typeof row.net !== 'bigint' && !Number.isSafeInteger(row.net)))
      throw unsafeBalances();
    const net = BigInt(row.net);
    safeBalanceNumber(net);
    return { user: String(row.user), net };
  });
  if (
    balances.reduce((sum, row) => sum + row.net, 0n) !== 0n ||
    new Set(balances.map((row) => row.user)).size !== balances.length
  )
    throw unsafeBalances();
  const order = (a, b) => (a.user < b.user ? -1 : a.user > b.user ? 1 : 0);
  const debtors = balances.filter((row) => row.net < 0n).sort(order),
    creditors = balances.filter((row) => row.net > 0n).sort(order),
    transfers = [];
  let d = 0,
    c = 0;
  while (d < debtors.length && c < creditors.length) {
    const amount = -debtors[d].net < creditors[c].net ? -debtors[d].net : creditors[c].net;
    transfers.push({
      sender: debtors[d].user,
      recipient: creditors[c].user,
      amountMinor: safeBalanceNumber(amount),
      currency: 'INR',
    });
    debtors[d].net += amount;
    creditors[c].net -= amount;
    if (debtors[d].net === 0n) d++;
    if (creditors[c].net === 0n) c++;
  }
  return transfers;
}
export function assertSettlementCapacity(rows, sender, recipient, amountMinor, reservePending) {
  const from = rows.find((row) => row.user === sender),
    to = rows.find((row) => row.user === recipient),
    amount = BigInt(amountMinor);
  const debt = from ? -from.net - (reservePending ? from.reservedSent : 0n) : 0n;
  const credit = to ? to.net - (reservePending ? to.reservedReceived : 0n) : 0n;
  if (sender === recipient || amount <= 0n || amount > debt || amount > credit)
    throw new HttpError(
      409,
      'Settlement exceeds available debtor or creditor capacity',
      'SETTLEMENT_EXCESS',
    );
}
