import { randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';

const workFactor = 12;
let dummyHash;

export function hashPassword(password) {
  return bcrypt.hash(password, workFactor);
}

export async function verifyPassword(password, passwordHash) {
  // Unknown accounts still perform a bcrypt comparison. The dummy digest
  // belongs to no account and is generated once, without logging its input.
  dummyHash ??= hashPassword(randomBytes(32).toString('hex'));
  const fallback = await dummyHash;
  const digest = passwordHash ?? fallback;
  return bcrypt.compare(password, digest);
}
