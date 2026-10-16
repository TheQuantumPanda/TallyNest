import { emptyInputSchema } from '../validators/invitation.validator.js';
import { HttpError } from '../utils/httpError.js';
export function createMembershipController(service) {
  return {
    async list(req, res) {
      const data = await service.list(req.user.id, req.params.id, req.query);
      res.set('ETag', `"tn-${data.group.id}-v${data.group.version}"`);
      res.json({ status: 'ok', data });
    },
    async remove(req, res) {
      if (!emptyInputSchema.safeParse(req.query).success)
        throw new HttpError(400, 'Invalid membership query', 'INVALID_QUERY');
      const group = await service.remove(
        req.user.id,
        req.params.id,
        req.params.memberId,
        req.get('if-match'),
      );
      res.set('ETag', `"tn-${group.id}-v${group.version}"`);
      res.json({ status: 'ok', data: { group }, message: 'Member removed' });
    },
    async leave(req, res) {
      if (
        !emptyInputSchema.safeParse(req.body).success ||
        !emptyInputSchema.safeParse(req.query).success
      )
        throw new HttpError(400, 'Invalid membership request', 'INVALID_MEMBERSHIP');
      await service.remove(req.user.id, req.params.id, req.user.id, req.get('if-match'), true);
      res.json({ status: 'ok', message: 'Group left' });
    },
  };
}
