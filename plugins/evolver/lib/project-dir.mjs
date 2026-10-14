import fs from 'node:fs';
import path from 'node:path';

function realPath(dir) {
  try {
    return fs.realpathSync(dir);
  } catch {
    return dir;
  }
}

export function projectDirOf(input) {
  const candidate = [process.env.CODEBUDDY_PROJECT_DIR, input?.cwd].find((dir) => typeof dir === 'string' && dir.length > 0);
  return realPath(candidate ?? process.cwd());
}

export function resolvedPath(input, file) {
  return path.resolve(typeof input?.cwd === 'string' && input.cwd ? input.cwd : projectDirOf(input), file);
}
