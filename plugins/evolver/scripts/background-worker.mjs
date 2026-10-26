#!/usr/bin/env node
import { DISTILL_TASK, DRAIN_TASK, ENGINE_TASK } from '../lib/background.mjs';
import { createDistiller } from '../lib/distiller.mjs';
import { setUpEngine } from '../lib/engine-job.mjs';
import { engineRuntime } from '../lib/engine-runtime.mjs';
import { headlessModel } from '../lib/headless-model.mjs';
import { postReuseResult, proxyFetch } from '../lib/proxy-client.mjs';
import { drainOutbox } from '../lib/report-queue.mjs';
import { pruneOldSessions } from '../lib/session-state.mjs';

async function ranCleanly(work) {
  try {
    await work();
    return true;
  } catch {
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
if (tasks.has(DISTILL_TASK)) results.push(await ranCleanly(() => createDistiller({ proxyFetch, complete: headlessModel() }).distillLeftovers()));
process.exit(results.every(Boolean) ? 0 : 1);
