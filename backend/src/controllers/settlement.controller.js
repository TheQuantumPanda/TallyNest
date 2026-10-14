function single(res, settlement) {
  res.set('ETag', `"tn-${settlement.id}-v${settlement.version}"`);
  res.json({ status: 'ok', data: { settlement } });
}
export function createSettlementController(service) {
  const decide = (action) => async (req, res) =>
    single(
      res,
      await service.decide(
        req.user.id,
        req.params.id,
        req.params.settlementId,
        action,
        req.body,
        req.get('if-match'),
      ),
    );
  return {
    async balances(req, res) {
      res.json({
        status: 'ok',
        data: {
          balances: await service.balances(
            req.user.id,
            req.params.id,
            req.query,
          ),
        },
      });
    },
    async list(req, res) {
      const { settlements, pagination } = await service.list(
        req.user.id,
        req.params.id,
        req.query,
      );
      res.json({ status: 'ok', data: { settlements }, pagination });
    },
    async get(req, res) {
      single(
        res,
        await service.get(req.user.id, req.params.id, req.params.settlementId),
      );
    },
    async create(req, res) {
      const data = await service.create(
        req.user.id,
        req.params.id,
        req.body,
        req.get('idempotency-key'),
      );
      res.set('ETag', `"tn-${data.settlement.id}-v${data.settlement.version}"`);
      res.status(data.replayed ? 200 : 201).json({ status: 'ok', data });
    },
    confirm: decide('confirm'),
    reject: decide('reject'),
    async recover(req, res) {
      res.json({
        status: 'ok',
        data: await service.recover(req.user.id, req.params.id, req.body),
      });
    },
  };
}
