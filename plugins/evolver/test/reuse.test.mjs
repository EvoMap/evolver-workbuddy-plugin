import assert from 'node:assert/strict';
import { test } from 'node:test';

import { withQueued } from '../lib/report-outbox.mjs';
import {
  correctionReportOf,
  deliverPending,
  deliveryOf,
  immediateReportOf,
  reportedReuseOf,
  retentionReportOf,
} from '../lib/reuse.mjs';

const NOW = 1_800_000_000_000;

function proxy(answer = { ok: true, status: 200, data: { recorded: true } }) {
  const posts = [];
  return {
    posts,
    post: async (report) => {
      posts.push(report);
      if (answer instanceof Error) throw answer;
      return answer;
    },
  };
}

const immediate = (overrides = {}) => immediateReportOf({ assetId: 'sha256:a', sessionId: 's1', turn: 4, answered: true, checks: [], applied: 'used', ...overrides });
const queuedOne = (report) => withQueued({}, [{ report, sessionId: 's1' }], NOW);
const verified = () => immediate({ checks: [{ command: 'npm test', failed: false }] });

test('a turn that ran no check still reports its injection, as tier none', () => {
  assert.deepEqual(immediate(), {
    asset_id: 'sha256:a',
    outcome: 'success',
    task_id: 'workbuddy:s1:4',
    reason: 'Injected by Evolver into WorkBuddy turn 4; applied: used; no check ran.',
    evidence: { tier: 'none', applied: 'used', stage: 'immediate' },
  });
});

test('a turn that left no answer and ran no check failed', () => {
  const report = immediate({ answered: false });
  assert.equal(report.outcome, 'failed');
  assert.match(report.reason, /the turn left no answer/);
});

test('the request body carries exactly the contract fields', () => {
  assert.deepEqual(Object.keys(verified()).sort(), ['asset_id', 'evidence', 'outcome', 'reason', 'task_id']);
  assert.deepEqual(Object.keys(verified().evidence).sort(), ['applied', 'check', 'stage', 'tier']);
  assert.deepEqual(Object.keys(verified().evidence.check).sort(), ['fail_then_pass', 'kind', 'passed']);
});

test('a check the turn ran makes the report L1 and decides its outcome', () => {
  const passed = verified();
  assert.equal(passed.outcome, 'success');
  assert.deepEqual(passed.evidence.check, { kind: 'test', passed: true, fail_then_pass: false });
  assert.equal(passed.evidence.tier, 'L1');

  const failed = immediate({ checks: [{ command: 'npx tsc -p .', failed: true }], applied: 'partial', answered: true });
  assert.equal(failed.outcome, 'failed');
  assert.deepEqual(failed.evidence.check, { kind: 'typecheck', passed: false, fail_then_pass: false });
  assert.equal(failed.evidence.applied, 'partial');
});

test('the same check failing and then passing is recorded as such', () => {
  const report = immediate({
    checks: [{ command: 'npm test', failed: true }, { command: 'npm run lint', failed: false }, { command: 'npm test', failed: false }],
  });
  assert.deepEqual(report.evidence.check, { kind: 'test', passed: true, fail_then_pass: true });
  assert.match(report.reason, /last test passed after failing earlier/);
});

test('a report reveals no command, prompt or code', () => {
  const report = immediate({ checks: [{ command: 'API_KEY=hunter22 npm test -- secret/path.js', failed: false }] });
  assert.doesNotMatch(JSON.stringify(report), /hunter22|secret\/path|npm test/);
});

test('a reuse that cannot be judged is exposure only, without the unused penalty', () => {
  const report = immediate({ applied: 'unknown' });
  assert.deepEqual(report.evidence, { tier: 'none', applied: 'partial', stage: 'immediate' });
  assert.match(report.reason, /applied: unknown/);
  assert.equal(immediate({ applied: 'unknown', checks: [{ command: 'npm test', failed: false }] }).evidence.tier, 'none');
});

test('a correction or approval follow-up is L3 under the turn task id plus :correction', () => {
  const reuse = reportedReuseOf(immediate());
  assert.deepEqual(correctionReportOf(reuse, 'correction'), {
    asset_id: 'sha256:a',
    outcome: 'failed',
    task_id: 'workbuddy:s1:4:correction',
    reason: "The person's next prompt read as correction of the turn that reused this strategy.",
    evidence: { tier: 'L3', applied: 'used', stage: 'correction' },
  });
  assert.equal(correctionReportOf(reuse, 'praise').outcome, 'success');
  assert.equal(correctionReportOf(reuse, null), null);
});

test('kept or reverted edits are an L2 follow-up under :retention; anything else sends nothing', () => {
  const reuse = reportedReuseOf(immediate({ applied: 'partial' }));
  const kept = retentionReportOf(reuse, 'kept');
  assert.equal(kept.task_id, 'workbuddy:s1:4:retention');
  assert.equal(kept.outcome, 'success');
  assert.deepEqual(kept.evidence, { tier: 'L2', applied: 'partial', stage: 'retention' });
  assert.equal(retentionReportOf(reuse, 'reverted').outcome, 'failed');
  assert.equal(retentionReportOf(reuse, 'rewritten'), null);
  assert.equal(retentionReportOf(reuse, 'no_change'), null);
});

test('queued reports go to the Proxy until one is taken, then never again', async () => {
  const report = verified();
  const down = proxy(new Error('ECONNREFUSED'));
  const retried = await deliverPending(down.post, queuedOne(report), NOW);
  assert.deepEqual(down.posts, [report]);
  assert.equal(Object.values(retried)[0].sentAt, undefined);

  const up = proxy({ ok: true, status: 200, data: { recorded: true, eligible: true, counted: true, weight: 0.6, reuse_stats: {} } });
  const sent = await deliverPending(up.post, retried, NOW + 1);
  const [entry] = Object.values(sent);
  assert.equal(entry.sentAt, NOW + 1);
  assert.deepEqual(entry.receipt, { recorded: true, eligible: true, counted: true, weight: 0.6 });

  const after = proxy();
  await deliverPending(after.post, sent, NOW + 2);
  assert.equal(after.posts.length, 0);
});

test('a Proxy that answers without recording does not count as delivered', async () => {
  const outbox = await deliverPending(proxy({ ok: true, status: 200, data: { recorded: false } }).post, queuedOne(immediate()), NOW);
  assert.equal(Object.values(outbox)[0].sentAt, undefined);
  assert.equal(Object.values(outbox)[0].attempts, 1);
});

test('a report the Hub already holds counts as delivered and is not retried', async () => {
  const outbox = await deliverPending(proxy({ ok: true, status: 200, data: { recorded: false, reason: 'duplicate_report' } }).post, queuedOne(immediate()), NOW);
  assert.equal(Object.values(outbox)[0].sentAt, NOW);
  assert.deepEqual(Object.values(outbox)[0].receipt, { recorded: false, reason: 'duplicate_report' });
});

for (const reason of ['daily_cap', 'same_owner']) {
  test(`a report the Hub judged ineligible (${reason}) is delivered and not retried`, async () => {
    const sink = proxy({ ok: true, status: 200, data: { recorded: true, eligible: false, reason } });
    const outbox = await deliverPending(sink.post, queuedOne(immediate()), NOW);
    assert.equal(Object.values(outbox)[0].sentAt, NOW);
    assert.equal(Object.values(outbox)[0].receipt.eligible, false);
    await deliverPending(sink.post, outbox, NOW + 1);
    assert.equal(sink.posts.length, 1);
  });
}

for (const answer of [
  { ok: true, status: 200, data: { recorded: false, terminal: true, reason: 'evidence.tier: Invalid input', status: 400 } },
  { ok: true, status: 200, data: { recorded: false, reason: 'hub 400' } },
  { ok: true, status: 200, data: { recorded: false, reason: 'hub 422: unprocessable' } },
  { ok: false, status: 400, data: { recorded: false, error: 'invalid_evidence' } },
]) {
  const label = answer.data.reason ?? answer.data.error;
  test(`a report that can never be accepted (${label}) is settled as rejected`, async () => {
    const sink = proxy(answer);
    const outbox = await deliverPending(sink.post, queuedOne(verified()), NOW);
    const [entry] = Object.values(outbox);
    assert.equal(entry.rejectedAt, NOW);
    assert.equal(entry.sentAt, undefined);
    assert.equal(entry.rejection.reason, label);
    await deliverPending(sink.post, outbox, NOW + 1);
    assert.equal(sink.posts.length, 1);
  });
}

for (const answer of [
  { ok: true, status: 200, data: { recorded: false, reason: 'hub 404' } },
  { ok: true, status: 200, data: { recorded: false, reason: 'hub 500' } },
  { ok: true, status: 200, data: { recorded: false, reason: 'hub 429', status: 429 } },
  { ok: true, status: 200, data: { recorded: false, reason: 'hub 401' } },
  { ok: false, status: 401, data: { error: 'unauthorized' } },
  { ok: false, status: 404, data: {} },
  new Error('The operation was aborted due to timeout'),
]) {
  test(`a failure that may pass later (${answer.data?.reason ?? answer.status ?? answer.message}) is retried`, async () => {
    const sink = proxy(answer);
    const outbox = await deliverPending(sink.post, queuedOne(verified()), NOW);
    assert.equal(Object.values(outbox)[0].rejectedAt, undefined);
    assert.equal(Object.values(outbox)[0].sentAt, undefined);
    await deliverPending(sink.post, outbox, NOW + 1);
    assert.equal(sink.posts.length, 2);
  });
}

test('a terminal answer is a rejection whatever its HTTP status', () => {
  assert.deepEqual(deliveryOf({ ok: false, status: 422, data: { recorded: false, terminal: true, reason: 'hub 422 invalid report' } }), {
    verdict: 'rejected', reason: 'hub 422 invalid report', status: 422,
  });
});

test('a terminal flag on a server error is retried, not rejected', () => {
  assert.deepEqual(deliveryOf({ ok: false, status: 503, data: { terminal: true, reason: 'hub 503' } }), { verdict: 'retry' });
  assert.deepEqual(deliveryOf({ ok: true, status: 200, data: { recorded: false, terminal: true, reason: 'hub 502', status: 502 } }), { verdict: 'retry' });
});

test('an answer that does not say it recorded the report is retried', () => {
  for (const data of [undefined, {}, { raw: '<html>' }, { recorded: 'yes' }]) {
    assert.deepEqual(deliveryOf({ ok: true, status: 200, data }), { verdict: 'retry' }, JSON.stringify(data));
  }
});

test('the status a newer Proxy passes through is kept with the rejection', () => {
  assert.deepEqual(deliveryOf({ ok: true, status: 200, data: { recorded: false, terminal: true, reason: 'bad evidence', status: 400 } }), {
    verdict: 'rejected', reason: 'bad evidence', status: 400,
  });
});
