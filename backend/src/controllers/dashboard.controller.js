export function createDashboardController(service) {
  return {
    async summary(req, res) {
      res.status(200).json({ status: 'ok', data: { summary: await service.summary(req.user.id, req.query) } });
    },
  };
}
