import { beforeEach, describe, expect, it, vi } from 'vitest';
import { authService } from '../services/auth';
import { api } from '../services/api';

vi.mock('../services/api', () => ({ api: { get: vi.fn(), post: vi.fn() } }));
const user = {
  id: 'user-id',
  name: 'Alex',
  email: 'alex@example.com',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};
beforeEach(() => {
  api.get.mockResolvedValue({ data: { data: { user } } });
  api.post.mockResolvedValue({ data: { data: { user } } });
});
describe('actual backend response contract', () => {
  it('uses all four endpoints and extracts data.user', async () => {
    const values = { email: user.email, password: 'correct horse battery' };
    expect(await authService.login(values)).toEqual(user);
    expect(api.post).toHaveBeenCalledWith('/auth/login', values, { skipSessionInvalidation: true });
    expect(await authService.register({ ...values, name: user.name })).toEqual(user);
    expect(api.post).toHaveBeenCalledWith(
      '/auth/register',
      { ...values, name: user.name },
      { skipSessionInvalidation: true },
    );
    expect(await authService.me()).toEqual(user);
    expect(api.get).toHaveBeenCalledWith('/auth/me', { skipSessionInvalidation: true });
    await authService.logout();
    expect(api.post).toHaveBeenCalledWith('/auth/logout');
  });
  it('drops unexpected sensitive server fields before returning a public user', async () => {
    api.get.mockResolvedValue({
      data: {
        token: 'unexpected-token',
        data: { user: { ...user, passwordHash: 'unexpected-hash' } },
      },
    });
    expect(await authService.me()).toEqual(user);
  });
});
