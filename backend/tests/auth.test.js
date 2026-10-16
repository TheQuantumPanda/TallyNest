import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { createApp } from '../app.js';
import { User } from '../src/models/user.model.js';
import { hashPassword, verifyPassword } from '../src/services/password.service.js';
import { registerSchema } from '../src/validators/auth.validator.js';

const secret = '0123456789abcdef'.repeat(4); // Public test fixture only.
const origin = 'http://localhost:5173';
const userId = '0123456789abcdef01234567';
const input = {
  name: ' Test User ',
  email: ' TEST@Example.com ',
  password: 'correct horse battery',
};

function isolatedRepository() {
  const users = new Map();
  return {
    users,
    async findByEmail(email) {
      return users.get(email) ?? null;
    },
    async findByEmailWithPassword(email) {
      return users.get(email) ?? null;
    },
    async findById(id) {
      return [...users.values()].find((user) => user._id === id) ?? null;
    },
    async create(data) {
      if (users.has(data.email)) throw Object.assign(new Error('duplicate'), { code: 11000 });
      const user = {
        ...data,
        _id: userId,
        createdAt: new Date('2026-01-01T00:00:00Z'),
        updatedAt: new Date('2026-01-01T00:00:00Z'),
      };
      users.set(data.email, user);
      return user;
    },
  };
}

async function setup(t, { config = {}, repository = isolatedRepository() } = {}) {
  const app = createApp(
    { nodeEnv: 'test', clientOrigin: origin, jwtSecret: secret, jwtTtlSeconds: 900, ...config },
    { repository },
  );
  const server = app.listen(0, '127.0.0.1');
  t.after(
    () =>
      new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  );
  await once(server, 'listening');
  const url = `http://127.0.0.1:${server.address().port}/api/auth`;
  async function request(
    path,
    { body, cookie, headers = {}, method = body ? 'POST' : 'GET' } = {},
  ) {
    const response = await fetch(`${url}${path}`, {
      method,
      headers: {
        Origin: config.clientOrigin ?? origin,
        'X-CSRF-Protection': '1',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(cookie ? { Cookie: cookie } : {}),
        ...headers,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: response.status, headers: response.headers, body: await response.json() };
  }
  return { request, repository, url };
}

function cookieOf(response) {
  return response.headers.get('set-cookie').split(';')[0];
}
function assertPublicUser(body) {
  assert.deepEqual(Object.keys(body.data.user).sort(), [
    'createdAt',
    'email',
    'id',
    'name',
    'updatedAt',
  ]);
  const json = JSON.stringify(body);
  for (const sensitive of ['password', 'passwordHash', 'token', secret, '$2b$', input.password]) {
    assert.equal(json.includes(sensitive), false, `Unexpected sensitive field: ${sensitive}`);
  }
}

test('registration normalizes input, hashes the password, returns 201 and an HTTP-only cookie', async (t) => {
  const { request, repository } = await setup(t);
  const response = await request('/register', { body: input });
  assert.equal(response.status, 201);
  assert.equal(response.body.data.user.name, 'Test User');
  assert.equal(response.body.data.user.email, 'test@example.com');
  assertPublicUser(response.body);
  const stored = repository.users.get('test@example.com');
  assert.notEqual(stored.passwordHash, input.password);
  assert.equal(bcrypt.getRounds(stored.passwordHash), 12);
  assert.equal(await verifyPassword(input.password, stored.passwordHash), true);
  const cookie = response.headers.get('set-cookie');
  assert.match(cookie, /^sfm_access=/);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Lax/);
  assert.match(cookie, /Path=\//);
  assert.match(cookie, /Max-Age=900/);
  assert.match(cookie, /Expires=/);
  assert.doesNotMatch(cookie, /Secure|Domain=/);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const payload = jwt.verify(cookieOf(response).slice('sfm_access='.length), secret, {
    algorithms: ['HS256'],
    issuer: 'smart-finance-manager',
    audience: 'smart-finance-manager-web',
  });
  assert.equal(payload.sub, userId);
  assert.equal(payload.exp - payload.iat, 900);
  assert.equal(payload.email, undefined);
});

test('duplicate registration returns 409 after normalized-email lookup', async (t) => {
  const { request, repository } = await setup(t);
  await request('/register', { body: input });
  const response = await request('/register', { body: { ...input, email: 'test@example.com' } });
  assert.equal(response.status, 409);
  assert.equal(repository.users.size, 1);
  assert.equal(response.headers.get('set-cookie'), null);
});

test('MongoDB unique-index errors are translated to safe duplicate responses', async (t) => {
  const repository = isolatedRepository();
  repository.create = async () => {
    throw Object.assign(new Error('sensitive database details'), { code: 11000 });
  };
  const { request } = await setup(t, { repository });
  const response = await request('/register', { body: input });
  assert.equal(response.status, 409);
  assert.deepEqual(response.body, {
    status: 'error',
    message: 'An account with this email already exists',
  });
});

test('invalid registration input is rejected before repository writes', async (t) => {
  const { request, repository } = await setup(t);
  assert.equal(registerSchema.safeParse({ ...input, password: '😀'.repeat(6) }).success, false);
  for (const body of [
    { ...input, name: ' ' },
    { ...input, email: 'invalid' },
    { ...input, password: 'short' },
    { ...input, password: '😀'.repeat(20) },
    { ...input, passwordHash: 'injected' },
  ]) {
    const response = await request('/register', { body });
    assert.equal(response.status, 400);
    assert.deepEqual(response.body, { status: 'error', message: 'Invalid request data' });
  }
  assert.equal(repository.users.size, 0);
});

test('password hashing is salted and verification is centralized', async () => {
  const one = await hashPassword(input.password);
  const two = await hashPassword(input.password);
  assert.notEqual(one, two);
  assert.equal(await verifyPassword(input.password, one), true);
  assert.equal(await verifyPassword('wrong password', one), false);
});

test('successful login returns public user and a fresh cookie', async (t) => {
  const { request } = await setup(t);
  await request('/register', { body: input });
  const response = await request('/login', {
    body: { email: input.email, password: input.password },
  });
  assert.equal(response.status, 200);
  assertPublicUser(response.body);
  assert.match(response.headers.get('set-cookie'), /HttpOnly/);
});

test('incorrect passwords and unknown accounts receive identical generic errors', async (t) => {
  const { request } = await setup(t);
  await request('/register', { body: input });
  const wrong = await request('/login', {
    body: { email: input.email, password: 'wrong password' },
  });
  const unknown = await request('/login', {
    body: { email: 'unknown@example.com', password: 'wrong password' },
  });
  assert.equal(wrong.status, 401);
  assert.equal(unknown.status, 401);
  assert.deepEqual(wrong.body, { status: 'error', message: 'Invalid email or password' });
  assert.deepEqual(unknown.body, wrong.body);
  assert.equal(wrong.headers.get('set-cookie'), null);
  assert.equal(unknown.headers.get('set-cookie'), null);
});

test('/me accepts a valid cookie and never exposes hashes', async (t) => {
  const { request } = await setup(t);
  const registered = await request('/register', { body: input });
  const response = await request('/me', { cookie: cookieOf(registered) });
  assert.equal(response.status, 200);
  assertPublicUser(response.body);
  assert.deepEqual(response.body.data.user, registered.body.data.user);
});

test('/me rejects absent cookies and ignores bearer headers', async (t) => {
  const { request } = await setup(t);
  const response = await request('/me', { headers: { Authorization: 'Bearer arbitrary' } });
  assert.equal(response.status, 401);
  assert.deepEqual(response.body, { status: 'error', message: 'Authentication required' });
});

test('/me rejects malformed, expired, wrong-signature, wrong-algorithm and invalid-claim JWTs', async (t) => {
  const { request } = await setup(t);
  const options = {
    subject: userId,
    issuer: 'smart-finance-manager',
    audience: 'smart-finance-manager-web',
  };
  const tokens = [
    'not-a-jwt',
    jwt.sign({ exp: 1 }, secret, options),
    jwt.sign({}, 'different-signing-secret', { ...options, expiresIn: 900 }),
    jwt.sign({}, secret, { ...options, algorithm: 'HS384', expiresIn: 900 }),
    jwt.sign({}, secret, options),
    jwt.sign({}, secret, { ...options, subject: 'bad-id', expiresIn: 900 }),
    jwt.sign({}, secret, { ...options, issuer: 'wrong', expiresIn: 900 }),
    jwt.sign({}, secret, { ...options, audience: 'wrong', expiresIn: 900 }),
    jwt.sign({}, secret, { ...options, noTimestamp: true, expiresIn: 900 }),
    jwt.sign({}, secret, { ...options, notBefore: 900, expiresIn: 1800 }),
    jwt.sign({ iat: 1, exp: 4102444800 }, secret, options),
    jwt.sign({}, '', { ...options, algorithm: 'none', expiresIn: 900 }),
  ];
  for (const token of tokens) {
    const response = await request('/me', { cookie: `sfm_access=${token}` });
    assert.equal(response.status, 401);
    assert.deepEqual(response.body, { status: 'error', message: 'Authentication required' });
  }
});

test('malformed auth JSON cannot echo passwords or stack traces in development', async (t) => {
  const { url } = await setup(t, { config: { nodeEnv: 'development' } });
  for (const authUrl of [url, url.replace('/api/auth', '/API/AUTH')]) {
    const response = await fetch(`${authUrl}/register`, {
      method: 'POST',
      headers: { Origin: origin, 'X-CSRF-Protection': '1', 'Content-Type': 'application/json' },
      body: '{"password":"private-password",broken}',
    });
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { status: 'error', message: 'Bad Request' });
  }
});

test('/me rejects a token whose account no longer exists', async (t) => {
  const { request, repository } = await setup(t);
  const registered = await request('/register', { body: input });
  repository.users.clear();
  assert.equal((await request('/me', { cookie: cookieOf(registered) })).status, 401);
});

test('logout clears matching cookie settings but does not revoke an issued JWT', async (t) => {
  const { request } = await setup(t);
  const registered = await request('/register', { body: input });
  const cookie = cookieOf(registered);
  const response = await request('/logout', { method: 'POST', cookie });
  assert.equal(response.status, 200);
  const cleared = response.headers.get('set-cookie');
  assert.match(cleared, /^sfm_access=;/);
  assert.match(cleared, /HttpOnly/);
  assert.match(cleared, /Path=\//);
  assert.match(cleared, /SameSite=Lax/);
  assert.match(cleared, /Expires=Thu, 01 Jan 1970/);
  assert.doesNotMatch(cleared, /Max-Age=900/);
  assert.equal((await request('/me')).status, 401);
  assert.equal((await request('/me', { cookie })).status, 200);
});

test('production cookie is Secure, host-only, HTTP-only and clears consistently', async (t) => {
  const { request } = await setup(t, {
    config: { nodeEnv: 'production', clientOrigin: 'https://app.example' },
  });
  const registered = await request('/register', { body: input });
  const cleared = await request('/logout', { method: 'POST' });
  assert.equal(registered.status, 201);
  for (const response of [registered, cleared]) {
    const cookie = response.headers.get('set-cookie');
    assert.match(cookie, /^__Host-sfm_access=/);
    assert.match(cookie, /Secure/);
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /SameSite=Lax/);
    assert.match(cookie, /Path=\//);
    assert.doesNotMatch(cookie, /Domain=/);
  }
});

test('registration and login have independent IP rate limits', async (t) => {
  const { request } = await setup(t);
  for (const [path, count] of [
    ['/register', 5],
    ['/login', 10],
  ]) {
    for (let i = 0; i < count; i++) {
      assert.equal((await request(path, { body: {} })).status, 400);
    }
    const limited = await request(path, { body: {} });
    assert.equal(limited.status, 429);
    assert.equal(limited.body.status, 'error');
    assert.ok(limited.headers.get('retry-after'));
    assert.ok(limited.headers.get('ratelimit'));
  }
});

test('all state-changing auth endpoints reject missing or untrusted Origin and CSRF headers', async (t) => {
  const { request, repository } = await setup(t);
  for (const path of ['/register', '/login', '/logout']) {
    for (const headers of [
      { Origin: '' },
      { Origin: 'null' },
      { Origin: 'https://evil.example' },
      { Origin: `${origin}.evil.example` },
      { 'X-CSRF-Protection': '' },
      { 'X-CSRF-Protection': 'wrong' },
    ]) {
      const response = await request(path, { body: input, headers });
      assert.equal(response.status, 403);
      assert.deepEqual(response.body, {
        status: 'error',
        message: 'Request origin or CSRF header rejected',
      });
      assert.equal(response.headers.get('set-cookie'), null);
    }
  }
  assert.equal(repository.users.size, 0);
});

test('authentication input requires JSON and never accepts password hashes or extra login fields', async (t) => {
  const { request } = await setup(t);
  assert.equal(
    (await request('/register', { body: input, headers: { 'Content-Type': 'text/plain' } })).status,
    415,
  );
  assert.equal(
    (
      await request('/login', {
        body: { email: input.email, password: input.password, role: 'admin' },
      })
    ).status,
    400,
  );
});

test('credentialed CORS preflight permits only the configured origin and required headers', async (t) => {
  const app = createApp({ clientOrigin: origin, jwtSecret: secret });
  const server = app.listen(0, '127.0.0.1');
  t.after(() => new Promise((resolve) => server.close(resolve)));
  await once(server, 'listening');
  for (const incomingOrigin of [origin, 'https://evil.example']) {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/auth/login`, {
      method: 'OPTIONS',
      headers: {
        Origin: incomingOrigin,
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'content-type,x-csrf-protection',
      },
    });
    assert.equal(response.status, 204);
    assert.equal(response.headers.get('access-control-allow-origin'), origin);
    assert.equal(response.headers.get('access-control-allow-credentials'), 'true');
    assert.match(response.headers.get('access-control-allow-headers'), /X-CSRF-Protection/);
  }
});

test('auth database failures return safe errors in development and production', async (t) => {
  for (const nodeEnv of ['development', 'production']) {
    const repository = isolatedRepository();
    repository.findByEmail = async () => {
      throw new Error(`database credentials ${input.password}`);
    };
    const { request } = await setup(t, { repository, config: { nodeEnv } });
    const response = await request('/register', { body: input });
    assert.equal(response.status, 500);
    assert.deepEqual(response.body, { status: 'error', message: 'Internal server error' });
  }
});

test('model normalizes email, declares unique index, hides hashes and rejects plaintext storage', async () => {
  const hash = await hashPassword(input.password);
  const user = new User({ name: input.name, email: input.email, passwordHash: hash });
  await user.validate();
  assert.equal(user.email, 'test@example.com');
  assert.equal(User.schema.path('passwordHash').options.select, false);
  assert.ok(User.schema.indexes().some(([keys, options]) => keys.email === 1 && options.unique));
  assert.equal(user.toJSON().passwordHash, undefined);
  assert.equal(user.toObject().passwordHash, undefined);
  await assert.rejects(
    new User({ name: 'User', email: 'user@example.com', passwordHash: input.password }).validate(),
  );
});

test('missing signing configuration fails closed without registering users', async (t) => {
  const { request, repository } = await setup(t, { config: { jwtSecret: undefined } });
  const response = await request('/register', { body: input });
  assert.equal(response.status, 503);
  assert.equal(repository.users.size, 0);
});
