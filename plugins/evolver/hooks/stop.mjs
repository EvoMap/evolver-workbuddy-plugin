#!/usr/bin/env node
import { appliedVerdictOf } from '../lib/applied.mjs';
import { DRAIN_TASK, startInBackground } from '../lib/background.mjs';
import { runHook } from '../lib/hook-io.mjs';
import { unreportedAssets, withReported } from '../lib/injected-ledger.mjs';
import { projectDirOf } from '../lib/project-dir.mjs';
import { queueReports } from '../lib/report-queue.mjs';
import { rememberForRetention } from '../lib/retention-pending.mjs';
import { immediateReportOf, reportedReuseOf } from '../lib/reuse.mjs';
import { readSession, takeFilesBefore, writeSession } from '../lib/session-state.mjs';
import { turnActivityOf, turnRecordsSince } from '../lib/transcript.mjs';

function finishedTurnOf(input, session) {
  const activity = turnActivityOf(turnRecordsSince(input.transcript_path, session.turnStart));
  const fallbackAnswer = typeof input.last_assistant_message === 'string' ? input.last_assistant_message.trim() : '';
  return { ...activity, answer: activity.answer || fallbackAnswer };
}

function reportsOf(sessionId, session, turn) {
  return unreportedAssets(session.injected, session.turn).map((asset) => immediateReportOf({
    assetId: asset.assetId,
    sessionId,
    turn: session.turn,
    answered: turn.answer.length > 0,
    checks: turn.checks,
    applied: appliedVerdictOf({ strategyText: asset.strategyText, ...turn }).verdict
  }));
}

function closeTurn(input) {
  const sessionId = input.session_id;
  const { editedBefore, commit } = takeFilesBefore(sessionId);
  const session = readSession(sessionId);
  const reports = reportsOf(sessionId, session, finishedTurnOf(input, session));
  if (reports.length === 0) return commit();

  const reuses = reports.map(reportedReuseOf);
  queueReports(reports.map((report) => ({ report, sessionId })));
  const injected = withReported(session.injected, reports.map((report) => report.asset_id), Date.now());
  writeSession(sessionId, { ...session, injected, labelable: reuses });
  rememberForRetention({ sessionId, projectDir: projectDirOf(input), reuses, editedBefore });
  commit();
  startInBackground([DRAIN_TASK]);
}

runHook('Stop', (input) => {
  if (typeof input.session_id === 'string' && input.session_id && !input.agent_id) closeTurn(input);
  return '';
});
