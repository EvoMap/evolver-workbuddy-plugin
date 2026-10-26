import assert from 'node:assert/strict';
import { join } from 'node:path';
import { test } from 'node:test';

import { codebuddyCli, completionOf, headlessModel } from '../lib/headless-model.mjs';

const RESULT = { type: 'result', subtype: 'success', is_error: false, result: '{"summary":"s"}', usage: { input_tokens: 900, output_tokens: 120 } };

test('the answer and its token cost come from the result object, alone or among events', () => {
  assert.deepEqual(completionOf({ stdout: JSON.stringify(RESULT) }), { answer: '{"summary":"s"}', usage: { inputTokens: 900, outputTokens: 120 } });
  assert.equal(completionOf({ stdout: JSON.stringify([{ type: 'system' }, RESULT]) }).answer, '{"summary":"s"}');
  assert.equal(completionOf({ stdout: JSON.stringify({ ...RESULT, usage: undefined }) }).usage, null);
});

test('a CLI without auth, or one that failed, gives no answer', () => {
  assert.throws(() => completionOf({ stdout: 'Authentication required. Please use /login command to sign in to your account\n' }), /Authentication required/);
  assert.throws(() => completionOf({ stdout: JSON.stringify({ type: 'result', subtype: 'error_during_execution', is_error: true, errors: ['quota'] }) }), /quota/);
  assert.throws(() => completionOf({ stdout: '' }), /empty output/);
});

test('the CLI bundled with WorkBuddy comes first, then one on PATH, and none means no model', () => {
  const env = { PATH: ['/opt/a', '/opt/b'].join(':') };
  assert.deepEqual(codebuddyCli({ env, platform: 'linux', exists: (file) => file === join('/opt/b', 'codebuddy') }), { command: join('/opt/b', 'codebuddy'), args: [] });
  const bundled = codebuddyCli({ env, platform: 'darwin', exists: () => true });
  assert.match(bundled.command, /WorkBuddy\.app[\\/]Contents[\\/]Resources[\\/]app\.asar\.unpacked[\\/]cli[\\/]bin[\\/]codebuddy$/);
  const windows = codebuddyCli({ env: { LOCALAPPDATA: 'C:\\Users\\me\\AppData\\Local', PATH: '/opt/a' }, platform: 'win32', exists: (file) => file.includes('WorkBuddy') });
  assert.equal(windows.command, process.execPath);
  assert.equal(codebuddyCli({ env, platform: 'linux', exists: () => false }), null);
  assert.equal(headlessModel({ cli: null }), null);
});

test('the prompt goes on stdin of a headless run with no tools, one turn and the session model', async () => {
  const runs = [];
  const run = async (command, input) => {
    runs.push({ command, input });
    return { code: 0, stdout: JSON.stringify(RESULT), stderr: '' };
  };
  const complete = headlessModel({ cli: { command: 'codebuddy', args: [] }, run });
  await complete({ model: 'glm-5' }, 'distill this', undefined);
  await complete({ model: 'bad model; rm -rf' }, 'again', undefined);
  assert.deepEqual(runs[0], {
    command: { command: 'codebuddy', args: ['-p', '--tools', '', '--no-session-persistence', '--output-format', 'json', '--max-turns', '1', '--model', 'glm-5'] },
    input: 'distill this',
  });
  assert.equal(runs[1].command.args.includes('--model'), false);
});
