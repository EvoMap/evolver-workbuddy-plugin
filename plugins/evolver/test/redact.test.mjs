import assert from 'node:assert/strict';
import { test } from 'node:test';

import { withoutSecrets } from '../lib/redact.mjs';

test('environment-style names carrying a secret are redacted with their value', () => {
  for (const text of ['OPENAI_API_KEY=abcdef123456', 'MY_SECRET: hunter22hunter', 'export DB_PASSWORD="s3cr3t-value"', 'github-token=abcdefghij']) {
    const cleaned = withoutSecrets(text);
    assert.match(cleaned, /\[redacted\]/, text);
    assert.doesNotMatch(cleaned, /abcdef123456|hunter22hunter|s3cr3t-value|abcdefghij/, text);
  }
});

test('ordinary prose and short values are left alone', () => {
  for (const text of ['How do I rotate a token safely?', 'tokenizer: bpe', 'secret=abc']) assert.equal(withoutSecrets(text), text);
});
