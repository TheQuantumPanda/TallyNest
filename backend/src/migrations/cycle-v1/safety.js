import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { z } from 'zod';
export const MIGRATION_VERSION = 1;
export const RUN_ID = 'settlement-cycles-v1';
export const TEST_DATABASE = /^tallynest_cycle_rehearsal_\d{13}_[a-f0-9]{12}$/;
export class MigrationError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}
export const fail = (code) => {
  throw new MigrationError(code);
};
export function safeTarget({ uri, database, maintenanceId, offline, writersStopped, disposable }) {
  if (!TEST_DATABASE.test(database ?? '')) fail('UNSAFE_DATABASE_TARGET');
  let parsed;
  try {
    parsed = new URL(uri);
  } catch {
    fail('INVALID_EXPLICIT_URI');
  }
  if (
    parsed.protocol !== 'mongodb:' ||
    parsed.hostname !== '127.0.0.1' ||
    parsed.port !== '27017' ||
    parsed.pathname !== `/${database}` ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash
  )
    fail('UNSAFE_DATABASE_URI');
  if (
    !z.string().uuid().safeParse(maintenanceId).success ||
    offline !== true ||
    disposable !== true ||
    writersStopped !== true
  )
    fail('OFFLINE_ATTESTATION_REQUIRED');
  return { uri, database, maintenanceId: maintenanceId.toLowerCase() };
}
export const digest = (text) => createHash('sha256').update(text).digest('hex');
export async function backupEvidence(path, database) {
  if (!path) fail('VERIFIED_BACKUP_REQUIRED');
  const mode = (await stat(path)).mode;
  if ((mode & 0o077) !== 0) fail('BACKUP_PERMISSIONS_UNSAFE');
  let proof;
  try {
    proof = JSON.parse(await readFile(path, 'utf8'));
  } catch {
    fail('INVALID_BACKUP_MANIFEST');
  }
  if (
    proof.version !== 1 ||
    proof.database !== database ||
    proof.encryption !== 'aes-256-gcm' ||
    proof.restored !== true ||
    proof.sourceDigest !== proof.restoreDigest ||
    !proof.sourceSchemaDigest ||
    proof.sourceSchemaDigest !== proof.restoreSchemaDigest ||
    !/^[a-f0-9]{64}$/.test(proof.sourceDigest ?? '') ||
    !TEST_DATABASE.test(proof.restoreDatabase ?? '') ||
    proof.restoreDatabase === database
  )
    fail('BACKUP_RESTORE_PROOF_REQUIRED');
  if ((await stat(proof.archive)).mode & 0o077 || (await stat(proof.keyFile)).mode & 0o077)
    fail('BACKUP_PERMISSIONS_UNSAFE');
  const archiveDigest = createHash('sha256');
  for await (const chunk of createReadStream(proof.archive)) archiveDigest.update(chunk);
  if (archiveDigest.digest('hex') !== proof.archiveHash) fail('BACKUP_CHECKSUM_MISMATCH');
  return { ...proof, manifestHash: digest(JSON.stringify(proof)) };
}
