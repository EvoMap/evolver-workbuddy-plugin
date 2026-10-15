import { UNKNOWN } from './applied.mjs';
import { checkEvidenceOf } from './checks.mjs';
import { REJECTED, RETRY, SENT, isSettled, withAttempt } from './report-outbox.mjs';

const LABEL_OUTCOMES = { correction: 'failed', praise: 'success' };
const RETENTION_OUTCOMES = { kept: 'success', reverted: 'failed' };
const UNKNOWN_APPLIED_AS = 'partial';
const RECEIPT_FIELDS = ['recorded', 'eligible', 'counted', 'weight', 'reason'];

export function turnTaskId(sessionId, turn) {
  return `workbuddy:${sessionId || 'unknown'}:${turn ?? 'unknown'}`;
}

export function immediateEvidenceOf({ checks, applied }) {
  const check = checkEvidenceOf(checks);
  const isKnown = applied !== UNKNOWN;
  return {
    tier: check && isKnown ? 'L1' : 'none',
    applied: isKnown ? applied : UNKNOWN_APPLIED_AS,
    ...(check && { check }),
    stage: 'immediate',
  };
}

function immediateOutcomeOf(evidence, answered) {
  if (evidence.check) return evidence.check.passed ? 'success' : 'failed';
  return answered ? 'success' : 'failed';
}

function checkPhrase(check) {
  if (!check) return 'no check ran';
  const result = check.passed ? 'passed' : 'failed';
  return `last ${check.kind} ${result}${check.fail_then_pass ? ' after failing earlier' : ''}`;
}

function reportOf({ assetId, taskId, outcome, reason, evidence }) {
  return { asset_id: assetId, outcome, task_id: taskId, reason, evidence };
}

export function immediateReportOf({ assetId, sessionId, turn, answered, checks, applied }) {
  const evidence = immediateEvidenceOf({ checks, applied });
  const ending = answered ? '' : '; the turn left no answer';
  return reportOf({
    assetId,
    taskId: turnTaskId(sessionId, turn),
    outcome: immediateOutcomeOf(evidence, answered),
    reason: `Injected by Evolver into WorkBuddy turn ${turn}; applied: ${applied}; ${checkPhrase(evidence.check)}${ending}.`,
    evidence,
  });
}

export function reportedReuseOf(report) {
  return { assetId: report.asset_id, applied: report.evidence.applied, taskId: report.task_id };
}

export function correctionReportOf(reuse, label) {
  if (!LABEL_OUTCOMES[label]) return null;
  return reportOf({
    ...reuse,
    taskId: `${reuse.taskId}:correction`,
    outcome: LABEL_OUTCOMES[label],
    reason: `The person's next prompt read as ${label} of the turn that reused this strategy.`,
    evidence: { tier: 'L3', applied: reuse.applied, stage: 'correction' },
  });
}

export function retentionReportOf(reuse, retentionClass) {
  if (!RETENTION_OUTCOMES[retentionClass]) return null;
  return reportOf({
    ...reuse,
    taskId: `${reuse.taskId}:retention`,
    outcome: RETENTION_OUTCOMES[retentionClass],
    reason: `By the next session the files the turn edited were ${retentionClass}.`,
    evidence: { tier: 'L2', applied: reuse.applied, stage: 'retention' },
  });
}

const REJECTED_BY_HUB = /^hub (?:400|422)\b/;
const PROXY_REFUSED_REQUEST = 400;
const SERVER_ERROR = 500;

function receiptOf(data) {
  return Object.fromEntries(RECEIPT_FIELDS.filter((field) => data?.[field] !== undefined).map((field) => [field, data[field]]));
}

function rejectionOf(reason, status) {
  return { verdict: REJECTED, reason: String(reason ?? 'rejected'), ...(status !== undefined && { status }) };
}

function isTaken(data) {
  return data?.recorded === true || data?.reason === 'duplicate_report';
}

export function deliveryOf(answer) {
  const data = answer?.data;
  const status = data?.status ?? answer?.status;
  if (data?.terminal === true && !(status >= SERVER_ERROR)) return rejectionOf(data.reason ?? data.error, status);
  if (answer?.status === PROXY_REFUSED_REQUEST && data?.recorded === false) return rejectionOf(data.error ?? 'proxy_rejected', PROXY_REFUSED_REQUEST);
  if (answer?.ok !== true) return { verdict: RETRY };
  if (REJECTED_BY_HUB.test(String(data?.reason ?? ''))) return rejectionOf(data.reason, data.status);
  return isTaken(data) ? { verdict: SENT, receipt: receiptOf(data) } : { verdict: RETRY };
}

async function postReport(postReuseResult, report) {
  try {
    return deliveryOf(await postReuseResult(report));
  } catch {
    return { verdict: RETRY };
  }
}

export async function deliverPending(postReuseResult, outbox, now, afterAttempt = () => {}) {
  let delivered = outbox;
  for (const [key, entry] of Object.entries(outbox)) {
    if (isSettled(entry)) continue;
    delivered = withAttempt(delivered, key, await postReport(postReuseResult, entry.report), now);
    afterAttempt();
  }
  return delivered;
}
