function respond(res, expense) { res.set('ETag', `"tn-${expense.id}-v${expense.version}"`); res.json({ status: 'ok', data: { expense } }); }
export function createGroupExpenseController(service) {
  return {
    async create(req, res) { const data = await service.create(req.user.id, req.params.id, req.body, req.get('idempotency-key')); res.set('ETag', `"tn-${data.expense.id}-v${data.expense.version}"`); res.status(data.replayed ? 200 : 201).json({ status: 'ok', data }); },
    async list(req, res) { const { expenses, pagination } = await service.list(req.user.id, req.params.id, req.query); res.json({ status: 'ok', data: { expenses }, pagination }); },
    async get(req, res) { respond(res, await service.get(req.user.id, req.params.id, req.params.expenseId)); },
    async update(req, res) { respond(res, await service.update(req.user.id, req.params.id, req.params.expenseId, req.body, req.get('if-match'))); },
    async remove(req, res) { await service.remove(req.user.id, req.params.id, req.params.expenseId, req.get('if-match')); res.json({ status: 'ok', message: 'Group expense deleted' }); },
  };
}
