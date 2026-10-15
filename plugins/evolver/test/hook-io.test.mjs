import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { afterEach, test } from 'node:test';

import { pluginRoot, sandboxHome } from './helpers/sandbox.mjs';

let sandbox;

afterEach(() => sandbox?.cleanup());

function hookWithOpenStdin(payload) {
  sandbox = sandboxHome();
  const child = spawn(process.execPath, [join(pluginRoot, 'hooks', 'session-start.mjs')], { env: sandbox.env, stdio: ['pipe', 'pipe', 'ignore'] });
  child.stdin.write(payload);
  const startedAt = Date.now();
  return new Promise((resolve) => {
    let stdout = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.on('exit', (code) => {
      child.stdin.destroy();
      resolve({ code, stdout, elapsedMs: Date.now() - startedAt });
    });
  });
}

test('a payload that never completes still gets an answer before the shortest hook timeout', async () => {
  const { code, stdout, elapsedMs } = await hookWithOpenStdin('{"session_id":');
  assert.equal(code, 0);
  assert.ok(elapsedMs < 5000, `answered after ${elapsedMs}ms`);
  assert.ok(JSON.parse(stdout));
});

test('a complete payload on a stdin the host keeps open is answered on the first watchdog tick', async () => {
  const { code, elapsedMs } = await hookWithOpenStdin('{"session_id":"s1","hook_event_name":"SessionStart"}');
  assert.equal(code, 0);
  assert.ok(elapsedMs < 2500, `answered after ${elapsedMs}ms`);
});

test('whitespace that arrives ahead of the payload is not taken for an empty input', async () => {
  const { code, stdout } = await hookWithOpenStdin('   \n');
  assert.equal(code, 0);
  assert.ok(JSON.parse(stdout));
});
