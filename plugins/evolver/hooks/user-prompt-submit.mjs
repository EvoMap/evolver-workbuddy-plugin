#!/usr/bin/env node
import { DRAIN_TASK, startInBackground } from '../lib/background.mjs';
import { isEvolverCommand } from '../lib/command-turn.mjs';
import { feedbackLabelOf } from '../lib/feedback-label.mjs';
import { runHook } from '../lib/hook-io.mjs';
import { rememberInjected } from '../lib/injected-ledger.mjs';
import { proxyConnection, proxyRequest } from '../lib/proxy-client.mjs';
import { withoutSecrets } from '../lib/redact.mjs';
import { queueReports } from '../lib/report-queue.mjs';
import { correctionReportOf } from '../lib/reuse.mjs';
import { dropCandidate } from '../lib/session-distill.mjs';
import { readSession, updateSession } from '../lib/session-state.mjs';
import { bestStrategy, formatStrategy, recalledAssets } from '../lib/strategy-recall.mjs';
import { transcriptMark } from '../lib/transcript.mjs';

const MIN_PROMPT_CHARS = 8;
const PROMPT_MAX_CHARS = 400;
const RECALL_TIMEOUT_MS = 5000;

const ACKNOWLEDGEMENT =
  /^(ok|okay|yes|no|y|n|go|lgtm|thanks?|thx|continue|next|好|好的|行|可以|嗯|对|是|是的|继续|谢谢|收到|没问题)[\s.!。！~]*$/i;

function isWorthRecalling(prompt) {
  if (prompt.startsWith('/')) return false;
  if (ACKNOWLEDGEMENT.test(prompt)) return false;
  return [...prompt].length >= MIN_PROMPT_CHARS;
}

function reportFollowUp(sessionId, session, label) {
  if (session.labelable.length === 0) return;
  const reports = session.labelable.map((reuse) => correctionReportOf(reuse, label)).filter(Boolean);
  if (reports.length === 0) return;
  queueReports(reports.map((report) => ({ report, sessionId })));
  startInBackground([DRAIN_TASK]);
}

async function recallByText(text) {
  const body = await proxyRequest(proxyConnection(), 'POST', '/asset/fetch', {
    body: { text },
    timeoutMs: RECALL_TIMEOUT_MS
  });
  return recalledAssets(body);
}

// A command turn leaves the last real turn's reuses to be labelled by the next real prompt.
function startTurn(sessionId, input, prompt, isCommand) {
  const turnStart = transcriptMark(input.transcript_path);
  return updateSession(sessionId, (session) => ({
    ...session,
    turn: session.turn + 1,
    turnStart,
    labelable: isCommand ? session.labelable : [],
    prompt: withoutSecrets(prompt),
  }));
}

async function recallContext(input) {
  const prompt = typeof input.prompt === 'string' ? input.prompt.trim() : '';
  const sessionId = typeof input.session_id === 'string' ? input.session_id : '';
  if (!sessionId) return '';

  // The next prompt is the only verdict on a turn available without asking anyone: when it reads as a
  // correction, the reuse reports are revised and the turn is no longer worth distilling.
  const isCommand = isEvolverCommand(prompt);
  if (!isCommand) {
    const label = feedbackLabelOf(prompt);
    if (label === 'correction') dropCandidate(sessionId);
    reportFollowUp(sessionId, readSession(sessionId), label);
  }
  const session = startTurn(sessionId, input, prompt, isCommand);

  const text = withoutSecrets(prompt).slice(0, PROMPT_MAX_CHARS);
  if (isCommand || !isWorthRecalling(text)) return '';
  const match = bestStrategy(await recallByText(text), new Set(Object.keys(session.injected)));
  if (!match) return '';

  const injection = formatStrategy(match);
  return rememberInjected(sessionId, match.asset.asset_id, { turn: session.turn, strategyText: injection }) ? injection : '';
}

runHook('UserPromptSubmit', recallContext);
