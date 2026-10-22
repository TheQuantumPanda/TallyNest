import { timingSafeEqual } from 'node:crypto';

// Only the explicitly configured proxy may reach protected routes. The health
// check exposes no account/data state and remains reachable by Render itself.
export function proxyIngress(secret) {
  const expected = Buffer.from(secret);
  return (req, res, next) => {
    if (['GET', 'HEAD'].includes(req.method) && req.path === '/api/health') return next();
    const supplied = Buffer.from(req.get('x-tallynest-proxy-secret') || '');
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
      res.set('Cache-Control', 'no-store');
      return res.status(403).json({ status: 'error', message: 'Proxy access required' });
    }
    next();
  };
}
