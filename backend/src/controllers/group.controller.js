function respond(res, group, status = 200) {
  res.set('ETag', `"tn-${group.id}-v${group.version}"`);
  res.status(status).json({ status: 'ok', data: { group } });
}
export function createGroupController(service) {
  return {
    async create(req, res) { respond(res, await service.create(req.user.id, req.body), 201); },
    async list(req, res) { const { groups, pagination } = await service.list(req.user.id, req.query); res.json({ status: 'ok', data: { groups }, pagination }); },
    async get(req, res) { respond(res, await service.get(req.user.id, req.params.id)); },
    async update(req, res) { respond(res, await service.update(req.user.id, req.params.id, req.body, req.get('if-match'))); },
    async remove(req, res) { await service.remove(req.user.id, req.params.id); res.json({ status: 'ok', message: 'Group deleted' }); },
  };
}
