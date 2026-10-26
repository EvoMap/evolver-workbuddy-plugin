#!/usr/bin/env node
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

import { answer, commandInput } from '../lib/command-output.mjs';
import { createDistiller } from '../lib/distiller.mjs';
import { failure, shown, success } from '../lib/evolver-cli.mjs';
import { headlessModel } from '../lib/headless-model.mjs';
import { proxyFetch } from '../lib/proxy-client.mjs';
import { distillPrompt, dueCandidates, needsAgentModel } from '../lib/session-distill.mjs';
import { stateDir } from '../lib/state-file.mjs';

const AGENT_MARK = 'EVOLVER: WRITE THE GENE YOURSELF';
const POST_FLAG = '--post';
const NOTHING = 'Nothing to distill yet: no turn of this session finished verified.';

const shellQuoted = (text) => `'${String(text).replaceAll("'", `'\\''`)}'`;

function headlessReason(outcome) {
  if (outcome.status === 'unparsed') return 'its answer held no Gene';
  return outcome.error ?? 'no CodeBuddy CLI or no model recorded for the turn';
}

// The headless CLI cannot sign in from inside the app, so the agent that ran the turn writes the Gene and
// hands it back to this script, which posts it for the candidate it was written for. The agent's shell carries
// neither the session nor the plugin data folder, so the command names both. The heredoc's end line is random,
// so text the turn's record steered into the Gene cannot end it early and run as shell.
function agentInstructions(sessionId, candidate, focus, outcome) {
  const script = fileURLToPath(import.meta.url);
  const geneEnd = `EVOLVER_GENE_${crypto.randomBytes(8).toString('hex')}`;
  return [
    AGENT_MARK,
    `The headless CodeBuddy model could not distill this session's latest verified turn (${headlessReason(outcome)}).`,
    'Write the Gene with your own model: answer the request below with the JSON object only, put it between the',
    'two marker lines of this command, run the command with your shell tool, and show the user what it prints.',
    '',
    `CODEBUDDY_SESSION_ID=${shellQuoted(sessionId)} CODEBUDDY_PLUGIN_DATA=${shellQuoted(stateDir())} node ${shellQuoted(script)} ${POST_FLAG} ${candidate.at} <<'${geneEnd}'`,
    '<the JSON object>',
    geneEnd,
    '',
    distillPrompt(candidate, focus),
  ].join('\n');
}

function draftNote(data) {
  const quality = data?.quality;
  return quality ? ` (quality ${quality.score}/${quality.threshold}${quality.reason ? `, ${quality.reason}` : ''})` : '';
}

function verdictOf(outcome) {
  if (outcome.status === 'nothing') return failure(NOTHING);
  if (outcome.status === 'declined') return success(`No Gene: the turn holds no method worth reusing (${outcome.reason}).`);
  if (outcome.status === 'draft') return failure(`The Proxy kept the Gene as a draft only and stored nothing${draftNote(outcome.data)}.`);
  if (outcome.status === 'unparsed') return failure('The Gene must be one JSON object with at least a "summary".');
  if (outcome.status === 'dropped') return failure('A newer turn replaced the one this Gene was written for; nothing was sent.');
  return outcome.status === 'sent' ? success(shown(outcome.data ?? 'distilled')) : failure(`Distillation ${outcome.status}: ${outcome.error ?? ''}`.trim());
}

async function distillNow(distiller, sessionId, focus) {
  const outcome = await distiller.distillSession(sessionId, focus);
  const due = dueCandidates({ sessionId })[0];
  return needsAgentModel(outcome) && due ? success(agentInstructions(sessionId, due.candidate, focus, outcome)) : verdictOf(outcome);
}

// A command's shell carries the session it runs in; the hooks key the candidate by the same id.
const sessionId = process.env.CODEBUDDY_SESSION_ID || process.env.CLAUDE_SESSION_ID || '';
const input = commandInput();
const distiller = createDistiller({ proxyFetch, complete: headlessModel(), countModelFailures: false });
if (!sessionId) answer(failure(NOTHING));
else if (process.argv.includes(POST_FLAG)) {
  const writtenFor = Number(process.argv[process.argv.indexOf(POST_FLAG) + 1]);
  answer(verdictOf(await distiller.postGene(sessionId, input, writtenFor)));
}
else answer(await distillNow(distiller, sessionId, input));
