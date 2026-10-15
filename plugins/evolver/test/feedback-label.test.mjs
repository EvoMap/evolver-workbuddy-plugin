import assert from 'node:assert/strict';
import { test } from 'node:test';

import { feedbackLabelOf } from '../lib/feedback-label.mjs';

test('a prompt saying the last answer did not hold labels it a correction', () => {
  for (const text of ['still failing', "that didn't work", '还是报错', '不对，重来']) assert.equal(feedbackLabelOf(text), 'correction', text);
});

test('thanks and confirmations label it praise', () => {
  for (const text of ['thanks, works now', 'Perfect', '好了，谢谢', '可以了']) assert.equal(feedbackLabelOf(text), 'praise', text);
});

test('a correction wins over politeness', () => {
  assert.equal(feedbackLabelOf("thanks, but it still doesn't work"), 'correction');
});

test('a new request carries no label', () => {
  for (const text of ['now add a logout button', '这个行不行？', '', undefined]) assert.equal(feedbackLabelOf(text), null, String(text));
});
