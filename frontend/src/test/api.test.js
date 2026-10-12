import { describe, expect, it, vi } from 'vitest';
import { createApiClient } from '../services/api';

describe('centralized Axios client', () => {
  it('sends cookies and CSRF header for state changes, with no manual Origin header', async () => {
    const client = createApiClient('http://localhost:5000/api/');
    const seen = [];
    client.defaults.adapter = async (config) => {
      seen.push(config);
      return { status: 200, statusText: 'OK', headers: {}, config, data: {} };
    };
    await client.post('/auth/login', { email: 'alex@example.com', password: 'test-password' });
    await client.get('/auth/me');
    expect(client.defaults.baseURL).toBe('http://localhost:5000/api');
    expect(seen[0].withCredentials).toBe(true);
    expect(seen[0].headers.get('X-CSRF-Protection')).toBe('1');
    expect(seen[0].headers.get('Origin')).toBeUndefined();
    expect(seen[1].headers.get('X-CSRF-Protection')).toBeUndefined();
  });
  it('notifies subscribers of protected HTTP 401 and unsubscribes cleanly', async () => {
    const client = createApiClient('http://localhost:5000/api');
    client.defaults.adapter = (config) => Promise.reject({ config, response: { status: 401 } });
    const listener = vi.fn();
    const unsubscribe = client.onUnauthorized(listener);
    await expect(client.get('/protected')).rejects.toMatchObject({ response: { status: 401 } });
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    await expect(client.get('/protected')).rejects.toBeDefined();
    expect(listener).toHaveBeenCalledTimes(1);
  });
  it('login failures stay local to the form', async () => {
    const client = createApiClient('http://localhost:5000/api');
    client.defaults.adapter = (config) => Promise.reject({ config, response: { status: 401 } });
    const listener = vi.fn();
    client.onUnauthorized(listener);
    await expect(
      client.post('/auth/login', {}, { skipSessionInvalidation: true }),
    ).rejects.toBeDefined();
    expect(listener).not.toHaveBeenCalled();
  });
  it.each([
    'ftp://example.com',
    'https://user:secret@example.com',
    'https://example.com?secret=value',
  ])('rejects unsafe API configuration', (url) => {
    expect(() => createApiClient(url)).toThrow();
  });
});
