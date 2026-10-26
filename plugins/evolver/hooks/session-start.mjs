#!/usr/bin/env node
import { DISTILL_TASK, DRAIN_TASK, ENGINE_TASK, startInBackground } from '../lib/background.mjs';
import { engineNoticeOf } from '../lib/engine-notice.mjs';
import { isSetupDue } from '../lib/engine-setup.mjs';
import { isAnnounced, markAnnounced, readEngineState } from '../lib/engine-state.mjs';
import { meetsMinimum } from '../lib/engine-version.mjs';
import { runHook } from '../lib/hook-io.mjs';
import { takeOrphanedUnreported } from '../lib/injected-ledger.mjs';
import { projectDirOf } from '../lib/project-dir.mjs';
import { proxyConnection, proxyStatus } from '../lib/proxy-client.mjs';
import { queueReports } from '../lib/report-queue.mjs';
import { retentionReportsOf, takeDueRetentions } from '../lib/retention-pending.mjs';
import { migrateLegacyCandidates } from '../lib/session-distill.mjs';
import { abortedReports } from '../lib/turn-end.mjs';

function queueRetentionReports(sessionId, projectDir) {
  if (!sessionId) return;
  const { due, commit } = takeDueRetentions({ sessionId, projectDir });
  queueReports(due.flatMap(retentionReportsOf));
  commit();
}

// Like dsh's once-per-process setup notice: each setup outcome reaches the model at one session start only.
function engineNote(outcome) {
  if (!outcome || isAnnounced(outcome)) return null;
  markAnnounced(outcome);
  return engineNoticeOf(outcome);
}

// Nothing of Evolver but the recalled steps and a one-off engine notice enters the model's context; the
// reports of a killed session and its leftover candidate are handled here, outside the conversation.
async function sessionContext(input) {
  const connection = proxyConnection();
  const isRunning = Boolean(await proxyStatus(connection));
  const outcome = readEngineState();
  const needsEngine = !isRunning || !meetsMinimum(connection.version);
  const isStarting = needsEngine && isSetupDue(outcome, Date.now());

  migrateLegacyCandidates();
  queueRetentionReports(input.session_id, projectDirOf(input));
  queueReports(abortedReports(takeOrphanedUnreported()));
  startInBackground([...(isStarting ? [ENGINE_TASK] : []), DRAIN_TASK, DISTILL_TASK]);

  return engineNote(outcome) ?? '';
}

runHook('SessionStart', sessionContext);
