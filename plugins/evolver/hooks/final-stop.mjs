#!/usr/bin/env node
import { runHook } from '../lib/hook-io.mjs';
import { closeTurn, isMainSession } from '../lib/turn-end.mjs';

// FinalStop, unlike Stop, says how the turn ended and fires once a turn, after any Stop hook that asked the
// model to go on; the host defaults a missing reason to completed.
const REASON_KINDS = { completed: 'completed', interrupted: 'aborted', cancelled: 'aborted', failed: 'error' };

runHook('FinalStop', (input) => {
  if (isMainSession(input)) closeTurn(input, REASON_KINDS[input.final_stop_reason ?? 'completed'] ?? 'error');
  return '';
});
