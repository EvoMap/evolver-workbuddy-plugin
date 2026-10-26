import { spawnSync } from 'node:child_process';

const SHELLS = new Set(['sh', 'bash', 'zsh', 'dash', 'ksh', 'fish']);
const PS_TIMEOUT_MS = 1000;

/**
 * Whether the process that wrote a state entry has exited. Signal 0 only probes: ESRCH means no such
 * process; EPERM means it exists under another user. An entry without a pid (written by an older version)
 * is never taken for a dead owner's.
 */
export function ownerIsGone(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  if (pid === process.pid) return false;
  try {
    process.kill(pid, 0);
    return false;
  } catch (error) {
    return error?.code === 'ESRCH';
  }
}

function processInfo(pid) {
  const probe = spawnSync('ps', ['-o', 'ppid=,comm=', '-p', String(pid)], { encoding: 'utf8', timeout: PS_TIMEOUT_MS });
  const match = /^\s*(\d+)\s+(.+?)\s*$/.exec(probe.stdout ?? '');
  return match ? { ppid: Number(match[1]), name: match[2].split('/').pop().replace(/^-/, '') } : null;
}

/**
 * The CodeBuddy process that runs this hook, which outlives the hook the way the dsh process outlives a turn.
 * The host starts each hook through `$SHELL -c`; most shells exec a lone command, but when one stays in
 * between, its parent is the host. Windows has no cheap probe, so its entries carry no owner and are never
 * taken for a killed session's.
 */
export function hostPid() {
  if (process.platform === 'win32') return undefined;
  const parent = processInfo(process.ppid);
  if (!parent) return undefined;
  return SHELLS.has(parent.name) ? parent.ppid : process.ppid;
}
