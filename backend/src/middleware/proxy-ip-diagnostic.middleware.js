import { createHmac, timingSafeEqual } from 'node:crypto';
import { isIP, SocketAddress } from 'node:net';

// Shared with the offline comparison tool. Never log the input or HMAC key.
export function ipTag(token, address) {
  if (typeof address !== 'string' || !isIP(address) || address.includes('%')) return null;
  const parsed = SocketAddress.parse(address.includes(':') ? `[${address}]:0` : `${address}:0`);
  const normalized = parsed?.address.replace(/^::ffff:(?=\d+\.)/, '');
  if (!normalized) return null;
  return createHmac('sha256', token)
    .update(`tallynest-proxy-ip-v1:${normalized}`)
    .digest('hex')
    .slice(0, 24);
}

export function proxyIpDiagnostic(
  { token, until },
  origin,
  { now = Date.now, emit = (record) => console.info(JSON.stringify(record)) } = {},
) {
  const expected = Buffer.from(token);
  const deadline = Date.parse(until);
  if (
    !/^[a-fA-F0-9]{64}$/.test(token) ||
    !Number.isFinite(deadline) ||
    deadline - now() > 15 * 60 * 1000
  )
    throw new Error('Invalid temporary proxy diagnostic configuration');
  let emitted = 0;
  return (req, res, next) => {
    const supplied = Buffer.from(req.get('x-tallynest-proxy-diagnostic') || '');
    const probe = req.get('x-tallynest-proxy-probe') || '';
    if (
      now() >= deadline ||
      emitted >= 20 ||
      req.method !== 'GET' ||
      req.originalUrl !== '/api/auth/me' ||
      req.get('origin') !== origin ||
      !/^[AB]-(baseline|xff-single|xff-chain|xff-duplicate|xff-short|real-ip|forwarded|repeat)$/.test(
        probe,
      ) ||
      supplied.length !== expected.length ||
      !timingSafeEqual(supplied, expected)
    )
      return next();

    res.once('finish', () => {
      // requireAuth must have completed successfully. Never observe rejected,
      // anonymous, expired or unrelated traffic, and never alter its response.
      if (!req.user || res.statusCode !== 200 || now() >= deadline || emitted >= 20) return;
      const xff = req.get('x-forwarded-for') || '';
      const entries = xff.length <= 2048 ? xff.split(',').map((item) => item.trim()) : [];
      const bounded =
        xff.length > 0 &&
        xff.length <= 2048 &&
        entries.length <= 16 &&
        entries.every((item) => isIP(item));
      emitted++;
      try {
        emit({
          event: 'temporary-proxy-ip-v1',
          probe,
          sequence: emitted,
          trustHops: 2,
          xffCount: bounded ? entries.length : null,
          socketTag: ipTag(token, req.socket.remoteAddress),
          rightmostTag: bounded ? ipTag(token, entries.at(-1)) : null,
          secondRightTag: bounded ? ipTag(token, entries.at(-2)) : null,
          resolvedTag: ipTag(token, req.ip),
        });
      } catch {
        // An optional diagnostic sink must never fail or change an API response.
      }
    });
    next();
  };
}
