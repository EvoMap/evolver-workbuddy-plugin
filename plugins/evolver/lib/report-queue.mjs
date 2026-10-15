import { withQueued } from './report-outbox.mjs';
import { deliverPending } from './reuse.mjs';
import { appendStateLine, readState, statePath, takeStateLines, withLock, writeState } from './state-file.mjs';

const MAX_DRAIN_ROUNDS = 5;

export const outboxPath = () => statePath('reports-outbox.json');
const queuePath = () => statePath('reports-queue.jsonl');

export function queueReports(queued) {
  for (const entry of queued) appendStateLine(queuePath(), entry);
}

// Hooks only append to the queue file; the one process holding the outbox lock
// owns reports-outbox.json, so concurrent sessions never overwrite each other.
export function drainOutbox(postReuseResult, clock = () => Date.now()) {
  return withLock('outbox', async (lock) => {
    const attempted = new Set();
    for (let round = 0; round < MAX_DRAIN_ROUNDS; round += 1) {
      const queued = takeStateLines(queuePath());
      const now = clock();
      const outbox = withQueued(readState(outboxPath(), {}), queued, now);
      writeState(outboxPath(), outbox);
      const due = Object.fromEntries(Object.entries(outbox).filter(([key]) => !attempted.has(key)));
      for (const key of Object.keys(due)) attempted.add(key);
      writeState(outboxPath(), { ...outbox, ...(await deliverPending(postReuseResult, due, now)) });
      lock.refresh();
      if (queued.length === 0) return;
    }
  });
}
