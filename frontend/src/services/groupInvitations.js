import { z } from 'zod';
import { api } from './api';
import { id, count, timestamp, path, single, groupSchema, versionHeaders } from './groups';
export const tokenSchema = z.string().regex(/^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/);
const metadata = z
  .object({
    id,
    createdAt: timestamp,
    expiresAt: timestamp,
    maxUses: count.min(1).max(20),
    usedCount: count.max(20),
    status: z.enum(['active', 'expired', 'revoked', 'exhausted']),
  })
  .refine((row) => row.usedCount <= row.maxUses);
export const groupInvitationsService = {
  async list(groupId, signal) {
    const response = await api.get(path(groupId) + '/invitations', { signal });
    return {
      group: single(response, 'group', groupSchema),
      invitations: z.array(metadata).max(50).parse(response.data.data.invitations),
    };
  },
  async create(row, data) {
    const response = await api.post(path(row.id) + '/invitations', data, {
      headers: versionHeaders(row),
    });
    return {
      group: single(response, 'group', groupSchema),
      invitation: metadata.parse(response.data.data.invitation),
      token: tokenSchema.parse(response.data.data.token),
    };
  },
  async revoke(row, target) {
    return single(
      await api.delete(path(row.id) + `/invitations/${id.parse(target)}`, {
        headers: versionHeaders(row),
      }),
      'group',
      groupSchema,
    );
  },
  async inspect(token, signal) {
    tokenSchema.parse(token);
    return z
      .object({
        status: z.literal('ok'),
        data: z.object({
          invitation: z.object({
            group: z.object({ id, name: z.string(), currency: z.literal('INR') }),
            expiresAt: timestamp,
          }),
        }),
      })
      .parse((await api.get(`/invitations/${token}`, { signal })).data).data.invitation;
  },
  async accept(token) {
    tokenSchema.parse(token);
    return single(await api.post(`/invitations/${token}/accept`, {}), 'group', groupSchema);
  },
};
