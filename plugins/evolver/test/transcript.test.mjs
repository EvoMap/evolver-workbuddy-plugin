import assert from 'node:assert/strict';
import { appendFileSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { appliedVerdictOf } from '../lib/applied.mjs';
import { checkEvidenceOf } from '../lib/checks.mjs';
import { transcriptSize, turnActivityOf, turnRecordsSince } from '../lib/transcript.mjs';

const FIXTURE = new URL('./fixtures/workbuddy-lru-turn.jsonl', import.meta.url);
const LRU_STRATEGY = JSON.parse(readFileSync(new URL('./fixtures/lru-turn.json', import.meta.url), 'utf8')).strategyText;

function transcriptWith(text) {
  const file = join(mkdtempSync(join(tmpdir(), 'evolver-transcript-')), 'session.jsonl');
  writeFileSync(file, text);
  return file;
}

const bashRecords = (command, text, { status = 'completed', callId = 'c1', args = {} } = {}) => [
  { type: 'function_call', name: 'Bash', callId, arguments: JSON.stringify({ command, ...args }) },
  { type: 'function_call_result', name: 'Bash', callId, status, output: { type: 'text', text } },
];

const shellText = (command, stdout, exit) => `Command: ${command}\nStdout: ${stdout}\nStderr: (empty)\nExit Code: ${exit}\nSignal: (none)`;

test('a WorkBuddy turn yields its commands, paths, written code, checks and answer', () => {
  const turn = turnActivityOf(turnRecordsSince(fileURLToPath(FIXTURE), 0));
  assert.deepEqual(turn.checks, [
    { command: 'cd /tmp/lru-e2e && node --test 2>&1 | tail -12', failed: true },
    { command: 'cd /tmp/lru-e2e && node --test 2>&1 | tail -9', failed: false },
  ]);
  assert.equal(turn.edits.length, 2);
  assert.ok(turn.paths.includes('/tmp/lru-e2e/lru-cache.js'));
  assert.equal(turn.answer, 'LRU 缓存写好了：Map 加双向链表，10 个测试全部通过。');
  assert.deepEqual(checkEvidenceOf(turn.checks), { kind: 'test', passed: true, fail_then_pass: true });
  assert.equal(appliedVerdictOf({ strategyText: LRU_STRATEGY, ...turn }).verdict, 'used');
});

test('an edit the host refused writes nothing that counts, and a background run is no check', () => {
  const turn = turnActivityOf(turnRecordsSince(fileURLToPath(FIXTURE), 0));
  assert.ok(!turn.edits.some((edit) => edit.includes('never written')));
  assert.ok(!turn.checks.some((check) => check.command.includes('--watch')));
  assert.ok(turn.commands.includes('node --test --watch'));
});

test('a non-zero exit fails a check even when its output looks clean', () => {
  const [check] = turnActivityOf(bashRecords('npm run build', shellText('npm run build', 'done', 2))).checks;
  assert.equal(check.failed, true);
});

test('failure output fails a check that exited zero, and the command line itself is not output', () => {
  const failing = shellText('npm test | tail -3', 'AssertionError: expected 1 to equal 2\n1 test failed', 0);
  assert.equal(turnActivityOf(bashRecords('npm test | tail -3', failing)).checks[0].failed, true);
  const passing = shellText('npm test -- --grep "test failed"', 'ℹ pass 4\nℹ fail 0', 0);
  assert.equal(turnActivityOf(bashRecords('npm test -- --grep "test failed"', passing)).checks[0].failed, false);
});

test('a check whose call did not complete failed, and one with no result yet says nothing', () => {
  assert.equal(turnActivityOf(bashRecords('npm test', 'Interrupted', { status: 'incomplete' })).checks[0].failed, true);
  assert.deepEqual(turnActivityOf([bashRecords('npm test', '')[0]]).checks, []);
});

test('PowerShell checks count too', () => {
  const records = bashRecords('npm test', shellText('npm test', 'ℹ fail 0', 0)).map((record) => ({ ...record, name: 'PowerShell' }));
  assert.equal(turnActivityOf(records).checks.length, 1);
});

test('written code is capped at 200,000 characters a turn', () => {
  const big = 'x'.repeat(150_000);
  const records = ['a', 'b'].flatMap((id) => [
    { type: 'function_call', name: 'Write', callId: id, arguments: JSON.stringify({ file_path: `/p/${id}.js`, content: big }) },
    { type: 'function_call_result', name: 'Write', callId: id, status: 'completed', output: { type: 'text', text: 'Successfully wrote' } },
  ]);
  assert.equal(turnActivityOf(records).edits.join('').length, 200_000);
});

test('only records after the turn offset are read, and a shrunken transcript falls back to the last prompt', () => {
  const earlier = bashRecords('npm test', shellText('npm test', 'fail', 1), { callId: 'old' });
  const file = transcriptWith(`${earlier.map((record) => JSON.stringify(record)).join('\n')}\n`);
  const offset = transcriptSize(file);
  appendFileSync(file, `${bashRecords('npm run lint', shellText('npm run lint', 'ok', 0), { callId: 'new' }).map((record) => JSON.stringify(record)).join('\n')}\n`);
  assert.deepEqual(turnActivityOf(turnRecordsSince(file, offset)).commands, ['npm run lint']);

  const compacted = transcriptWith([
    { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'old' }] },
    ...earlier,
    { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'new' }] },
    { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'answer' }] },
  ].map((record) => JSON.stringify(record)).join('\n'));
  assert.deepEqual(turnActivityOf(turnRecordsSince(compacted, offset + 10_000)), { commands: [], paths: [], edits: [], checks: [], answer: 'answer' });
});

test('a missing or partly written transcript reads as an empty turn', () => {
  assert.deepEqual(turnRecordsSince('', 0), []);
  assert.deepEqual(turnRecordsSince(join(tmpdir(), 'no-such-transcript.jsonl'), 0), []);
  assert.equal(turnRecordsSince(transcriptWith('{"type":"message","role":"assistant","content":[{"type":"output_text","text":"hi"}]}\n{"type":"func'), 0).length, 1);
});
