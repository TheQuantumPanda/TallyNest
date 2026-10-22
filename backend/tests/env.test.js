import assert from 'node:assert/strict';
import test from 'node:test';
import { parseEnv } from '../src/config/env.js';

const validEnv = {
  NODE_ENV: 'development',
  PORT: '5000',
  MONGO_URI: 'mongodb://127.0.0.1:27017/smart_finance_manager',
  CLIENT_ORIGIN: 'http://localhost:5173',
  JWT_SECRET: '0123456789abcdef'.repeat(4), // Public test fixture, never a deployment secret.
};

test('environment parsing validates and normalizes configuration', () => {
  assert.deepEqual(parseEnv(validEnv), {
    nodeEnv: 'development',
    port: 5000,
    mongoUri: validEnv.MONGO_URI,
    clientOrigin: validEnv.CLIENT_ORIGIN,
    jwtSecret: validEnv.JWT_SECRET,
    jwtTtlSeconds: 900,
    proxySharedSecret: undefined,
    trustProxyHops: 0,
  });
  assert.equal(
    parseEnv({ ...validEnv, CLIENT_ORIGIN: 'http://localhost:5173/' }).clientOrigin,
    'http://localhost:5173',
  );
});

test('JWT secret is required, strong-format, and never included in errors', () => {
  for (const secret of [undefined, '', 'change-me', 'a'.repeat(64)]) {
    assert.throws(
      () => parseEnv({ ...validEnv, JWT_SECRET: secret }),
      /^Error: Invalid environment configuration: JWT_SECRET$/,
    );
  }
});

test('JWT lifetime is bounded and production frontend requires HTTPS', () => {
  for (const value of ['0', '59', '1801', '15m', 'abc']) {
    assert.throws(() => parseEnv({ ...validEnv, JWT_TTL_SECONDS: value }), /JWT_TTL_SECONDS/);
  }
  assert.equal(parseEnv({ ...validEnv, JWT_TTL_SECONDS: '600' }).jwtTtlSeconds, 600);
  assert.throws(() => parseEnv({ ...validEnv, NODE_ENV: 'production' }), /CLIENT_ORIGIN/);
  assert.equal(
    parseEnv({ ...validEnv, NODE_ENV: 'production', CLIENT_ORIGIN: 'https://app.example' }).nodeEnv,
    'production',
  );
});

test('MongoDB URI and frontend origin are required', () => {
  const { MONGO_URI, CLIENT_ORIGIN, ...missingEnv } = validEnv;
  assert.throws(() => parseEnv(missingEnv), /MONGO_URI, CLIENT_ORIGIN/);
});

test('invalid environment settings are rejected without exposing input values', () => {
  for (const invalidEnv of [
    { PORT: '0' },
    { PORT: '65536' },
    { PORT: 'abc' },
    { NODE_ENV: 'invalid' },
    { MONGO_URI: 'https://user:secret@example.com' },
    { CLIENT_ORIGIN: 'not-a-url' },
    { CLIENT_ORIGIN: 'ftp://localhost' },
    { CLIENT_ORIGIN: 'http://localhost/path' },
    { CLIENT_ORIGIN: 'http://user:secret@localhost' },
  ]) {
    assert.throws(
      () => parseEnv({ ...validEnv, ...invalidEnv }),
      (error) => {
        assert.match(error.message, /^Invalid environment configuration:/);
        assert.equal(error.message.includes('secret'), false);
        return true;
      },
    );
  }
});

test('proxy trust is bounded and requires a separate strong ingress secret', () => {
  for (const config of [
    { TRUST_PROXY_HOPS: 'true' },
    { TRUST_PROXY_HOPS: '1' },
    { TRUST_PROXY_HOPS: '2' },
    { PROXY_SHARED_SECRET: validEnv.JWT_SECRET },
    { TRUST_PROXY_HOPS: '2', PROXY_SHARED_SECRET: 'placeholder' },
  ])
    assert.throws(() => parseEnv({ ...validEnv, ...config }), /configuration/);
  const config = parseEnv({
    ...validEnv,
    TRUST_PROXY_HOPS: '2',
    PROXY_SHARED_SECRET: 'abcdef0123456789'.repeat(4),
  });
  assert.equal(config.trustProxyHops, 2);
  assert.equal(config.proxySharedSecret, 'abcdef0123456789'.repeat(4));
});
