import assert from 'node:assert/strict';
import { test } from 'node:test';

import { argumentsOf, runEvolverCli } from '../lib/evolver-cli.mjs';

test('quoted words stay one argument and a backslash escapes a quote', () => {
  assert.deepEqual(argumentsOf('--summary="two words" --dry-run'), ['--summary=two words', '--dry-run']);
  assert.deepEqual(argumentsOf("--intent='a b' x\\\"y"), ['--intent=a b', 'x"y']);
  assert.deepEqual(argumentsOf('   '), []);
});

test('the engine this plugin installed runs first, else evolver, else the pinned npx package', async () => {
  const calls = [];
  const missing = Object.assign(new Error('spawn evolver ENOENT'), { code: 'ENOENT' });
  const run = async (file, args) => {
    calls.push([file, ...args]);
    return file === 'evolver' ? { error: missing, output: '' } : { error: null, output: 'synced' };
  };
  assert.deepEqual(await runEvolverCli(['sync'], { run, managedEngine: () => null }), { kind: 'success', text: 'synced' });
  assert.deepEqual(calls, [['evolver', 'sync'], ['npx', '-y', '@evomap/evolver@^2.0.44', 'sync']]);

  calls.length = 0;
  await runEvolverCli(['review'], { run, managedEngine: () => '/engine/index.js' });
  assert.deepEqual(calls, [[process.execPath, '/engine/index.js', 'review']]);
});

test('a failing command answers with its output as an error', async () => {
  const run = async () => ({ error: new Error('exit 1'), output: 'no pending changes' });
  assert.deepEqual(await runEvolverCli(['review'], { run, managedEngine: () => null }), { kind: 'error', text: 'no pending changes' });
});
