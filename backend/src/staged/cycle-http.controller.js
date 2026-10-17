import { parse, id, etag } from './contract.js';
export function createCycleHttpController(service) {
  function send(res, data, status = 200, pagination) {
    const resource = data.cycle ?? data.expense ?? data.settlement;
    if (resource) res.set('ETag', etag({ _id: resource.id, __v: resource.version }));
    res.set('X-Group-ETag', data.group.etag);
    res
      .status(status)
      .json({ status: 'ok', apiVersion: 2, data, ...(pagination ? { pagination } : {}) });
  }
  const context = (req) => [req.user.id, parse(id, req.params.groupId)];
  return {
    list: (kind) => async (req, res) => {
      const result = await service.list(...context(req), kind, req.query);
      send(res, result.data, 200, result.pagination);
    },
    get: (kind) => async (req, res) =>
      send(res, await service.get(...context(req), kind, req.params.target, req.query)),
    transition: (action) => async (req, res) => {
      const result = await service.transition(
        ...context(req),
        action,
        req.params.target,
        req.body,
        {
          key: req.get('idempotency-key'),
          match: req.get('if-match'),
          groupMatch: req.get('if-group-match'),
          cycleMatch: req.get('if-cycle-match'),
        },
      );
      send(res, result, action === 'open' && !result.replayed ? 201 : 200);
    },
    create: (kind) => async (req, res) => {
      const result = await service.create(
        ...context(req),
        kind,
        req.body,
        req.get('idempotency-key'),
      );
      send(res, result, result.replayed ? 200 : 201);
    },
    mutate: (kind, action) => async (req, res) =>
      send(
        res,
        await service.mutate(
          ...context(req),
          kind,
          req.params.target,
          action,
          req.body,
          req.get('if-match'),
        ),
      ),
    balances: async (req, res) => send(res, await service.balances(...context(req), req.query)),
    recover: async (req, res) => send(res, await service.recover(...context(req), req.body)),
  };
}
