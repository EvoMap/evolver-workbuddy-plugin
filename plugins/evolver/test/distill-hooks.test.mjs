import assert from 'node:assert/strict';
import { execFile, spawn, spawnSync } from 'node:child_process';
import { appendFileSync, copyFileSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { delimiter, dirname, join } from 'node:path';
import { afterEach, beforeEach, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { fakeProxy, pluginRoot, runHook, sandboxHome, waitFor, writeProxySettings } from './helpers/sandbox.mjs';

const ASSET = {
  asset_id: 'sha256:cut',
  short_title: 'Retry a flaky upload with backoff',
  strategy: ['Measure the failure rate.', 'Wrap the call in a retry.', 'Back off exponentially.', 'Cap the attempts.'],
};
const LRU_TURN = readFileSync(fileURLToPath(new URL('./fixtures/workbuddy-lru-turn.jsonl', import.meta.url)), 'utf8');
const FAKE_CODEBUDDY = fileURLToPath(new URL('./fixtures/fake-codebuddy', import.meta.url));
const MODEL_ANSWER = { type: 'message', role: 'assistant', providerData: { model: 'glm-5' }, content: [{ type: 'output_text', text: 'LRU 缓存写好了。' }] };
const posix = { skip: process.platform === 'win32' && 'the fake CLI is a shell script' };

let sandbox;
let proxy;

// The worker prefers the CLI bundled with WorkBuddy, so on macOS the fake is installed where a per-user
// WorkBuddy.app would be; elsewhere it is found on PATH.
function installFakeCli(home) {
  const bin = join(home, 'Applications', 'WorkBuddy.app', 'Contents', 'Resources', 'app.asar.unpacked', 'cli', 'bin');
  mkdirSync(bin, { recursive: true });
  for (const name of ['codebuddy', 'codebuddy.mjs']) copyFileSync(join(FAKE_CODEBUDDY, name), join(bin, name));
}

async function startSandbox({ assets = [] } = {}) {
  sandbox = sandboxHome();
  installFakeCli(sandbox.home);
  sandbox.env = {
    ...sandbox.env,
    PATH: `${FAKE_CODEBUDDY}${delimiter}${sandbox.env.PATH}`,
    FAKE_CODEBUDDY_NODE: process.execPath,
    FAKE_CODEBUDDY_LOG: join(sandbox.home, 'codebuddy.log'),
  };
  proxy = await fakeProxy({ assets });
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
    transcript,
    start: () => runHook('session-start', { ...base, hook_event_name: 'SessionStart', source: 'startup' }, sandbox.env),
    prompt: (prompt) => runHook('user-prompt-submit', { ...base, hook_event_name: 'UserPromptSubmit', prompt }, sandbox.env),
    stop: (reason = 'completed') => runHook('final-stop', { ...base, hook_event_name: 'FinalStop', final_stop_reason: reason }, sandbox.env),
    end: () => runHook('session-end', { ...base, hook_event_name: 'SessionEnd', reason: 'prompt_input_exit' }, sandbox.env),
  };
}

const pendingPath = () => join(sandbox.home, '.evolver', 'state', 'workbuddy-distill-pending.json');

function pending() {
  try {
    return JSON.parse(readFileSync(pendingPath(), 'utf8'));
  } catch {
    return {};
  }
}

function cliRuns() {
  try {
    return readFileSync(sandbox.env.FAKE_CODEBUDDY_LOG, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line));
  } catch {
    return [];
  }
}

async function verifiedTurn(s, prompt = '用 Node 写一个 LRU 缓存，带测试') {
  await s.prompt(prompt);
  appendFileSync(s.transcript, LRU_TURN);
  appendFileSync(s.transcript, `${JSON.stringify(MODEL_ANSWER)}\n`);
  await s.stop();
}

function deadPid() {
  return Number(spawnSync(process.execPath, ['-e', 'process.stdout.write(String(process.pid))']).stdout.toString());
}

test('a verified turn that reused no strategy becomes the candidate, with its model and no secrets', async () => {
  await startSandbox();
  const s = session('s-verified');
  await verifiedTurn(s, '用 Node 写一个 LRU 缓存，带测试，token=ghp_abcdefghijklmnopqrstuvwxyz0123');

  const candidate = pending()['s-verified'];
  assert.equal(candidate.turn, 1);
  assert.deepEqual(candidate.model, { model: 'glm-5' });
  assert.match(candidate.prompt, /LRU/);
  assert.doesNotMatch(candidate.prompt, /ghp_abcdefghijklmnopqrstuvwxyz0123/);
  assert.ok(candidate.commands.some((command) => command.includes('node --test')));
  assert.equal(candidate.answer, 'LRU 缓存写好了。');
  assert.equal(cliRuns().length, 0, 'nothing runs at turn end');
});

async function endedTurn(s, reason) {
  await s.prompt('用 Node 写一个 LRU 缓存，带测试');
  appendFileSync(s.transcript, LRU_TURN);
  await s.stop(reason);
}

const RENDERED_COMMAND = 'Executing slash command: /evolver:evolver-distill\n<command-message>evolver:evolver-distill</command-message> <command-name>/evolver:evolver-distill</command-name>\nDistillation failed: 不对';

test('a chat reply, an interrupted, cancelled or failed turn and an /evolver-* command leave no candidate', async () => {
  await startSandbox();
  const chat = session('s-chat');
  await chat.prompt('LRU 是什么意思？给我解释一下');
  appendFileSync(chat.transcript, `${JSON.stringify(MODEL_ANSWER)}\n`);
  await chat.stop();
  for (const reason of ['interrupted', 'cancelled', 'failed']) await endedTurn(session(`s-${reason}`), reason);
  await verifiedTurn(session('s-typed'), '/evolver-status');
  await verifiedTurn(session('s-rendered'), RENDERED_COMMAND);
  assert.deepEqual(pending(), {});
});

test('an /evolver-* command turn neither recalls nor reads as a correction of the turn before', async () => {
  await startSandbox({ assets: [ASSET] });
  const s = session('s-kept');
  await verifiedTurn(s);
  assert.deepEqual(await s.prompt(RENDERED_COMMAND), {});
  assert.equal(proxy.recalls.length, 1, 'only the first prompt was recalled for');
  assert.ok(pending()['s-kept'], 'the command output is no correction');
});

test('a correction in the next prompt drops the candidate', async () => {
  await startSandbox();
  const s = session('s-corrected');
  await verifiedTurn(s);
  assert.ok(pending()['s-corrected']);
  await s.prompt('不对，这样不行');
  assert.equal(pending()['s-corrected'], undefined);
});

test('a strategy whose turn failed or was interrupted is reported failed, the interrupted one as aborted', async () => {
  await startSandbox({ assets: [ASSET] });
  for (const reason of ['failed', 'interrupted']) {
    const s = session(`s-${reason}`);
    await s.prompt('add a retry with backoff to the flaky uploader');
    appendFileSync(s.transcript, `${JSON.stringify(MODEL_ANSWER)}\n`);
    await s.stop(reason);
  }
  const reports = await waitFor(() => (proxy.posts.length === 2 ? proxy.posts : null));
  const byTask = Object.fromEntries(reports.map((report) => [report.task_id, report]));
  assert.equal(byTask['workbuddy:s-failed:1'].outcome, 'failed');
  assert.equal(byTask['workbuddy:s-failed:1'].evidence.aborted, false);
  assert.equal(byTask['workbuddy:s-interrupted:1'].outcome, 'failed');
  assert.equal(byTask['workbuddy:s-interrupted:1'].evidence.aborted, true);
});

test("inside the headless distillation run, this plugin's hooks do nothing", async () => {
  await startSandbox({ assets: [ASSET] });
  sandbox.env.EVOLVER_HEADLESS = '1';
  const s = session('s-headless');
  assert.deepEqual(await s.start(), {});
  assert.deepEqual(await s.prompt('add a retry with backoff to the flaky uploader'), {});
  await s.stop();
  await s.end();
  await new Promise((resolve) => setTimeout(resolve, 400));
  assert.deepEqual(proxy.recalls, []);
  assert.deepEqual(readdirSync(sandbox.data), []);
});

test('at session end, an unreported strategy is reported aborted and the candidate is distilled headless', posix, async () => {
  await startSandbox({ assets: [ASSET] });
  const done = session('s-done');
  await verifiedTurn(done);
  const cut = session('s-cut');
  const injected = await cut.prompt('add a retry with backoff to the flaky uploader');
  assert.match(injected.hookSpecificOutput.additionalContext, /\nApply them where they fit\.$/);

  await cut.end();
  const [report] = await waitFor(() => proxy.posts.filter((post) => post.task_id === 'workbuddy:s-cut:1'));
  assert.deepEqual(report, {
    asset_id: 'sha256:cut',
    outcome: 'failed',
    task_id: 'workbuddy:s-cut:1',
    reason: 'Injected by Evolver into WorkBuddy turn 1; applied: unknown; no check ran; the turn left no answer.',
    evidence: { tier: 'none', applied: 'partial', aborted: true, stage: 'immediate' },
  });
  assert.ok(pending()['s-done'], 'a live session keeps its candidate');

  await done.end();
  const [distilled] = await waitFor(() => proxy.distills);
  assert.equal(distilled.platform, 'workbuddy');
  assert.equal(distilled.trigger, 'session_end');
  assert.deepEqual(distilled.strategy, ['Measure.', 'Back off.']);
  assert.deepEqual(distilled.distill_usage, { inputTokens: 900, outputTokens: 120 });
  const [run] = cliRuns();
  assert.equal(run.headless, '1');
  assert.deepEqual(run.args, ['-p', '--tools', '', '--no-session-persistence', '--output-format', 'json', '--max-turns', '1', '--model', 'glm-5']);
  assert.match(run.prompt, /## Task\n用 Node 写一个 LRU 缓存，带测试/);
  await waitFor(() => !pending()['s-done']);
});

test('a CLI without auth keeps the candidate for the next session start', posix, async () => {
  await startSandbox();
  sandbox.env.FAKE_CODEBUDDY_ANSWER = 'auth';
  const s = session('s-unauthed');
  await verifiedTurn(s);
  await s.end();
  await waitFor(() => pending()['s-unauthed']?.attempts === 1);
  assert.equal(pending()['s-unauthed'].claimedBy, null);
  assert.deepEqual(proxy.distills, []);

  delete sandbox.env.FAKE_CODEBUDDY_ANSWER;
  await session('s-next').start();
  await waitFor(() => proxy.distills);
  await waitFor(() => !pending()['s-unauthed']);
});

test("the next session reports a killed session's open strategies and distills its leftover candidate", posix, async () => {
  await startSandbox();
  const dead = deadPid();
  const killed = session('s-killed');
  await verifiedTurn(killed);
  const candidates = pending();
  writeFileSync(pendingPath(), JSON.stringify({ 's-killed': { ...candidates['s-killed'], pid: dead } }));
  const stateFile = join(sandbox.data, readdirSync(sandbox.data).find((name) => name.startsWith('session-')));
  const state = JSON.parse(readFileSync(stateFile, 'utf8'));
  state.injected = { 'sha256:orphan': { turn: 4, injectedAt: Date.now(), strategyText: '1. a.', sessionId: 's-killed', pid: dead } };
  writeFileSync(stateFile, JSON.stringify(state));

  await session('s-after').start();
  const [report] = await waitFor(() => proxy.posts);
  assert.equal(report.asset_id, 'sha256:orphan');
  assert.equal(report.task_id, 'workbuddy:s-killed:4');
  assert.equal(report.evidence.aborted, true);
  await waitFor(() => proxy.distills);
  await waitFor(() => !pending()['s-killed']);
});

test('/evolver-distill distills the live session now and says when there is nothing yet', posix, async () => {
  await startSandbox();
  const script = join(pluginRoot, 'scripts', 'evolver-distill.mjs');
  const runDistill = (sessionId, focus) => new Promise((resolve) => {
    const child = execFile(process.execPath, [script], { env: { ...sandbox.env, CODEBUDDY_SESSION_ID: sessionId } }, (error, stdout) => resolve({ status: error?.code ?? 0, stdout }));
    child.stdin.end(focus);
  });

  const nothing = await runDistill('s-empty', '$ARGUMENTS');
  assert.equal(nothing.status, 1);
  assert.match(nothing.stdout, /Nothing to distill yet/);

  await verifiedTurn(session('s-now'));
  const now = await runDistill('s-now', 'the backoff\n');
  assert.equal(now.status, 0, now.stdout);
  assert.equal(proxy.distills.length, 1);
  assert.match(cliRuns()[0].prompt, /Focus on: the backoff/);
  assert.equal(pending()['s-now'], undefined);
});

test('/evolver-distill leaves a candidate alone while a live process distills it', posix, async () => {
  await startSandbox();
  await verifiedTurn(session('s-busy'));
  const holder = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 20000)']);
  writeFileSync(pendingPath(), JSON.stringify({ 's-busy': { ...pending()['s-busy'], claimedBy: holder.pid } }));
  const script = join(pluginRoot, 'scripts', 'evolver-distill.mjs');
  const result = await new Promise((resolve) => {
    const child = execFile(process.execPath, [script], { env: { ...sandbox.env, CODEBUDDY_SESSION_ID: 's-busy' } }, (error, stdout) => resolve({ status: error?.code ?? 0, stdout }));
    child.stdin.end('');
  });
  holder.kill();
  assert.equal(result.status, 1);
  assert.match(result.stdout, /another process is distilling/);
  assert.deepEqual(cliRuns(), []);
});

function runDistillScript(args, sessionId, input, env = {}) {
  const script = join(pluginRoot, 'scripts', 'evolver-distill.mjs');
  return new Promise((resolve) => {
    const child = execFile(process.execPath, [script, ...args], { env: { ...sandbox.env, CODEBUDDY_SESSION_ID: sessionId, ...env } }, (error, stdout) => resolve({ status: error?.code ?? 0, stdout }));
    child.stdin.end(input);
  });
}

function shellRun(command) {
  return new Promise((resolve) => {
    const env = { ...sandbox.env, PATH: `${dirname(process.execPath)}${delimiter}${sandbox.env.PATH}` };
    execFile('/bin/sh', ['-c', command], { env }, (error, stdout) => resolve({ status: error?.code ?? 0, stdout }));
  });
}

test('/evolver-distill hands the turn to the agent when the headless model cannot sign in, and posts its Gene', posix, async () => {
  await startSandbox();
  await verifiedTurn(session('s-agent'));
  const handed = await runDistillScript([], 's-agent', 'the eviction order', { FAKE_CODEBUDDY_ANSWER: 'auth' });
  assert.equal(handed.status, 0, handed.stdout);
  assert.match(handed.stdout, /^EVOLVER: WRITE THE GENE YOURSELF\n.*Authentication required/);
  assert.match(handed.stdout, /Focus on: the eviction order/);
  assert.equal(proxy.distills.length, 0);
  assert.equal(pending()['s-agent'].attempts, 0);
  assert.equal(pending()['s-agent'].claimedBy, null);

  const command = /^CODEBUDDY_SESSION_ID=.*\n<the JSON object>\nEVOLVER_GENE$/m.exec(handed.stdout)[0];
  const gene = JSON.stringify({ title: 'LRU cache', summary: 'An LRU cache over a Map.', strategy: ['Keep a Map.', 'Re-insert on read.'] });
  const posted = await shellRun(command.replace('<the JSON object>', gene));
  assert.equal(posted.status, 0, posted.stdout);
  assert.equal(proxy.distills.length, 1);
  assert.equal(proxy.distills[0].summary, 'An LRU cache over a Map.');
  assert.deepEqual(proxy.distills[0].strategy, ['Keep a Map.', 'Re-insert on read.']);
  assert.equal(pending()['s-agent'], undefined);
});

test('an agent Gene that is no JSON object is refused and the candidate stays', posix, async () => {
  await startSandbox();
  await verifiedTurn(session('s-bad'));
  const refused = await runDistillScript(['--post'], 's-bad', 'just prose');
  assert.equal(refused.status, 1);
  assert.match(refused.stdout, /one JSON object/);
  assert.equal(proxy.distills.length, 0);
  assert.equal(pending()['s-bad'].attempts, 0);
});
