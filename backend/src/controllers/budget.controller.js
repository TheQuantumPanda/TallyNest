function respond(res, budget, status = 200) {
  res.set('ETag', `"tn-${budget.id}-v${budget.version}"`);
  res.status(status).json({ status: 'ok', data: { budget } });
}
export function createBudgetController(service) {
  return {
    async create(req, res) {
      respond(res, await service.create(req.user.id, req.body), 201);
    },
    async list(req, res) {
      res.json({ status: 'ok', data: { budgets: await service.list(req.user.id, req.query) } });
    },
    async get(req, res) {
      respond(res, await service.get(req.user.id, req.params.id));
    },
    async update(req, res) {
      respond(res, await service.update(req.user.id, req.params.id, req.body, req.get('if-match')));
    },
    async remove(req, res) {
      await service.remove(req.user.id, req.params.id);
      res.json({ status: 'ok', message: 'Budget deleted' });
    },
  };
}
