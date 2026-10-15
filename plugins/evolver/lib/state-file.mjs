import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const LOCK_STALE_MS = 2 * 60 * 1000;
const CLAIM_STALE_MS = 60 * 1000;

export function stateDir() {
  return process.env.CODEBUDDY_PLUGIN_DATA || path.join(os.homedir(), '.evolver', 'workbuddy-hooks');
}

export function statePath(name) {
  return path.join(stateDir(), name);
}

export function sessionStatePath(prefix, sessionId, extension = 'json') {
  const digest = crypto.createHash('sha256').update(String(sessionId)).digest('hex').slice(0, 16);
  return statePath(`${prefix}-${digest}.${extension}`);
}

export function readState(target, fallback) {
  try {
    const parsed = JSON.parse(fs.readFileSync(target, 'utf8'));
    return parsed && typeof parsed === 'object' && Array.isArray(parsed) === Array.isArray(fallback) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

export function writeState(target, value) {
  fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
  const temporary = `${target}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(value), { mode: 0o600, flag: 'wx' });
  try {
    fs.renameSync(temporary, target);
  } catch (error) {
    if (!['EEXIST', 'EPERM'].includes(error?.code)) throw error;
    fs.rmSync(target, { force: true });
    fs.renameSync(temporary, target);
  }
}

export function removeState(target) {
  fs.rmSync(target, { force: true });
}

export function appendStateLine(target, value) {
  fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
  fs.appendFileSync(target, `${JSON.stringify(value)}\n`, { mode: 0o600 });
}

function linesOf(file) {
  return fs.readFileSync(file, 'utf8').split('\n').flatMap((line) => {
    try {
      return line ? [JSON.parse(line)] : [];
    } catch {
      return [];
    }
  });
}

function staleClaimsOf(target, now) {
  const prefix = `${path.basename(target)}.`;
  try {
    return fs.readdirSync(path.dirname(target))
      .filter((name) => name.startsWith(prefix) && name.endsWith('.taking'))
      .map((name) => path.join(path.dirname(target), name))
      .filter((file) => now - fs.statSync(file).mtimeMs > CLAIM_STALE_MS);
  } catch {
    return [];
  }
}

function claimed(source, target) {
  const claim = `${target}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.taking`;
  try {
    fs.renameSync(source, claim);
    fs.utimesSync(claim, new Date(), new Date());
    return claim;
  } catch {
    return null;
  }
}

// Lines move into a claim file that is deleted only on commit, so a process
// that dies between taking and persisting them leaves the claim behind for
// the next taker to pick up once it is stale.
export function takeStateLines(target, now = Date.now()) {
  const claims = [...staleClaimsOf(target, now), target].map((source) => claimed(source, target)).filter(Boolean);
  return {
    lines: claims.flatMap(linesOf),
    commit: () => {
      for (const claim of claims) fs.rmSync(claim, { force: true });
    },
  };
}

function isStale(lockDir, now) {
  try {
    return now - fs.statSync(lockDir).mtimeMs > LOCK_STALE_MS;
  } catch {
    return false;
  }
}

function ownsLock(lockDir, token) {
  try {
    return fs.readFileSync(path.join(lockDir, 'owner'), 'utf8') === token;
  } catch {
    return false;
  }
}

export function tryLock(name, now = Date.now()) {
  const lockDir = statePath(`${name}.lock`);
  fs.mkdirSync(path.dirname(lockDir), { recursive: true, mode: 0o700 });
  if (isStale(lockDir, now)) fs.rmSync(lockDir, { recursive: true, force: true });
  try {
    fs.mkdirSync(lockDir);
  } catch {
    return null;
  }
  const token = crypto.randomBytes(12).toString('hex');
  fs.writeFileSync(path.join(lockDir, 'owner'), token);
  return {
    refresh: () => {
      if (ownsLock(lockDir, token)) fs.utimesSync(lockDir, new Date(), new Date());
    },
    release: () => {
      if (ownsLock(lockDir, token)) fs.rmSync(lockDir, { recursive: true, force: true });
    },
  };
}

export async function withLock(name, work) {
  const lock = tryLock(name);
  if (!lock) return false;
  try {
    await work(lock);
    return true;
  } finally {
    lock.release();
  }
}
