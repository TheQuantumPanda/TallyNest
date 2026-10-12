import { z } from 'zod';
import { HttpError } from '../utils/httpError.js';

const email = z.string().trim().toLowerCase().email().max(254);
const password = z.string().max(72).refine((value) => Buffer.byteLength(value, 'utf8') <= 72);

export const registerSchema = z.object({
  name: z.string().trim().min(1).max(100),
  email,
  password: password.refine((value) => [...value].length >= 12),
}).strict();

export const loginSchema = z.object({ email, password: password.min(1) }).strict();

export function validateAuth(schema) {
  return (req, _res, next) => {
    if (!req.is('application/json')) return next(new HttpError(415, 'JSON content type required'));
    const result = schema.safeParse(req.body);
    if (!result.success) return next(new HttpError(400, 'Invalid request data'));
    req.validatedBody = result.data;
    next();
  };
}
