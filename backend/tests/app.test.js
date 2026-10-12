import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';
import express from 'express';
import app, { createApp } from '../app.js';
import { errorHandler } from '../src/middleware/errorHandler.js';

async function serve(t, application) {
  const server = application.listen(0, '127.0.0.1');
  t.after(() => new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  }));
  await once(server, 'listening');
  return `http://127.0.0.1:${server.address().port}`;
}

test('GET /api/health returns the stable health response without MongoDB', async (t) => {
  const baseUrl = await serve(t, app);
  const response = await fetch(`${baseUrl}/api/health`);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /application\/json/);
  assert.deepEqual(await response.json(), {
    status: 'ok',
    message: 'Smart Finance Manager API is running',
  });
  assert.equal(response.headers.get('x-powered-by'), null);
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
});

test('unknown routes return a JSON 404', async (t) => {
  const baseUrl = await serve(t, createApp());
  const response = await fetch(`${baseUrl}/api/missing`);
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { status: 'error', message: 'Route not found' });
});

test('CORS uses the configured frontend origin', async (t) => {
  const baseUrl = await serve(t, createApp({ clientOrigin: 'https://frontend.example' }));
  for (const origin of ['https://frontend.example', 'https://untrusted.example']) {
    const response = await fetch(`${baseUrl}/api/health`, { headers: { Origin: origin } });
    assert.equal(response.headers.get('access-control-allow-origin'), 'https://frontend.example');
    await response.json();
  }
});

test('centralized error handler hides internal messages and stacks in production', async (t) => {
  const application = express();
  application.set('env', 'production');
  application.get('/fail', async () => {
    throw new Error('secret database details');
  });
  application.use(errorHandler);
  const baseUrl = await serve(t, application);
  const response = await fetch(`${baseUrl}/fail`);
  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), { status: 'error', message: 'Internal server error' });
});

test('malformed JSON reaches the centralized error handler', async (t) => {
  const baseUrl = await serve(t, createApp({ nodeEnv: 'production' }));
  const response = await fetch(`${baseUrl}/api/health`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"secret":',
  });
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { status: 'error', message: 'Bad Request' });
});

test('JSON body-size limit rejects oversized input', async (t) => {
  const baseUrl = await serve(t, createApp({ nodeEnv: 'production' }));
  const response = await fetch(`${baseUrl}/api/health`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ value: 'x'.repeat(101 * 1024) }),
  });
  assert.equal(response.status, 413);
  assert.deepEqual(await response.json(), { status: 'error', message: 'Payload Too Large' });
});
