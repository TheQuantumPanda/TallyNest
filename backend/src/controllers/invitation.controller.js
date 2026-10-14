import { emptyInputSchema } from '../validators/invitation.validator.js';
import { HttpError } from '../utils/httpError.js';
function strictQuery(req) { if (!emptyInputSchema.safeParse(req.query).success) throw new HttpError(400, 'Invalid invitation query', 'INVALID_QUERY'); }
export function createInvitationController(service) {
  const tag = (res, group) => res.set('ETag', `"tn-${group.id}-v${group.version}"`);
  return {
    async create(req, res) { strictQuery(req); const data = await service.create(req.user.id, req.params.id, req.body, req.get('if-match')); tag(res, data.group); res.status(201).json({ status: 'ok', data }); },
    async list(req, res) { const data = await service.list(req.user.id, req.params.id, req.query); tag(res, data.group); res.json({ status: 'ok', data }); },
    async revoke(req, res) { strictQuery(req); const group = await service.revoke(req.user.id, req.params.id, req.params.invitationId, req.get('if-match')); tag(res, group); res.json({ status: 'ok', data: { group }, message: 'Invitation revoked' }); },
    async inspect(req, res) { res.json({ status: 'ok', data: { invitation: await service.inspect(req.params.token, req.query) } }); },
    async accept(req, res) { strictQuery(req); const group = await service.accept(req.user.id, req.params.token, req.body); tag(res, group); res.json({ status: 'ok', data: { group }, message: 'Invitation accepted' }); },
  };
}
