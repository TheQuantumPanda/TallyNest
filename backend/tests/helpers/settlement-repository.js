import { GroupSettlement } from '../../src/models/group-settlement.model.js';
export function isolatedSettlements() {
  const records = new Map(), copy = row => row ? GroupSettlement.hydrate(row.toObject()) : null;
  const find = (group, target) => { const row = records.get(target); return row && String(row.group) === group ? row : null; };
  return { records,
    async find(group, target) { return copy(find(group, target)); },
    async receipt(group, sender, key) { return copy([...records.values()].find(row => String(row.group) === group && String(row.sender) === sender && row.creationKey === key)); },
    async list(group, { limit, after }) { return [...records.values()].filter(row => String(row.group) === group && (!after || String(row._id) < after)).sort((a, b) => String(b._id).localeCompare(String(a._id))).slice(0, limit + 1).map(copy); },
    async create(group, op) {
      const p = op.payload;
      const row = new GroupSettlement({ _id: p.targetId, group, sender: op.actor, recipient: p.recipient, amountMinor: p.amountMinor, currency: 'INR', status: 'pending', createdAt: op.createdAt, __v: 0, creationKey: p.key, creationHash: p.hash, lastFinancialOperation: op._id });
      await row.validate();
      if ([...records.values()].some(item => String(item.group) === group && String(item.sender) === String(op.actor) && item.creationKey === p.key)) throw Object.assign(new Error('duplicate'), { code: 11000 });
      records.set(String(row._id), row); return copy(row);
    },
    async decide(group, op) {
      const old = find(group, op.payload.targetId); if (!old || old.status !== 'pending' || old.__v !== op.payload.version || String(old.recipient) !== String(op.actor)) return null;
      old.status = op.kind === 'settlement_confirm' ? 'confirmed' : 'rejected'; old[old.status === 'confirmed' ? 'confirmedAt' : 'rejectedAt'] = new Date(); old.decisionBy = op.actor; old.lastFinancialOperation = op._id; old.__v++;
      return copy(old);
    },
  };
}
export function isolatedBalances(expenses, settlements) {
  return { async aggregate(group) {
    const e = { invalid: [], paid: [], assigned: [] }, s = { invalid: [], sent: [], received: [], reservedSent: [], reservedReceived: [] };
    function add(rows, id, amount) { const item = rows.find(row => row._id === String(id)); if (item) item.amount = String(BigInt(item.amount) + BigInt(amount)); else rows.push({ _id: String(id), amount: String(amount) }); }
    for (const row of expenses.records.values()) if (String(row.group) === group && !row.deletedAt) { add(e.paid, row.payer, row.amountMinor); for (const share of row.shares) add(e.assigned, share.user, share.amountMinor); }
    for (const row of settlements.records.values()) if (String(row.group) === group) {
      if (row.status === 'confirmed') { add(s.sent, row.sender, row.amountMinor); add(s.received, row.recipient, row.amountMinor); }
      if (row.status === 'pending') { add(s.reservedSent, row.sender, row.amountMinor); add(s.reservedReceived, row.recipient, row.amountMinor); }
    }
    return { expenses: e, settlements: s };
  } };
}
