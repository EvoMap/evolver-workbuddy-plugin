import { spawn } from 'node:child_process';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const WORKER = fileURLToPath(new URL('../scripts/background-worker.mjs', import.meta.url));

export const ENGINE_TASK = 'engine';
export const DRAIN_TASK = 'drain';

// Hooks run under a timeout, so slow work (npm install, starting the Proxy,
// posting reports) runs in a detached child that outlives the hook process.
export function startInBackground(tasks) {
  if (tasks.length === 0) return;
  const child = spawn(process.execPath, [WORKER, ...tasks], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
    cwd: os.homedir(),
  });
  child.unref();
}
