import { z } from 'zod';
import { api } from './api';

// Pick only public profile fields; unexpected server fields cannot enter auth state.
const userSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  email: z.string().email(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
const userFrom = (response) => userSchema.parse(response.data.data.user);
const authRequest = { skipSessionInvalidation: true };

export const authService = {
  async login(values) {
    return userFrom(await api.post('/auth/login', values, authRequest));
  },
  async register(values) {
    return userFrom(await api.post('/auth/register', values, authRequest));
  },
  async me() {
    return userFrom(await api.get('/auth/me', authRequest));
  },
  async logout() {
    await api.post('/auth/logout');
  },
};
