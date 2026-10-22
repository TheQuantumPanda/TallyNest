import { lstat, realpath } from 'node:fs/promises';
import { dirname, resolve, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../../../', import.meta.url));
export async function privatePath(path, existing = true) {
  if (!path || !isAbsolute(path)) throw new Error('OPERATOR_ABSOLUTE_PRIVATE_PATH_REQUIRED');
  const parent = await realpath(dirname(path));
  const inside = relative(root, parent);
  if (
    !inside ||
    (!inside.startsWith('..') && !isAbsolute(inside)) ||
    (await lstat(parent)).mode & 0o077
  )
    throw new Error('OPERATOR_PRIVATE_DIRECTORY_OUTSIDE_REPOSITORY_REQUIRED');
  const result = resolve(parent, path.split('/').at(-1));
  try {
    const stat = await lstat(result);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.mode & 0o077)
      throw new Error('OPERATOR_PRIVATE_FILE_REQUIRED');
  } catch (error) {
    if (existing || error.code !== 'ENOENT') throw error;
  }
  return result;
}
