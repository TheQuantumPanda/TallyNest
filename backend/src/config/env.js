import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const envPath = fileURLToPath(new URL('../../.env', import.meta.url));

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(5000),
  MONGO_URI: z.string().trim().regex(/^mongodb(?:\+srv)?:\/\/\S+$/),
  CLIENT_ORIGIN: z.string().url().refine((value) => {
    if (!URL.canParse(value)) return false;
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol)
      && url.username === '' && url.password === ''
      && url.pathname === '/' && url.search === '' && url.hash === '';
  }).transform((value) => new URL(value).origin),
});

export function parseEnv(source) {
  const result = envSchema.safeParse(source);

  if (!result.success) {
    const names = [...new Set(result.error.issues.map((issue) => issue.path[0]))];
    // Report variable names only; MongoDB URIs can contain credentials.
    throw new Error(`Invalid environment configuration: ${names.join(', ')}`);
  }

  return Object.freeze({
    nodeEnv: result.data.NODE_ENV,
    port: result.data.PORT,
    mongoUri: result.data.MONGO_URI,
    clientOrigin: result.data.CLIENT_ORIGIN,
  });
}

export function loadEnv() {
  dotenv.config({ path: envPath, quiet: true });
  return parseEnv(process.env);
}
