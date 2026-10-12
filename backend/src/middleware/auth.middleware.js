import { HttpError } from '../utils/httpError.js';

export function requireAuth(authService, cookieName) {
  return async (req, _res, next) => {
    const token = req.cookies?.[cookieName];
    if (!token || typeof token !== 'string') throw new HttpError(401, 'Authentication required');
    const id = authService.verifyAccessToken(token);
    req.user = await authService.getCurrentUser(id);
    next();
  };
}
