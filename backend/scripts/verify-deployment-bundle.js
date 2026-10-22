import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Synthetic values only; never print or load the real deployment secret.
const canary = randomBytes(32).toString('hex');
const root = new URL('../../', import.meta.url);
const build = spawnSync('npm', ['run', 'build', '--prefix', 'frontend'], {
  cwd: fileURLToPath(root),
  env: { ...process.env, PROXY_SHARED_SECRET: canary },
  stdio: 'inherit',
});
assert.equal(build.status, 0, 'Production build failed');

async function inspect(directory) {
  let count = 0;
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = new URL(entry.name + (entry.isDirectory() ? '/' : ''), directory);
    if (entry.isDirectory()) count += await inspect(path);
    else {
      const bytes = await readFile(path);
      for (const marker of [canary, 'PROXY_SHARED_SECRET', 'x-tallynest-proxy-secret']) {
        assert.equal(bytes.includes(Buffer.from(marker)), false, 'Ingress marker in public output');
      }
      count++;
    }
  }
  return count;
}
const count = await inspect(new URL('frontend/dist/', root));
assert.ok(count > 0, 'No public build output inspected');
console.log(`Deployment bundle check passed: ${count} files; no ingress canary or configuration.`);
