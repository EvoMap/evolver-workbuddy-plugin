#!/usr/bin/env node
import { answer, commandInput } from '../lib/command-output.mjs';
import { createDistiller } from '../lib/distiller.mjs';
import { failure, shown, success } from '../lib/evolver-cli.mjs';
import { headlessModel } from '../lib/headless-model.mjs';
import { proxyFetch } from '../lib/proxy-client.mjs';

function verdictOf(outcome) {
  if (outcome.status === 'nothing') return failure('Nothing to distill yet: no turn of this session finished verified.');
  return outcome.status === 'sent' ? success(shown(outcome.data ?? 'distilled')) : failure(`Distillation ${outcome.status}: ${outcome.error ?? ''}`.trim());
}

// A command's shell carries the session it runs in; the hooks key the candidate by the same id.
const sessionId = process.env.CODEBUDDY_SESSION_ID || process.env.CLAUDE_SESSION_ID || '';
const focus = commandInput();
const outcome = sessionId ? await createDistiller({ proxyFetch, complete: headlessModel() }).distillSession(sessionId, focus) : { status: 'nothing' };
answer(verdictOf(outcome));
