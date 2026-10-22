import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const envPath = fileURLToPath(new URL('../../.env', import.meta.url));

// 32 random bytes encoded as hex; length checks alone cannot prove entropy.
export const jwtSecretSchema = z
  .string()
  .regex(/^[a-fA-F0-9]{64}$/)
  .refine((value) => new Set(value.toLowerCase()).size >= 8);
export const jwtTtlSchema = z.coerce.number().int().min(60).max(1800).default(900);

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(5000),
    MONGO_URI: z
      .string()
      .trim()
      .regex(/^mongodb(?:\+srv)?:\/\/\S+$/),
    JWT_SECRET: jwtSecretSchema,
    JWT_TTL_SECONDS: jwtTtlSchema,
    PROXY_SHARED_SECRET: jwtSecretSchema.optional(),
    TRUST_PROXY_HOPS: z.enum(['0', '2']).default('0'),
    CLIENT_ORIGIN: z
      .string()
      .url()
      .refine((value) => {
        if (!URL.canParse(value)) return false;
        const url = new URL(value);
        return (
          ['http:', 'https:'].includes(url.protocol) &&
          url.username === '' &&
          url.password === '' &&
          url.pathname === '/' &&
          url.search === '' &&
          url.hash === ''
        );
      })
      .transform((value) => new URL(value).origin),
  })
  .refine((value) => (value.TRUST_PROXY_HOPS === '2') === !!value.PROXY_SHARED_SECRET, {
    path: ['TRUST_PROXY_HOPS'],
    message: 'Proxy trust requires the protected two-hop ingress',
  })
  .refine((value) => !value.PROXY_SHARED_SECRET || value.PROXY_SHARED_SECRET !== value.JWT_SECRET, {
    path: ['PROXY_SHARED_SECRET'],
    message: 'Ingress and signing secrets must differ',
  })
  .refine(
    (value) => value.NODE_ENV !== 'production' || value.CLIENT_ORIGIN.startsWith('https://'),
    { path: ['CLIENT_ORIGIN'], message: 'Production requires HTTPS' },
  );

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
    jwtSecret: result.data.JWT_SECRET,
    jwtTtlSeconds: result.data.JWT_TTL_SECONDS,
    proxySharedSecret: result.data.PROXY_SHARED_SECRET,
    trustProxyHops: Number(result.data.TRUST_PROXY_HOPS),
  });
}

export function loadEnv() {
  dotenv.config({ path: envPath, quiet: true });
  return parseEnv(process.env);
}
