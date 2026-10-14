#!/usr/bin/env node
import { DRAIN_TASK, ENGINE_TASK } from '../lib/background.mjs';
import { setUpEngine } from '../lib/engine-job.mjs';
import { engineRuntime } from '../lib/engine-runtime.mjs';
import { postReuseResult } from '../lib/proxy-client.mjs';
import { drainOutbox } from '../lib/report-queue.mjs';
import { pruneOldSessions } from '../lib/session-state.mjs';

const tasks = new Set(process.argv.slice(2));
try {
  if (tasks.has(ENGINE_TASK)) {
    pruneOldSessions();
    await setUpEngine(engineRuntime());
  }
  if (tasks.has(DRAIN_TASK)) await drainOutbox(postReuseResult);
} finally {
  process.exit(0);
}
