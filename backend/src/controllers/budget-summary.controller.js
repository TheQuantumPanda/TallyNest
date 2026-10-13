export function createBudgetSummaryController(service) {
  return async (req, res) => {
    const summary = await service.summary(req.user.id, req.query);
    res.status(200).json({ status: 'ok', data: { summary } });
  };
}
