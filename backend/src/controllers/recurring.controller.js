import { lifecycleInputSchema, processInputSchema } from '../validators/recurring.validator.js';
import { HttpError } from '../utils/httpError.js';
function respond(res, schedule, status = 200) {
  res.set('ETag', `"tn-${schedule.id}-v${schedule.version}"`);
  res.status(status).json({ status: 'ok', data: { schedule } });
}
function body(schema, input) {
  const result = schema.safeParse(input);
  if (!result.success) throw new HttpError(400, 'Invalid recurring request', 'INVALID_RECURRING');
  return result.data;
}
export function createRecurringController(service, engine) {
  const lifecycle = status => async (req, res) => {
    body(lifecycleInputSchema, req.body);
    respond(res, await service.update(req.user.id, req.params.id, { status }, req.get('if-match')));
  };
  return {
    async create(req, res) {
      const { schedule, replayed } = await service.create(req.user.id, req.body, req.get('idempotency-key'));
      res.set('ETag', `"tn-${schedule.id}-v${schedule.version}"`);
      res.status(replayed ? 200 : 201).json({ status: 'ok', data: { schedule, replayed } });
    },
    async list(req, res) { const { schedules, pagination } = await service.list(req.user.id, req.query); res.json({ status: 'ok', data: { schedules }, pagination }); },
    async get(req, res) { respond(res, await service.get(req.user.id, req.params.id)); },
    async update(req, res) { respond(res, await service.update(req.user.id, req.params.id, req.body, req.get('if-match'))); },
    async remove(req, res) { await service.remove(req.user.id, req.params.id); res.json({ status: 'ok', message: 'Recurring schedule deleted' }); },
    pause: lifecycle('paused'), resume: lifecycle('active'),
    async process(req, res) { const { limit } = body(processInputSchema, req.body); res.json({ status: 'ok', data: { processing: await engine.processDueSchedules({ owner: req.user.id, limit }) } }); },
  };
}
