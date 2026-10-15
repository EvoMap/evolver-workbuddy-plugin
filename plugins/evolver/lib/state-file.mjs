import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const LOCK_STALE_MS = 2 * 60 * 1000;

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

export function takeStateLines(target) {
  const taken = `${target}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.taking`;
  try {
    fs.renameSync(target, taken);
  } catch {
    return [];
  }
  const text = fs.readFileSync(taken, 'utf8');
  fs.rmSync(taken, { force: true });
  return text.split('\n').flatMap((line) => {
    try {
      return line ? [JSON.parse(line)] : [];
    } catch {
      return [];
    }
  });
}

function isStale(lockDir, now) {
  try {
    return now - fs.statSync(lockDir).mtimeMs > LOCK_STALE_MS;
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
  return {
    refresh: () => fs.utimesSync(lockDir, new Date(), new Date()),
    release: () => fs.rmSync(lockDir, { recursive: true, force: true }),
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
