function setVersion(res, transaction) {
  res.set('ETag', `"tn-${transaction.id}-v${transaction.version}"`);
}

export function createTransactionController(service) {
  return {
    async create(req, res) {
      const { transaction, replayed } = await service.create(
        req.user.id,
        req.body,
        req.get('idempotency-key'),
      );
      setVersion(res, transaction);
      res.status(replayed ? 200 : 201).json({ status: 'ok', data: { transaction, replayed } });
    },
    async list(req, res) {
      const { transactions, pagination } = await service.list(req.user.id, req.query);
      res.status(200).json({ status: 'ok', data: { transactions }, pagination });
    },
    async get(req, res) {
      const transaction = await service.get(req.user.id, req.params.id);
      setVersion(res, transaction);
      res.status(200).json({ status: 'ok', data: { transaction } });
    },
    async update(req, res) {
      const transaction = await service.update(
        req.user.id,
        req.params.id,
        req.body,
        req.get('if-match'),
      );
      setVersion(res, transaction);
      res.status(200).json({ status: 'ok', data: { transaction } });
    },
    async remove(req, res) {
      await service.remove(req.user.id, req.params.id);
      res.status(200).json({ status: 'ok', message: 'Transaction deleted' });
    },
  };
}
