#!/usr/bin/env node
import { DISTILL_TASK, DRAIN_TASK, startInBackground } from '../lib/background.mjs';
import { runHook } from '../lib/hook-io.mjs';
import { takeUnreported } from '../lib/injected-ledger.mjs';
import { queueReports } from '../lib/report-queue.mjs';
import { closeCandidate } from '../lib/session-distill.mjs';
import { abortedReports, isMainSession } from '../lib/turn-end.mjs';

// The hook has seconds, the model call up to two minutes, so the candidate is closed here and distilled by
// the detached worker, which claims it as a leftover of a session that is over.
runHook('SessionEnd', (input) => {
  if (!isMainSession(input)) return '';
  queueReports(abortedReports(takeUnreported(input.session_id, Infinity)));
  closeCandidate(input.session_id);
  startInBackground([DRAIN_TASK, DISTILL_TASK]);
  return '';
});
