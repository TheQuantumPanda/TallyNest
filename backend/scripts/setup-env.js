import { existsSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import dotenv from 'dotenv';

const target = new URL('../.env', import.meta.url);
const example = new URL('../.env.example', import.meta.url);
let content = readFileSync(existsSync(target) ? target : example, 'utf8');
const current = dotenv.parse(content);

if (!current.JWT_SECRET) {
  const line = `JWT_SECRET=${randomBytes(32).toString('hex')}`;
  content = /^\s*(?:export\s+)?JWT_SECRET\s*=/m.test(content)
    ? content.replace(/^[\t ]*(?:export[\t ]+)?JWT_SECRET[\t ]*=.*$/m, line)
    : `${content.trimEnd()}\n${line}\n`;
}
if (!Object.hasOwn(current, 'JWT_TTL_SECONDS'))
  content = `${content.trimEnd()}\nJWT_TTL_SECONDS=900\n`;

writeFileSync(target, content, { mode: 0o600 });
chmodSync(target, 0o600);
console.info('Local .env ready. Existing nonempty settings preserved; no secrets printed.');
