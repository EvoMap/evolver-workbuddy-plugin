#!/usr/bin/env node
import { DRAIN_TASK, ENGINE_TASK } from '../lib/background.mjs';
import { setUpEngine } from '../lib/engine-job.mjs';
import { engineRuntime } from '../lib/engine-runtime.mjs';
import { postReuseResult } from '../lib/proxy-client.mjs';
import { drainOutbox } from '../lib/report-queue.mjs';
import { pruneOldSessions } from '../lib/session-state.mjs';

async function ranCleanly(work) {
  try {
    await work();
    return true;
  } catch (error) {
    process.stderr.write(`${error?.stack ?? error}\n`);
    return false;
  }
}

const tasks = new Set(process.argv.slice(2));
const results = [];
if (tasks.has(ENGINE_TASK)) {
  results.push(await ranCleanly(() => {
    pruneOldSessions();
    return setUpEngine(engineRuntime());
  }));
}
if (tasks.has(DRAIN_TASK)) results.push(await ranCleanly(() => drainOutbox(postReuseResult)));
process.exit(results.every(Boolean) ? 0 : 1);
