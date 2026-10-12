import assert from 'node:assert/strict';
import test from 'node:test';
import { parseEnv } from '../src/config/env.js';

const validEnv = {
  NODE_ENV: 'development',
  PORT: '5000',
  MONGO_URI: 'mongodb://127.0.0.1:27017/smart_finance_manager',
  CLIENT_ORIGIN: 'http://localhost:5173',
};

test('environment parsing validates and normalizes configuration', () => {
  assert.deepEqual(parseEnv(validEnv), {
    nodeEnv: 'development', port: 5000,
    mongoUri: validEnv.MONGO_URI, clientOrigin: validEnv.CLIENT_ORIGIN,
  });
  assert.equal(parseEnv({ ...validEnv, CLIENT_ORIGIN: 'http://localhost:5173/' }).clientOrigin,
    'http://localhost:5173');
});

test('MongoDB URI and frontend origin are required', () => {
  const { MONGO_URI, CLIENT_ORIGIN, ...missingEnv } = validEnv;
  assert.throws(() => parseEnv(missingEnv), /MONGO_URI, CLIENT_ORIGIN/);
});

test('invalid environment settings are rejected without exposing input values', () => {
  for (const invalidEnv of [
    { PORT: '0' }, { PORT: '65536' }, { PORT: 'abc' }, { NODE_ENV: 'invalid' },
    { MONGO_URI: 'https://user:secret@example.com' },
    { CLIENT_ORIGIN: 'not-a-url' },
    { CLIENT_ORIGIN: 'ftp://localhost' }, { CLIENT_ORIGIN: 'http://localhost/path' },
    { CLIENT_ORIGIN: 'http://user:secret@localhost' },
  ]) {
    assert.throws(() => parseEnv({ ...validEnv, ...invalidEnv }), (error) => {
      assert.match(error.message, /^Invalid environment configuration:/);
      assert.equal(error.message.includes('secret'), false);
      return true;
    });
  }
});
