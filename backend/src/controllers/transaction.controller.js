export function createTransactionController(service) {
  return {
    async create(req, res) {
      const transaction = await service.create(req.user.id, req.body);
      res.status(201).json({ status: 'ok', data: { transaction } });
    },
    async list(req, res) {
      const transactions = await service.list(req.user.id, req.query);
      res.status(200).json({ status: 'ok', data: { transactions } });
    },
    async get(req, res) {
      const transaction = await service.get(req.user.id, req.params.id);
      res.status(200).json({ status: 'ok', data: { transaction } });
    },
    async update(req, res) {
      const transaction = await service.update(req.user.id, req.params.id, req.body);
      res.status(200).json({ status: 'ok', data: { transaction } });
    },
    async remove(req, res) {
      await service.remove(req.user.id, req.params.id);
      res.status(200).json({ status: 'ok', message: 'Transaction deleted' });
    },
  };
}
