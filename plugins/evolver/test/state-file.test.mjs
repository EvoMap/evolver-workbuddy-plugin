import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { before, test } from 'node:test';

import { appendStateLine, statePath, takeStateLines, tryLock } from '../lib/state-file.mjs';

before(() => {
  process.env.CODEBUDDY_PLUGIN_DATA = mkdtempSync(join(tmpdir(), 'evolver-state-'));
});

const claimsOf = (name) => readdirSync(process.env.CODEBUDDY_PLUGIN_DATA).filter((file) => file.startsWith(`${name}.`) && file.endsWith('.taking'));

test('taken lines stay claimed until committed', () => {
  const queue = statePath('commit-queue.jsonl');
  appendStateLine(queue, { n: 1 });
  appendStateLine(queue, { n: 2 });
  const taken = takeStateLines(queue);
  assert.deepEqual(taken.lines, [{ n: 1 }, { n: 2 }]);
  assert.equal(claimsOf('commit-queue.jsonl').length, 1);
  appendStateLine(queue, { n: 3 });
  taken.commit();
  assert.equal(claimsOf('commit-queue.jsonl').length, 0);
  assert.deepEqual(takeStateLines(queue).lines, [{ n: 3 }]);
});

test('lines a crashed taker never committed come back once its claim is stale', () => {
  const queue = statePath('crash-queue.jsonl');
  appendStateLine(queue, { n: 1 });
  takeStateLines(queue);
  appendStateLine(queue, { n: 2 });
  assert.deepEqual(takeStateLines(queue).lines, [{ n: 2 }]);
  const stale = new Date(Date.now() - 2 * 60 * 1000);
  for (const claim of claimsOf('crash-queue.jsonl')) utimesSync(join(process.env.CODEBUDDY_PLUGIN_DATA, claim), stale, stale);
  const recovered = takeStateLines(queue);
  assert.deepEqual(recovered.lines.map(({ n }) => n).sort(), [1, 2]);
  recovered.commit();
  assert.equal(claimsOf('crash-queue.jsonl').length, 0);
});

test('a holder whose lock went stale cannot release or refresh the next holder\'s lock', () => {
  const first = tryLock('owned');
  assert.ok(first);
  assert.equal(tryLock('owned'), null);
  const second = tryLock('owned', Date.now() + 3 * 60 * 1000);
  assert.ok(second);
  first.release();
  assert.ok(existsSync(statePath('owned.lock')));
  assert.equal(tryLock('owned'), null);
  second.release();
  assert.ok(tryLock('owned'));
});
