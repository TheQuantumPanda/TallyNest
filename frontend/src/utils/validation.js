import { z } from 'zod';

const email = z.string().trim().toLowerCase().email('Enter a valid email address.').max(254);
const password = z
  .string()
  .refine(
    (value) => new TextEncoder().encode(value).length <= 72,
    'This password is too long. Try a shorter passphrase.',
  );

export const loginSchema = z.object({
  email,
  password: password.refine((value) => value.length > 0, 'Enter your password.'),
});
export const registerSchema = z.object({
  name: z.string().trim().min(1, 'Enter your name.').max(100, 'Use 100 characters or fewer.'),
  email,
  password: password.refine((value) => [...value].length >= 12, 'Use at least 12 characters.'),
});

export function validateAuth(mode, values) {
  const result = (mode === 'register' ? registerSchema : loginSchema).safeParse(values);
  if (result.success) return { data: result.data, errors: {} };
  const errors = {};
  for (const issue of result.error.issues) errors[issue.path[0]] ??= issue.message;
  return { data: null, errors };
}
