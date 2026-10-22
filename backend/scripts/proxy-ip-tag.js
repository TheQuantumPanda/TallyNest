import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { jwtSecretSchema } from '../src/config/env.js';
import { ipTag } from '../src/middleware/proxy-ip-diagnostic.middleware.js';

// stdin from a private file; no credentials/IPs in command arguments or output.
try {
  const { token, ip } = z
    .object({ token: jwtSecretSchema, ip: z.string().max(64) })
    .strict()
    .parse(JSON.parse(readFileSync(0, 'utf8')));
  const tag = ipTag(token, ip);
  if (!tag) throw new Error();
  console.log(tag);
} catch {
  console.error('Invalid private comparison input');
  process.exitCode = 1;
}
