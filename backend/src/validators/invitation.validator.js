import { z } from 'zod';
export const GROUP_INVITATION_LIMIT = 50;
export const INVITATION_USE_LIMIT = 20;
export const invitationInputSchema = z
  .object({
    expiresInSeconds: z
      .number()
      .int()
      .min(60)
      .max(7 * 86400)
      .default(86400),
    maxUses: z.number().int().min(1).max(INVITATION_USE_LIMIT).default(1),
  })
  .strict();
export const invitationTokenSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{43}$/)
  .refine((value) => Buffer.from(value, 'base64url').toString('base64url') === value);
export const emptyInputSchema = z.object({}).strict();
