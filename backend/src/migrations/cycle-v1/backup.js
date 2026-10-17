import { randomBytes, createCipheriv, createDecipheriv, createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, realpath, stat } from 'node:fs/promises';
import { createReadStream, createWriteStream } from 'node:fs';
import { resolve, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { pipeline } from 'node:stream/promises';
import mongoose from 'mongoose';
import { TEST_DATABASE, fail } from './safety.js';
import { databaseDigest, databaseSchemaDigest } from './reconcile.js';
async function command(args) {
  const { stdout } = await promisify(execFile)('docker', [
    'ps',
    '--filter',
    'publish=27017',
    '--filter',
    'ancestor=mongo:8.0',
    '--format',
    '{{.ID}}',
  ]);
  const ids = stdout.trim().split(/\s+/).filter(Boolean);
  if (ids.length !== 1 || !/^[a-f0-9]{12,64}$/.test(ids[0]))
    fail('AMBIGUOUS_BACKUP_TOOL_CONTAINER');
  const child = spawn('docker', ['exec', '-i', ids[0], ...args], {
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  // Tool errors are intentionally not printed: raw messages can contain data/credentials.
  child.stderr.resume();
  const done = new Promise((resolve, reject) => {
    child.on('error', () => reject(new Error('BACKUP_TOOL_UNAVAILABLE')));
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error('BACKUP_TOOL_FAILED'))));
  });
  done.catch(() => {});
  return { child, done };
}
export async function rehearsalBackup({ db, database, restoreDatabase, directory }) {
  if (
    !TEST_DATABASE.test(database ?? '') ||
    db.databaseName !== database ||
    !TEST_DATABASE.test(restoreDatabase ?? '') ||
    database === restoreDatabase
  )
    fail('UNSAFE_BACKUP_TARGET');
  directory = resolve(directory);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  directory = await realpath(directory);
  const inside = relative(fileURLToPath(new URL('../../../../', import.meta.url)), directory);
  if (!inside || (!inside.startsWith('..') && !isAbsolute(inside)))
    fail('BACKUP_OUTSIDE_REPOSITORY_REQUIRED');
  if ((await stat(directory)).mode & 0o077) fail('BACKUP_PERMISSIONS_UNSAFE');
  const archive = resolve(directory, 'backup.enc'),
    keyFile = resolve(directory, 'backup.key');
  const key = randomBytes(32),
    iv = randomBytes(12);
  await writeFile(keyFile, key, { mode: 0o600, flag: 'wx' });
  const sourceDigest = await databaseDigest(db),
    sourceSchemaDigest = await databaseSchemaDigest(db);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const dump = await command(['mongodump', `--db=${database}`, '--archive', '--gzip', '--quiet']);
  dump.child.stdin.end();
  await Promise.all([
    pipeline(dump.child.stdout, cipher, createWriteStream(archive, { mode: 0o600, flags: 'wx' })),
    dump.done,
  ]);
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(archive)) hash.update(chunk);
  const tag = cipher.getAuthTag();
  const proof = {
    version: 1,
    database,
    restoreDatabase,
    encryption: 'aes-256-gcm',
    archive,
    keyFile,
    iv: iv.toString('hex'),
    tag: tag.toString('hex'),
    archiveHash: hash.digest('hex'),
    sourceDigest,
    sourceSchemaDigest,
    restored: false,
  };
  const restore = await mongoose
    .createConnection(`mongodb://127.0.0.1:27017/${restoreDatabase}`, {
      autoCreate: false,
      autoIndex: false,
    })
    .asPromise();
  let ownsRestore = false;
  try {
    if ((await restore.db.listCollections().toArray()).length) fail('RESTORE_TARGET_NOT_EMPTY');
    ownsRestore = true;
    const decipher = createDecipheriv('aes-256-gcm', await readFile(keyFile), iv);
    decipher.setAuthTag(tag);
    const process = await command([
      'mongorestore',
      '--archive',
      '--gzip',
      '--stopOnError',
      '--bypassDocumentValidation',
      `--nsFrom=${database}.*`,
      `--nsTo=${restoreDatabase}.*`,
      '--quiet',
    ]);
    process.child.stdout.resume();
    await Promise.all([
      pipeline(createReadStream(archive), decipher, process.child.stdin),
      process.done,
    ]);
    proof.restoreDigest = await databaseDigest(restore.db);
    proof.restoreSchemaDigest = await databaseSchemaDigest(restore.db);
    if (
      proof.restoreDigest !== sourceDigest ||
      proof.restoreSchemaDigest !== sourceSchemaDigest ||
      (await databaseSchemaDigest(db)) !== sourceSchemaDigest ||
      (await databaseDigest(db)) !== sourceDigest
    )
      fail('RESTORE_RECONCILIATION_FAILED');
    proof.restored = true;
  } finally {
    // Only this explicitly named disposable restore database may be dropped.
    if (ownsRestore) await restore.dropDatabase();
    await restore.close();
  }
  const manifest = resolve(directory, 'manifest.json');
  await writeFile(manifest, JSON.stringify(proof, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
  return manifest;
}
