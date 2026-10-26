import { DRAIN_TASK, startInBackground } from './background.mjs';
import { isEvolverCommand } from './command-turn.mjs';
import { takeUnreported } from './injected-ledger.mjs';
import { projectDirOf } from './project-dir.mjs';
import { queueReports } from './report-queue.mjs';
import { rememberForRetention } from './retention-pending.mjs';
import { immediateReportOf, reportedReuseOf } from './reuse.mjs';
import { candidateOf, modelOf, rememberCandidate, skipReason } from './session-distill.mjs';
import { readSession, takeFilesBefore, updateSession } from './session-state.mjs';
import { turnActivityOf, turnRecordsSince } from './transcript.mjs';

const ABORTED_RECORD = { checks: [], answer: '' };

export function isMainSession(input) {
  return typeof input.session_id === 'string' && Boolean(input.session_id) && !input.agent_id;
}

function reportsOf(assets, { sessionId, turn, reasonKind, record }) {
  return assets.map((asset) => immediateReportOf({
    asset,
    sessionId,
    turn: turn ?? asset.turn,
    reasonKind,
    answered: record.answer.length > 0,
    checks: record.checks,
  }));
}

export function abortedReports(assets) {
  return assets.map((asset) => ({
    report: reportsOf([asset], { sessionId: asset.sessionId, reasonKind: 'aborted', record: ABORTED_RECORD })[0],
    sessionId: asset.sessionId,
  }));
}

function rememberTurnCandidate(sessionId, session, { reasonKind, finished, records }) {
  if (isEvolverCommand(session.prompt) || skipReason(reasonKind, finished)) return;
  rememberCandidate(sessionId, candidateOf({ prompt: session.prompt, record: finished, model: modelOf(records), turn: session.turn }));
}

/**
 * Every injected strategy is reported when its turn ends, with the turn's own evidence; the turn itself
 * becomes this session's distillation candidate when it finished verified.
 */
export function closeTurn(input, reasonKind) {
  const sessionId = input.session_id;
  const { editedBefore, commit } = takeFilesBefore(sessionId);
  const session = readSession(sessionId);
  const records = turnRecordsSince(input.transcript_path, session.turnStart);
  const finished = turnActivityOf(records);
  const reports = reportsOf(takeUnreported(sessionId, session.turn), { sessionId, turn: session.turn, reasonKind, record: finished });
  const reuses = reports.map(reportedReuseOf);
  queueReports(reports.map((report) => ({ report, sessionId })));
  if (reports.length > 0) {
    updateSession(sessionId, (latest) => ({ ...latest, labelable: reuses }));
    rememberForRetention({ sessionId, projectDir: projectDirOf(input), reuses, editedBefore });
  }
  commit();
  rememberTurnCandidate(sessionId, session, { reasonKind, finished, records });
  if (reports.length > 0) startInBackground([DRAIN_TASK]);
}
