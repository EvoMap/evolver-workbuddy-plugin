import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { runHook, sandboxHome } from './helpers/sandbox.mjs';

const FAKE_NPM = fileURLToPath(new URL('./fixtures/fake-engine/npm.mjs', import.meta.url));
const ENGINE_JOB = new URL('../lib/engine-job.mjs', import.meta.url).href;
const ENGINE_RUNTIME = new URL('../lib/engine-runtime.mjs', import.meta.url).href;
const ENGINE_STATE = new URL('../lib/engine-state.mjs', import.meta.url).href;
const run = promisify(execFile);
const IS_WINDOWS = process.platform === 'win32';

let sandbox;

beforeEach(() => {
  sandbox = sandboxHome();
});

afterEach(() => {
  const pids = join(sandbox.home, 'fake-proxy.pids');
  if (existsSync(pids)) {
    for (const pid of readFileSync(pids, 'utf8').split('\n').filter(Boolean)) {
      try {
        process.kill(Number(pid));
      } catch {
      }
    }
  }
  sandbox.cleanup();
});

const linesOf = (file) => (existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line)) : []);
const npmCalls = () => linesOf(join(sandbox.home, 'fake-npm.log'));
const evolverCalls = () => linesOf(join(sandbox.home, 'fake-evolver.log'));
const engineState = () => JSON.parse(readFileSync(join(sandbox.data, 'engine.json'), 'utf8'));

async function setUp(env = {}, { prefix } = {}) {
  const script = `
    import { setUpEngine } from ${JSON.stringify(ENGINE_JOB)};
    import { engineRuntime } from ${JSON.stringify(ENGINE_RUNTIME)};
    const ran = await setUpEngine(engineRuntime({
      ${prefix ? `prefix: ${JSON.stringify(prefix)},` : ''}
      npm: { command: process.execPath, args: [${JSON.stringify(FAKE_NPM)}], shell: false },
      proxyWaitMs: 5000,
    }));
    process.stdout.write(JSON.stringify({ ran }));
  `;
  const { stdout } = await run(process.execPath, ['--input-type=module', '-e', script], { env: { ...sandbox.env, ...env }, timeout: 30_000 });
  return JSON.parse(stdout).ran;
}

function pathWithFakeEvolver(version) {
  const prefix = join(sandbox.home, 'global');
  const binDir = join(sandbox.home, 'bin');
  mkdirSync(binDir, { recursive: true });
  return run(process.execPath, [FAKE_NPM, 'install', '--prefix', prefix, '@evomap/evolver@latest'], { env: { ...sandbox.env, FAKE_LATEST: version } }).then(() => {
    const shim = join(binDir, 'evolver');
    writeFileSync(shim, `#!/bin/sh\nexec "${process.execPath}" "${join(prefix, 'node_modules', '@evomap', 'evolver', 'bin', 'evolver.js')}" "$@"\n`);
    chmodSync(shim, 0o755);
    return `${binDir}:${sandbox.env.PATH}`;
  });
}

test('a fresh host gets Evolver installed into the plugin data folder, never globally, and its Proxy started', async () => {
  assert.equal(await setUp(), true);
  const [install] = npmCalls();
  assert.deepEqual(install, ['install', '--prefix', join(sandbox.data, 'engine'), '--no-audit', '--no-fund', '--loglevel=error', '@evomap/evolver@latest']);
  assert.ok(!install.includes('-g') && !install.includes('--global'));
  assert.deepEqual(evolverCalls(), [{ args: ['lifecycle', 'start'], selfUpdate: 'off' }]);
  const outcome = engineState();
  assert.equal(outcome.status, 'installed');
  assert.equal(outcome.source, 'managed');
  assert.equal(outcome.proxyVersion, '2.0.44');
  assert.ok(existsSync(join(sandbox.home, '.evolver', 'settings.json')));
});

test('a self-update policy the person set is passed through unchanged', async () => {
  await setUp({ EVOLVER_SELF_UPDATE: 'auto' });
  assert.deepEqual(evolverCalls(), [{ args: ['lifecycle', 'start'], selfUpdate: 'auto' }]);
});

test('an install that fails is recorded with npm\'s error and backed off', async () => {
  await setUp({ FAKE_NPM_FAIL: '1' });
  const outcome = engineState();
  assert.equal(outcome.status, 'install_failed');
  assert.match(outcome.error, /npm ERR! network request to registry failed/);
  assert.ok(outcome.retryAt > Date.now());
  assert.equal(await setUp(), true);
  assert.equal(npmCalls().length, 1);
  assert.equal(engineState().status, 'install_failed');
});

test('a Proxy that refuses to start is recorded with its error', async () => {
  await setUp({ FAKE_START_FAIL: '1' });
  const outcome = engineState();
  assert.equal(outcome.status, 'start_failed');
  assert.match(outcome.error, /EVOMAP_NODE_SECRET/);
});

test('an older plugin-managed Evolver is upgraded in place', async () => {
  await setUp({ FAKE_LATEST: '2.0.42' });
  assert.equal(engineState().status, 'outdated');
  writeFileSync(join(sandbox.data, 'engine.json'), JSON.stringify({ ...engineState(), installRetryAt: 0 }));
  await setUp({ FAKE_LATEST: '2.0.45' });
  const outcome = engineState();
  assert.equal(outcome.status, 'upgraded');
  assert.equal(outcome.previous, '2.0.42');
  assert.equal(outcome.version, '2.0.45');
  assert.deepEqual(evolverCalls().map((call) => call.args), [['lifecycle', 'start'], ['lifecycle', 'restart']]);
});

test('an Evolver on PATH that is new enough is started without installing anything', { skip: IS_WINDOWS }, async () => {
  const PATH = await pathWithFakeEvolver('2.1.0');
  await setUp({ PATH });
  assert.deepEqual(npmCalls().filter((args) => !args.includes(join(sandbox.home, 'global'))), []);
  assert.equal(engineState().source, 'path');
  assert.equal(engineState().status, 'started');
});

test('two sessions starting at once install Evolver only once', async () => {
  const both = await Promise.all([setUp({ FAKE_NPM_DELAY_MS: '1500' }), setUp({ FAKE_NPM_DELAY_MS: '1500' })]);
  assert.deepEqual(both.sort(), [false, true]);
  assert.equal(npmCalls().length, 1);
});

test('a lock left behind by a crashed install expires', async () => {
  const lock = join(sandbox.data, 'engine.lock');
  mkdirSync(lock, { recursive: true });
  assert.equal(await setUp(), false);
  const old = new Date(Date.now() - 3 * 60 * 1000);
  utimesSync(lock, old, old);
  assert.equal(await setUp(), true);
  assert.equal(npmCalls().length, 1);
});

test('session start adds nothing to the context while the Proxy is down and no setup has finished', async () => {
  mkdirSync(join(sandbox.data, 'engine.lock'), { recursive: true });
  const output = await runHook('session-start', { session_id: 's1', hook_event_name: 'SessionStart', source: 'startup' }, sandbox.env);
  assert.deepEqual(output, {});
});

test('session start reports a setup failure once, with what to do', async () => {
  const { writeEngineState } = await import(ENGINE_STATE);
  process.env.CODEBUDDY_PLUGIN_DATA = sandbox.data;
  writeEngineState({ status: 'install_failed', error: 'npm ERR! code EACCES', at: Date.now(), failures: 1, retryAt: Date.now() + 600_000 });
  delete process.env.CODEBUDDY_PLUGIN_DATA;
  const output = await runHook('session-start', { session_id: 's1', hook_event_name: 'SessionStart', source: 'startup' }, sandbox.env);
  const context = output.hookSpecificOutput.additionalContext;
  assert.match(context, /Installing Evolver failed \(npm ERR! code EACCES\)/);
  assert.match(context, /npm install -g @evomap\/evolver@latest/);
  assert.equal(existsSync(join(sandbox.data, 'engine')), false);
  const again = await runHook('session-start', { session_id: 's2', hook_event_name: 'SessionStart', source: 'startup' }, sandbox.env);
  assert.deepEqual(again, {}, 'told once');
});
