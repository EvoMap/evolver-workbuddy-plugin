import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { eitherSignal } from './abort-signal.mjs';
import { hostPid, ownerIsGone } from './process-owner.mjs';
import { withoutSecrets } from './redact.mjs';
import { readState, removeState, statePath, updateState } from './state-file.mjs';

// Distillation runs once a session, at its end, and outside the agent's conversation: each turn that
// finished verified only leaves a candidate on disk, the latest one wins, and the session end (or, after a
// session that was killed, the next session start) turns it into a Gene with one model call over a digest of
// the turn — never the whole history, which cost ten times as much for fewer usable Genes in the benchmark.
// A candidate leaves the disk only once distilled or given up after MAX_ATTEMPTS failed tries; a try that
// failed is claimed again by the next session that starts.

const PROMPT_MAX_CHARS = 6_000;
const ANSWER_MAX_CHARS = 3_000;
const COMMAND_MAX_CHARS = 300;
const MAX_COMMANDS = 40;
const LIST_FIELDS = ['strategy', 'validation', 'signals', 'preconditions'];
const ARGUMENT_FIELDS = ['title', 'summary', ...LIST_FIELDS];
const ITEM_NUMBER = /^\s*(?:\d+[.)]|[-*•])\s+/;
const MAX_ATTEMPTS = 3;

const PENDING_FILE = 'workbuddy-distill-pending.json';
// In the plugin data folder, which WorkBuddy's sandbox lets commands write, unlike ~/.evolver; the name keeps
// it apart from other hosts' candidates, whose sessions run on another model.
const pendingPath = () => statePath(PENDING_FILE);
const legacyPendingPath = () => path.join(os.homedir(), '.evolver', 'state', PENDING_FILE);

/** Moves candidates an earlier build left in ~/.evolver/state into the plugin data folder; newer ones win. */
export function migrateLegacyCandidates(legacy = legacyPendingPath()) {
  if (!fs.existsSync(legacy)) return;
  const moved = readState(legacy, {});
  updateState(pendingPath(), {}, (pending) => ({ ...moved, ...pending }));
  removeState(legacy);
}

const MIN_COMMANDS_WITHOUT_EDITS = 3;

/**
 * Why a finished turn leaves no candidate, or null when it does. Only work worth a Gene qualifies: a turn
 * proved by a check (test, lint, typecheck or build) that passed last, which changed files or ran a few
 * commands. Small talk, a lookup or a one-off command proves no method. A turn that reused an injected
 * strategy is distilled too: the engine's intake drops a Gene that repeats one it already has.
 */
export function skipReason(reasonKind, record) {
  if (reasonKind !== 'completed') return 'not_completed';
  if (!record.answer) return 'no_answer';
  const lastCheck = record.checks.at(-1);
  if (!lastCheck) return 'unverified';
  if (lastCheck.failed) return 'failed_check';
  if (record.edits.length === 0 && record.commands.length < MIN_COMMANDS_WITHOUT_EDITS) return 'too_little_work';
  return null;
}

/** The model behind the turn's latest assistant message in the transcript: the distillation runs on it. */
export function modelOf(records) {
  const providerData = records.findLast((record) => record.type === 'message' && record.role === 'assistant')?.providerData;
  const model = providerData?.requestModelId || providerData?.model;
  return typeof model === 'string' && model ? { model } : null;
}

// Keys and tokens are stripped before anything is written to disk or sent to a model or the Proxy.
export function candidateOf({ prompt, record, model, turn, pid = hostPid(), now = Date.now() }) {
  return {
    prompt: withoutSecrets(String(prompt ?? '')).slice(0, PROMPT_MAX_CHARS),
    commands: record.commands.slice(-MAX_COMMANDS).map((command) => withoutSecrets(command).slice(0, COMMAND_MAX_CHARS)),
    paths: [...new Set(record.paths)].map((path) => withoutSecrets(path)),
    checks: record.checks.map(({ command, failed }) => ({ command: withoutSecrets(command), failed })),
    answer: withoutSecrets(record.answer).slice(0, ANSWER_MAX_CHARS),
    model,
    turn,
    pid,
    attempts: 0,
    at: now,
  };
}

export function rememberCandidate(sessionId, candidate) {
  if (!sessionId) return;
  updateState(pendingPath(), {}, (pending) => ({ ...pending, [sessionId]: candidate }));
}

export function dropCandidate(sessionId) {
  if (!sessionId) return;
  updateState(pendingPath(), {}, (pending) => {
    if (!(sessionId in pending)) return undefined;
    const { [sessionId]: dropped, ...rest } = pending;
    return rest;
  });
}

/** Whether this is still the session's candidate on disk: not dropped by a correction, nor replaced by a newer one. */
export function isCurrentCandidate(sessionId, candidate) {
  return readState(pendingPath(), {})[sessionId]?.at === candidate.at;
}

/** A session that ended keeps its candidate due, so a distillation that failed at its end is tried again. */
export function closeCandidate(sessionId) {
  if (!sessionId) return;
  updateState(pendingPath(), {}, (pending) => (pending[sessionId]
    ? { ...pending, [sessionId]: { ...pending[sessionId], closed: true } }
    : undefined));
}

// A candidate is up for distillation again once its session is over and no live process is working on it.
function leftover(candidate, isGone) {
  const over = Boolean(candidate?.closed) || isGone(candidate?.pid);
  return over && (!candidate?.claimedBy || isGone(candidate.claimedBy));
}

/** This session's own candidate, if it has one. Left on disk until settled. */
export function dueCandidates({ sessionId }) {
  const candidate = readState(pendingPath(), {})[sessionId];
  return candidate ? [{ sessionId, candidate }] : [];
}

/**
 * This session's own candidate, claimed for this process under the state lock; null when there is none or a
 * live process already distills it. Each hook and command is its own process here, so the claim on disk is
 * what keeps one distillation per session at a time.
 */
export function claimCandidate(sessionId, { isGone = ownerIsGone, pid = process.pid } = {}) {
  let claimed = null;
  updateState(pendingPath(), {}, (pending) => {
    const candidate = pending[sessionId];
    if (!candidate || (candidate.claimedBy && candidate.claimedBy !== pid && !isGone(candidate.claimedBy))) return undefined;
    claimed = { sessionId, candidate: { ...candidate, claimedBy: pid } };
    return { ...pending, [sessionId]: claimed.candidate };
  });
  return claimed;
}

/**
 * The candidates of sessions that are over — ended, or killed with their process — claimed for this process
 * under the state lock, so two hosts starting at once cannot distill the same one twice. An idle session
 * whose process still runs keeps its candidate however long it waits.
 */
export function claimLeftoverCandidates({ isGone = ownerIsGone, pid = process.pid } = {}) {
  const claimed = [];
  updateState(pendingPath(), {}, (pending) => {
    const next = { ...pending };
    for (const [sessionId, candidate] of Object.entries(pending)) {
      if (!leftover(candidate, isGone) || candidate.claimedBy === pid) continue;
      next[sessionId] = { ...candidate, claimedBy: pid };
      claimed.push({ sessionId, candidate: next[sessionId] });
    }
    return claimed.length > 0 ? next : undefined;
  });
  return claimed;
}

/**
 * Removes a candidate once it is `done` with, or counts a failed try and gives up after MAX_ATTEMPTS; a try
 * that is not `counted` only releases the claim. A newer candidate the session wrote meanwhile is left alone.
 */
export function settleCandidate(sessionId, candidate, { done, counted = true }) {
  updateState(pendingPath(), {}, (pending) => {
    const current = pending[sessionId];
    if (!current || current.at !== candidate.at) return undefined;
    const attempts = (current.attempts ?? 0) + (counted ? 1 : 0);
    if (done || attempts >= MAX_ATTEMPTS) {
      const { [sessionId]: settled, ...rest } = pending;
      return rest;
    }
    // The claim is released, so the next session start can try this candidate again.
    return { ...pending, [sessionId]: { ...current, attempts, claimedBy: null } };
  });
}

export function distillPrompt(candidate, focus = '') {
  const lines = (items, render) => items.map(render).join('\n') || '(none)';
  const focusText = withoutSecrets(String(focus ?? ''));
  return [
    'Below is the record of a task an agent has just finished and verified. Turn it into one reusable Gene:',
    'a method another agent could follow on a similar task, written for the kind of data or system involved,',
    'not for these files, names or values. Do not include the answer itself.',
    ...(focusText ? [`Focus on: ${focusText}`] : []),
    'Keep only knowledge dense enough to reuse. If the record shows routine steps, a lookup or small talk,',
    'with no method another agent would gain from, answer {"skip": "<why, in one sentence>"} instead.',
    'Otherwise answer with a JSON object only, with these fields:',
    '  title: short capability name',
    '  summary: what was solved and under which conditions',
    '  strategy: ordered, reproducible steps',
    '  validation: checks that proved the result',
    '  signals: keywords of the problem this generalizes to',
    '  preconditions: when the method applies',
    '',
    '## Task',
    candidate.prompt,
    '',
    '## Commands run',
    lines(candidate.commands, (command) => `- ${command}`),
    '',
    '## Files read or written',
    lines(candidate.paths, (path) => `- ${path}`),
    '',
    '## Checks',
    lines(candidate.checks, (check) => `- ${check.failed ? 'FAILED' : 'passed'}: ${check.command}`),
    '',
    '## Final answer',
    candidate.answer,
  ].join('\n');
}

// Models sometimes write a list field as one numbered paragraph ("1. … 2. …"), which the core reads as one step.
function listOf(value) {
  if (Array.isArray(value)) return value;
  if (typeof value !== 'string') return value;
  return value.split(/\n+|(?<=\.)\s+(?=\d+[.)]\s)/).map((item) => item.replace(ITEM_NUMBER, '').trim()).filter(Boolean);
}

function jsonObjectOf(text) {
  const match = String(text ?? '').match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]);
  } catch {
    return null;
  }
}

/** Why the model judged the turn not worth a Gene, or null when it wrote one. */
export function declineOf(text) {
  const skip = jsonObjectOf(text)?.skip;
  return typeof skip === 'string' && skip.trim() ? skip.trim() : null;
}

export function argumentsOf(text) {
  const parsed = jsonObjectOf(text);
  if (typeof parsed?.summary !== 'string' || !parsed.summary.trim()) return null;
  for (const field of LIST_FIELDS) if (field in parsed) parsed[field] = listOf(parsed[field]);
  return Object.fromEntries(ARGUMENT_FIELDS.filter((field) => parsed[field] !== undefined).map((field) => [field, parsed[field]]));
}

export function distillBody(candidate, args, usage) {
  return {
    platform: 'workbuddy',
    trigger: 'session_end',
    user_prompt: candidate.prompt,
    // The core rejects a Gene that repeats this answer's values (answer_leak).
    final_answer: candidate.answer,
    ...args,
    execution: { trace: candidate.checks.map((check) => ({ command: check.command, exit: check.failed ? 1 : 0 })) },
    persist: true,
    publish: false,
    // What this distillation itself cost, kept apart from the agent's own tokens.
    ...(usage ? { distill_usage: usage } : {}),
  };
}

/**
 * Distill one candidate through `complete(model, text, signal)`, the host's headless model. `cancel` stops it
 * and `isCurrent` is asked once more before anything is persisted, since the candidate may have been dropped
 * while the model answered. Resolves to what happened; never throws.
 */
export async function distillCandidate({ proxyFetch, complete, candidate, focus, timeoutMs, cancel, isCurrent = () => true }) {
  if (!complete || !candidate?.model) return { status: 'no_model' };
  const signal = eitherSignal([AbortSignal.timeout(timeoutMs), ...(cancel ? [cancel] : [])]);
  let reply;
  try {
    reply = await complete(candidate.model, distillPrompt(candidate, focus), signal);
  } catch (error) {
    return cancel?.aborted ? { status: 'dropped' } : { status: 'model_failed', error: String(error?.message ?? error) };
  }
  try {
    const { answer, usage } = reply;
    const declined = declineOf(answer);
    if (declined) return { status: 'declined', reason: declined, usage };
    const args = argumentsOf(answer);
    if (!args) return { status: 'unparsed', usage };
    if (cancel?.aborted || !isCurrent()) return { status: 'dropped', usage };
    const result = await proxyFetch('POST', '/conversation/distill', distillBody(candidate, args, usage), signal);
    return { ...storedOutcomeOf(result), usage };
  } catch (error) {
    if (cancel?.aborted) return { status: 'dropped' };
    return { status: 'failed', error: String(error?.message ?? error) };
  }
}

/**
 * What the Proxy did with a Gene. It answers `ok` with `status: 'draft'` when it would not store the Gene
 * (too weak for its quality gate, or a validation trace no host verifier confirmed): nothing was kept, and
 * sending it again gives the same answer.
 */
export function storedOutcomeOf(result) {
  if (!result?.ok) return { status: 'failed', error: String(result?.error) };
  return result.data?.status === 'draft' ? { status: 'draft', data: result.data } : { status: 'sent', data: result.data };
}

/** Whether a candidate is finished with: distilled, judged not worth a Gene, or refused for good by the Proxy. */
export function isSettled(outcome) {
  return ['sent', 'declined', 'draft'].includes(outcome?.status);
}

/** Whether the headless model, not the Proxy, kept a candidate from being distilled: the agent's own model can. */
export function needsAgentModel(outcome) {
  return ['no_model', 'model_failed', 'unparsed'].includes(outcome?.status);
}
