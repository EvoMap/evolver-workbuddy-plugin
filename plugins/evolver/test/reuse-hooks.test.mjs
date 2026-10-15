import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { appendFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { fakeProxy, runHook, sandboxHome, waitFor, writeProxySettings } from './helpers/sandbox.mjs';

const ASSET_ID = 'sha256:40c6ec437967f3ce0a2101857736b95d2770a014f452752a9421db2bee223f37';
const LRU_ASSET = {
  asset_id: ASSET_ID,
  short_title: 'LRU cache in Node.js with a doubly linked list',
  strategy: [
    'Use a Map for O(1) key lookups combined with a doubly-linked list to track access order',
    'On get, move the accessed node to the head of the list to mark it as most recently used',
    'On set, add new items at the head and evict the tail node when capacity is exceeded',
    'Maintain head and tail pointers for efficient insertion at front and removal from back',
    'Track cache size and provide stats method for hit ratio monitoring',
  ],
};
const LRU_TURN = readFileSync(fileURLToPath(new URL('./fixtures/workbuddy-lru-turn.jsonl', import.meta.url)), 'utf8');

const run = promisify(execFile);

let sandbox;
let proxy;

async function startSession({ reuseAnswers } = {}) {
  sandbox = sandboxHome();
  proxy = await fakeProxy({ assets: [LRU_ASSET], reuseAnswers });
  writeProxySettings(sandbox.home, { url: proxy.url, version: '2.0.44' });
}

beforeEach(() => {
  sandbox = null;
  proxy = null;
});

afterEach(async () => {
  await proxy?.close();
  sandbox?.cleanup();
});

function session(id) {
  const project = join(sandbox.home, 'project');
  mkdirSync(project, { recursive: true });
  const transcript = join(sandbox.home, `${id}.jsonl`);
  writeFileSync(transcript, '');
  const base = { session_id: id, transcript_path: transcript, cwd: project };
  return {
    project,
    transcript,
    start: () => runHook('session-start', { ...base, hook_event_name: 'SessionStart', source: 'startup' }, sandbox.env),
    prompt: (prompt) => runHook('user-prompt-submit', { ...base, hook_event_name: 'UserPromptSubmit', prompt }, sandbox.env),
    beforeEdit: (file) => runHook('pre-tool-use', { ...base, hook_event_name: 'PreToolUse', tool_name: 'Write', tool_input: { file_path: file, content: 'x' } }, sandbox.env),
    stop: (extra = {}) => runHook('stop', { ...base, hook_event_name: 'Stop', stop_hook_active: false, ...extra }, sandbox.env),
  };
}

async function statusReport() {
  const { stdout } = await run(process.execPath, [join(sandbox.env.CODEBUDDY_PLUGIN_ROOT, 'scripts', 'evolver-status.mjs')], { env: sandbox.env });
  return stdout;
}

function outbox() {
  try {
    return Object.values(JSON.parse(readFileSync(join(sandbox.data, 'reports-outbox.json'), 'utf8')));
  } catch {
    return [];
  }
}

async function lruTurn(s) {
  const injected = await s.prompt('用 Node 写一个 LRU cache，带 get/set 和淘汰');
  const file = join(s.project, 'lru-cache.js');
  await s.beforeEdit(file);
  writeFileSync(file, 'export class LruCache {}\n');
  appendFileSync(s.transcript, LRU_TURN);
  await s.stop({ last_assistant_message: 'LRU 缓存写好了。' });
  return { injected, file };
}

test('a recalled strategy is reported at turn end with L1 evidence through the Proxy', async () => {
  await startSession();
  const s = session('s-lru');
  await s.start();
  const { injected } = await lruTurn(s);

  assert.match(injected.hookSpecificOutput.additionalContext, /^\[Evolution Memory\]/);
  const [report] = await waitFor(() => (proxy.posts.length > 0 ? proxy.posts : null));
  assert.deepEqual(report, {
    asset_id: ASSET_ID,
    outcome: 'success',
    task_id: 'workbuddy:s-lru:1',
    reason: 'Injected by Evolver into WorkBuddy turn 1; applied: used; last test passed after failing earlier.',
    evidence: { tier: 'L1', applied: 'used', check: { kind: 'test', passed: true, fail_then_pass: true }, stage: 'immediate' },
  });
  const [entry] = await waitFor(() => outbox().filter((candidate) => candidate.sentAt));
  assert.deepEqual(entry.receipt, { recorded: true, eligible: true, counted: true, weight: 1 });
});

test('a turn with nothing to compare reports tier none with applied partial, never unused', async () => {
  await startSession();
  const s = session('s-talk');
  await s.prompt('用 Node 写一个 LRU cache，带 get/set 和淘汰');
  appendFileSync(s.transcript, `${JSON.stringify({ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: '用 Map 就行。' }] })}\n`);
  await s.stop();
  const [report] = await waitFor(() => (proxy.posts.length > 0 ? proxy.posts : null));
  assert.deepEqual(report.evidence, { tier: 'none', applied: 'partial', stage: 'immediate' });
  assert.match(report.reason, /applied: unknown/);
  assert.equal(report.outcome, 'success');
});

test('each injection is reported once, and a turn without one reports nothing', async () => {
  await startSession();
  const s = session('s-once');
  await lruTurn(s);
  await waitFor(() => proxy.posts.length === 1);
  const again = await s.prompt('用 Node 写一个 LRU cache，带 get/set 和淘汰，再来一次');
  assert.deepEqual(again, {});
  await s.stop({ last_assistant_message: 'ok' });
  await new Promise((resolve) => setTimeout(resolve, 600));
  assert.equal(proxy.posts.length, 1);
});

test('a correction in the next prompt sends an L3 follow-up under :correction', async () => {
  await startSession();
  const s = session('s-fix');
  await lruTurn(s);
  await s.prompt('还是报错，不对');
  const posts = await waitFor(() => (proxy.posts.length >= 2 ? proxy.posts : null));
  const correction = posts.find((post) => post.task_id.endsWith(':correction'));
  assert.deepEqual(correction, {
    asset_id: ASSET_ID,
    outcome: 'failed',
    task_id: 'workbuddy:s-fix:1:correction',
    reason: "The person's next prompt read as correction of the turn that reused this strategy.",
    evidence: { tier: 'L3', applied: 'used', stage: 'correction' },
  });
});

test('the next session in the same project reports whether the edits were kept, under :retention', async () => {
  await startSession();
  const first = session('s-first');
  await lruTurn(first);
  await waitFor(() => proxy.posts.length === 1);
  await session('s-second').start();
  const posts = await waitFor(() => (proxy.posts.length >= 2 ? proxy.posts : null));
  assert.deepEqual(posts[1], {
    asset_id: ASSET_ID,
    outcome: 'success',
    task_id: 'workbuddy:s-first:1:retention',
    reason: 'By the next session the files the turn edited were kept.',
    evidence: { tier: 'L2', applied: 'used', stage: 'retention' },
  });
});

test('reverted edits report failed, and the same session never judges its own edits', async () => {
  await startSession();
  const first = session('s-revert');
  const { file } = await lruTurn(first);
  await waitFor(() => proxy.posts.length === 1);
  await first.start();
  await new Promise((resolve) => setTimeout(resolve, 400));
  assert.equal(proxy.posts.length, 1);
  rmSync(file);
  await session('s-later').start();
  const posts = await waitFor(() => (proxy.posts.length >= 2 ? proxy.posts : null));
  assert.equal(posts[1].outcome, 'failed');
  assert.match(posts[1].reason, /were reverted/);
});

test('a Proxy that is down keeps the report queued until a later turn delivers it', async () => {
  await startSession({ reuseAnswers: [[200, { recorded: false, reason: 'hub 503' }], [200, { recorded: true, eligible: false, reason: 'daily_cap' }]] });
  const s = session('s-retry');
  await lruTurn(s);
  await waitFor(() => outbox().some((entry) => entry.attempts === 1 && !entry.sentAt));
  await s.start();
  const [entry] = await waitFor(() => outbox().filter((candidate) => candidate.sentAt));
  assert.equal(entry.attempts, 2);
  assert.deepEqual(entry.receipt, { recorded: true, eligible: false, reason: 'daily_cap' });
});

test('a report the Hub refuses as invalid is settled as rejected and shown by /evolver-status', async () => {
  await startSession({ reuseAnswers: [[200, { recorded: false, terminal: true, reason: 'evidence: Unrecognized key', status: 400 }]] });
  const s = session('s-bad');
  await lruTurn(s);
  const [entry] = await waitFor(() => outbox().filter((candidate) => candidate.rejectedAt));
  assert.deepEqual(entry.rejection, { reason: 'evidence: Unrecognized key', status: 400 });
  await s.start();
  await new Promise((resolve) => setTimeout(resolve, 400));
  assert.equal(proxy.posts.length, 1);

  const status = await statusReport();
  assert.match(status, /REJECTED .* workbuddy:s-bad:1 sha256:40c6.* reason=evidence: Unrecognized key status=400/);
  assert.match(status, /OK Proxy: running/);
});

test('/evolver-status lists recent deliveries with eligible, counted and weight', async () => {
  await startSession();
  await lruTurn(session('s-status'));
  await waitFor(() => outbox().some((entry) => entry.sentAt));
  const status = await statusReport();
  assert.match(status, /sent .* workbuddy:s-status:1 sha256:40c6\S* tier=L1 eligible=true counted=true weight=1/);
});

test('a subagent stop reports nothing for the parent turn', async () => {
  await startSession();
  const s = session('s-sub');
  await s.prompt('用 Node 写一个 LRU cache，带 get/set 和淘汰');
  await s.stop({ agent_id: 'agent-1' });
  await new Promise((resolve) => setTimeout(resolve, 400));
  assert.equal(proxy.posts.length, 0);
});

test('the prompt loses keys and tokens before recall sends it', async () => {
  await startSession();
  await session('s-secret').prompt('LRU cache 报错了，token=ghp_abcdefghijklmnopqrstuvwxyz0123 怎么修');
  assert.equal(proxy.recalls.length, 1);
  assert.doesNotMatch(proxy.recalls[0].text, /ghp_abcdefghijklmnopqrstuvwxyz0123/);
  assert.match(proxy.recalls[0].text, /\[redacted\]/);
});
