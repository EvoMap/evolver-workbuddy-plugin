import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs, { existsSync, mkdtempSync, readdirSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { before, test } from 'node:test';

import { appendStateLine, readState, statePath, takeStateLines, tryLock, updateState } from '../lib/state-file.mjs';

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

const MODULE = new URL('../lib/state-file.mjs', import.meta.url).href;
const WRITERS = 4;
const PER_WRITER = 15;

const CHILD = `
  const { statePath, updateState } = await import(process.argv[1]);
  for (const key of process.argv.slice(2)) {
    updateState(statePath('shared.json'), {}, (state) => ({ ...state, [key]: true }));
  }
`;

function writer(keys) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', CHILD, MODULE, ...keys], { stdio: 'ignore', env: process.env });
    child.on('exit', resolve);
  });
}

test('an update is read, changed and written under a lock, so parallel writers keep every entry', async () => {
  const keysOf = (writerIndex) => Array.from({ length: PER_WRITER }, (unused, index) => `w${writerIndex}-${index}`);

  await Promise.all(Array.from({ length: WRITERS }, (unused, index) => writer(keysOf(index))));

  const written = readState(statePath('shared.json'), {});
  assert.equal(Object.keys(written).length, WRITERS * PER_WRITER);
});

test('an update that changes nothing leaves the file alone and releases its lock', () => {
  updateState(statePath('kept.json'), {}, () => ({ a: 1 }));
  updateState(statePath('kept.json'), {}, () => undefined);
  assert.deepEqual(readState(statePath('kept.json'), {}), { a: 1 });
  assert.deepEqual(updateState(statePath('kept.json'), {}, (state) => ({ ...state, b: 2 })), { a: 1, b: 2 });
});

test("a dead owner's lock is taken over, and a lock someone else holds by the time of release is left to them", () => {
  const target = statePath('stale.json');
  const lockPath = `${target}.lock`;
  const deadPid = spawnSync(process.execPath, ['-e', '']).pid;
  fs.writeFileSync(lockPath, `${deadPid}:dead`);

  updateState(target, {}, () => ({ a: 1 }));
  assert.equal(fs.existsSync(lockPath), false, "the dead owner's lock is gone after the update");

  updateState(target, {}, (state) => {
    fs.writeFileSync(lockPath, `${process.pid}:someone-else`);
    return { ...state, b: 2 };
  });
  assert.equal(fs.readFileSync(lockPath, 'utf8'), `${process.pid}:someone-else`);
  assert.deepEqual(readState(target, {}), { a: 1, b: 2 });
});
