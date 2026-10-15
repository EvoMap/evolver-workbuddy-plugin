import assert from 'node:assert/strict';
import { test } from 'node:test';

import { verificationFailed } from '../lib/verification.mjs';

test('a summary that counts real failures beside zero errors still fails', () => {
  assert.equal(verificationFailed({ text: '1 failed, 0 errors' }), true);
  assert.equal(verificationFailed({ text: 'tests 3 | failed: 2 | errors: 0' }), true);
});

test('a passing summary that counts zero failures passes', () => {
  for (const text of ['ℹ tests 78\nℹ pass 78\nℹ fail 0', 'Tests: 0 failed, 12 passed', 'failures: 0\nerrors: 0', '✔ Validation passed']) {
    assert.equal(verificationFailed({ text }), false, text);
  }
});

test('a non-zero exit fails the verification', () => {
  assert.equal(verificationFailed({ isError: true, text: '' }), true);
});
