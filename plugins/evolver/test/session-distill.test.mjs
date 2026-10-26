import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, test } from 'node:test';

import { takeOrphanedUnreported } from '../lib/injected-ledger.mjs';
import {
  argumentsOf, candidateOf, claimLeftoverCandidates, closeCandidate, distillCandidate, distillPrompt, dueCandidates,
  isCurrentCandidate, modelOf, rememberCandidate, settleCandidate, skipReason,
} from '../lib/session-distill.mjs';
import { sessionStatePath, writeState } from '../lib/state-file.mjs';

const MODEL = { model: 'glm-5' };
const GENE = { title: 'Retry uploads', summary: 'Retry a flaky upload with backoff.', strategy: '1. Measure. 2. Back off.', signals: ['retry'] };

let home;
let saved;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'evolver-distill-'));
  saved = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, CODEBUDDY_PLUGIN_DATA: process.env.CODEBUDDY_PLUGIN_DATA };
  Object.assign(process.env, { HOME: home, USERPROFILE: home, CODEBUDDY_PLUGIN_DATA: join(home, 'plugin-data') });
});

afterEach(() => {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  rmSync(home, { recursive: true, force: true });
});

function record(overrides = {}) {
  return { checks: [], commands: ['npm test'], paths: ['src/up.js'], edits: [], answer: 'Done: retries added.', ...overrides };
}

function fakeModel(fixed = JSON.stringify(GENE)) {
  const model = {
    calls: [],
    answer: undefined,
    hold: undefined,
    complete: async (chosen, text, signal) => {
      model.calls.push({ chosen, text });
      await model.hold;
      return { answer: model.answer ?? fixed, usage: { inputTokens: 900, outputTokens: 120 } };
    },
  };
  return model;
}

function deadPid() {
  const child = spawnSync(process.execPath, ['-e', 'process.stdout.write(String(process.pid))']);
  return Number(child.stdout.toString());
}

test('only a verified, completed turn that used tools and reused no strategy becomes a candidate', () => {
  assert.equal(skipReason('completed', record()), null);
  assert.equal(skipReason('aborted', record()), 'not_completed');
  assert.equal(skipReason('error', record()), 'not_completed');
  assert.equal(skipReason('completed', record({ answer: '' })), 'no_answer');
  assert.equal(skipReason('completed', record({ checks: [{ command: 'npm test', failed: true }] })), 'failed_check');
  assert.equal(skipReason('completed', record({ commands: [] })), 'no_tool_use');
  assert.equal(skipReason('completed', record({ commands: [], edits: ['x'] })), null);
  assert.equal(skipReason('completed', record(), { reusedAsset: true }), 'asset_reused');
});

test("the model is the one behind the turn's latest assistant message", () => {
  const assistant = (providerData) => ({ type: 'message', role: 'assistant', providerData, content: [] });
  assert.deepEqual(modelOf([assistant({ model: 'old' }), assistant({ model: 'glm-5' })]), { model: 'glm-5' });
  assert.deepEqual(modelOf([assistant({ model: 'routed', requestModelId: 'glm-5' })]), { model: 'glm-5' });
  assert.equal(modelOf([assistant({}), { type: 'message', role: 'user' }]), null);
  assert.equal(modelOf([]), null);
});

test('the prompt is a digest of the turn, never its whole history, and asks for no answer values', () => {
  const candidate = candidateOf({ prompt: 'add a retry to the uploader', record: record({ checks: [{ command: 'npm test', failed: false }] }), model: MODEL, turn: 1 });
  const prompt = distillPrompt(candidate, 'the backoff');
  assert.match(prompt, /## Task\nadd a retry to the uploader/);
  assert.match(prompt, /- npm test/);
  assert.match(prompt, /- passed: npm test/);
  assert.match(prompt, /Focus on: the backoff/);
  assert.match(prompt, /Do not include the answer itself/);
});

test('a list the model wrote as one numbered paragraph becomes steps', () => {
  assert.deepEqual(argumentsOf(JSON.stringify(GENE)).strategy, ['Measure.', 'Back off.']);
  assert.equal(argumentsOf('no json here'), null);
  assert.equal(argumentsOf('{"title":"no summary"}'), null);
});

test('a candidate is distilled through the host model and sent to the Proxy with its own cost', async () => {
  const sent = [];
  const proxyFetch = async (method, path, body) => { sent.push({ path, body }); return { ok: true, data: { id: 'gene_x' } }; };
  const candidate = candidateOf({ prompt: 'add a retry', record: record(), model: MODEL, turn: 1 });
  const model = fakeModel();
  const outcome = await distillCandidate({ proxyFetch, complete: model.complete, candidate, timeoutMs: 1_000 });

  assert.equal(outcome.status, 'sent');
  assert.deepEqual(model.calls[0].chosen, MODEL);
  assert.equal(sent[0].path, '/conversation/distill');
  assert.equal(sent[0].body.platform, 'workbuddy');
  assert.equal(sent[0].body.trigger, 'session_end');
  assert.equal(sent[0].body.persist, true);
  assert.equal(sent[0].body.publish, false);
  assert.deepEqual(sent[0].body.distill_usage, { inputTokens: 900, outputTokens: 120 });
  assert.equal((await distillCandidate({ proxyFetch, complete: model.complete, candidate: { ...candidate, model: null }, timeoutMs: 1_000 })).status, 'no_model');
  assert.equal((await distillCandidate({ proxyFetch, complete: null, candidate, timeoutMs: 1_000 })).status, 'no_model');
});

test('an answer that is no Gene, or a model that fails, keeps nothing from reaching the Proxy', async () => {
  const sent = [];
  const proxyFetch = async (method, path) => { sent.push(path); return { ok: true }; };
  const candidate = candidateOf({ prompt: 'add a retry', record: record(), model: MODEL, turn: 1 });
  assert.equal((await distillCandidate({ proxyFetch, complete: fakeModel('not json').complete, candidate, timeoutMs: 1_000 })).status, 'unparsed');
  const broken = async () => { throw new Error('codebuddy gave no answer: Authentication required'); };
  const failed = await distillCandidate({ proxyFetch, complete: broken, candidate, timeoutMs: 1_000 });
  assert.equal(failed.status, 'model_failed');
  assert.match(failed.error, /Authentication required/);
  assert.deepEqual(sent, []);
});

test('a candidate dropped or cancelled while the model answers is never sent to the Proxy', async () => {
  const sent = [];
  const proxyFetch = async (method, path) => { sent.push(path); return { ok: true }; };
  const candidate = candidateOf({ prompt: 'add a retry', record: record(), model: MODEL, turn: 1 });
  rememberCandidate('s', candidate);
  assert.equal(isCurrentCandidate('s', candidate), true);
  rememberCandidate('s', { ...candidate, at: candidate.at + 1 });
  assert.equal(isCurrentCandidate('s', candidate), false);

  const replaced = await distillCandidate({ proxyFetch, complete: fakeModel().complete, candidate, timeoutMs: 1_000, isCurrent: () => isCurrentCandidate('s', candidate) });
  const controller = new AbortController();
  const model = fakeModel();
  model.hold = new Promise((resolve) => setTimeout(resolve, 20));
  const cancelled = distillCandidate({ proxyFetch, complete: model.complete, candidate, timeoutMs: 1_000, cancel: controller.signal });
  controller.abort();
  const interrupted = new AbortController();
  const aborting = async (chosen, text, signal) => new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(new Error('aborted'))));
  const killed = distillCandidate({ proxyFetch, complete: aborting, candidate, timeoutMs: 1_000, cancel: interrupted.signal });
  interrupted.abort();

  assert.equal(replaced.status, 'dropped');
  assert.equal((await cancelled).status, 'dropped');
  assert.equal((await killed).status, 'dropped', 'a cancelled call that comes back without an answer');
  assert.deepEqual(sent, []);
});

test("a session's candidate is due to it; another session's only once that session is over", () => {
  rememberCandidate('live', { pid: 111, at: 1 });
  rememberCandidate('killed', { pid: 222, at: 2 });
  rememberCandidate('ended', { pid: 111, at: 3 });
  closeCandidate('ended');
  const isGone = (pid) => pid === 222;
  assert.deepEqual(dueCandidates({ sessionId: 'live' }).map((due) => due.sessionId), ['live']);
  assert.deepEqual(claimLeftoverCandidates({ isGone, pid: 7 }).map((due) => due.sessionId), ['killed', 'ended']);
});

test('a leftover candidate is claimed by one process only, and again once the claim dies', () => {
  const isGone = (pid) => pid !== 111;
  rememberCandidate('killed', { pid: 222, at: 1 });

  assert.deepEqual(claimLeftoverCandidates({ isGone, pid: 111 }).map((due) => due.sessionId), ['killed']);
  assert.deepEqual(claimLeftoverCandidates({ isGone, pid: 333 }), [], 'a live claim is left alone');
  settleCandidate('killed', { at: 1 }, { sent: false });
  assert.deepEqual(claimLeftoverCandidates({ isGone, pid: 333 }).map((due) => due.candidate.attempts), [1], 'a failed try is claimable again');
});

test('a candidate leaves the disk only once distilled, or after three failed tries', () => {
  const candidate = { pid: process.pid, at: 5, attempts: 0 };
  rememberCandidate('s', candidate);
  settleCandidate('s', candidate, { sent: false });
  settleCandidate('s', candidate, { sent: false });
  assert.equal(dueCandidates({ sessionId: 's' })[0].candidate.attempts, 2, 'kept for a retry');
  settleCandidate('s', candidate, { sent: false });
  assert.deepEqual(dueCandidates({ sessionId: 's' }), [], 'given up');

  rememberCandidate('s', candidate);
  rememberCandidate('s', { ...candidate, at: 9 });
  settleCandidate('s', candidate, { sent: true });
  assert.equal(dueCandidates({ sessionId: 's' })[0].candidate.at, 9, 'a newer candidate written meanwhile stays');
});

test('keys and tokens never reach the candidate, nor the prompt a manual focus writes', () => {
  const secret = 'sk-evomap-0123456789abcdef0123456789abcdef';
  const candidate = candidateOf({
    prompt: `use ${secret}`, model: MODEL, turn: 1,
    record: record({ commands: [`curl -H "Authorization: Bearer ${secret}" x`], answer: `done with ${secret}`, paths: [`keys/${secret}.pem`] }),
  });
  assert.doesNotMatch(JSON.stringify(candidate), new RegExp(secret));
  assert.doesNotMatch(distillPrompt(candidate, `Authorization: Bearer ${secret}`), new RegExp(secret));
});

test('an idle session keeps its open strategies: only a gone host process counts as killed', () => {
  const ledger = (id, entry) => writeState(sessionStatePath('session', id), { turn: 1, injected: { [entry.assetId]: { turn: 1, injectedAt: 0, strategyText: '', sessionId: id, ...entry.extra } } });
  ledger('idle', { assetId: 'sha256:a', extra: { pid: process.pid } });
  ledger('old', { assetId: 'sha256:b', extra: { sessionId: undefined } });
  assert.deepEqual(takeOrphanedUnreported(), []);
  ledger('gone', { assetId: 'sha256:c', extra: { pid: deadPid() } });
  assert.deepEqual(takeOrphanedUnreported().map((asset) => asset.assetId), ['sha256:c']);
  assert.deepEqual(takeOrphanedUnreported(), [], 'reported once');
});
