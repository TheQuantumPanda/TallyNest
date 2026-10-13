import { createHash, createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { cursorPayloadSchema } from '../validators/transaction-query.validator.js';
import { jwtSecretSchema } from '../config/env.js';
import { HttpError } from './httpError.js';

export function queryBinding(query) {
  // Fixed key order, normalized defaults; page size can change without changing traversal.
  const values = ['type', 'category', 'currency', 'from', 'to', 'search', 'sortBy', 'sortOrder']
    .map(key => [key, query[key] ?? null]);
  return createHash('sha256').update(JSON.stringify(values)).digest('hex');
}

export function createTransactionCursor(secret, now = () => Date.now()) {
  function key() {
    if (!jwtSecretSchema.safeParse(secret).success) throw new HttpError(503, 'Pagination is unavailable', 'PAGINATION_UNAVAILABLE');
    return createHash('sha256').update('TallyNest transaction cursor v1\0').update(secret).digest();
  }
  return {
    encode(owner, query, last) {
      const payload = cursorPayloadSchema.parse({
        v: 1, owner, binding: queryBinding(query), id: String(last._id),
        value: query.sortBy === 'transactionDate' ? last.transactionDate.toISOString() : last.amountMinor,
        expiresAt: now() + 24 * 60 * 60 * 1000,
      });
      const nonce = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', key(), nonce);
      cipher.setAAD(Buffer.from('TallyNest.cursor.v1'));
      const encrypted = Buffer.concat([cipher.update(JSON.stringify(payload), 'utf8'), cipher.final()]);
      return 'v1.' + Buffer.concat([nonce, cipher.getAuthTag(), encrypted]).toString('base64url');
    },
    decode(cursor, owner, query) {
      const secretKey = key();
      try {
        const encoded = cursor.slice(3);
        const packed = Buffer.from(encoded, 'base64url');
        if (packed.length <= 28 || packed.toString('base64url') !== encoded) throw new Error('Invalid encoding');
        const decipher = createDecipheriv('aes-256-gcm', secretKey, packed.subarray(0, 12));
        decipher.setAAD(Buffer.from('TallyNest.cursor.v1'));
        decipher.setAuthTag(packed.subarray(12, 28));
        const clear = Buffer.concat([decipher.update(packed.subarray(28)), decipher.final()]);
        const payload = cursorPayloadSchema.parse(JSON.parse(clear.toString('utf8')));
        if (payload.owner !== owner || payload.binding !== queryBinding(query) || payload.expiresAt <= now()) throw new Error('Invalid context');
        if (typeof payload.value !== (query.sortBy === 'transactionDate' ? 'string' : 'number')) throw new Error('Invalid sort value');
        return { id: payload.id, value: payload.value };
      } catch {
        throw new HttpError(400, 'Invalid or incompatible cursor', 'INVALID_CURSOR');
      }
    },
  };
}
