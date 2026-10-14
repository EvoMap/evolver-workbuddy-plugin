#!/usr/bin/env node
import { DRAIN_TASK, startInBackground } from '../lib/background.mjs';
import { feedbackLabelOf } from '../lib/feedback-label.mjs';
import { runHook } from '../lib/hook-io.mjs';
import { withInjected } from '../lib/injected-ledger.mjs';
import { proxyConnection, proxyRequest } from '../lib/proxy-client.mjs';
import { withoutSecrets } from '../lib/redact.mjs';
import { queueReports } from '../lib/report-queue.mjs';
import { correctionReportOf } from '../lib/reuse.mjs';
import { readSession, writeSession } from '../lib/session-state.mjs';
import { bestStrategy, formatStrategy, recalledAssets } from '../lib/strategy-recall.mjs';
import { transcriptSize } from '../lib/transcript.mjs';

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

function reportFollowUp(sessionId, session, prompt) {
  if (session.labelable.length === 0) return;
  const label = feedbackLabelOf(prompt);
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

function startTurn(sessionId, input, previous) {
  const session = { ...previous, turn: previous.turn + 1, turnStartOffset: transcriptSize(input.transcript_path), labelable: [] };
  writeSession(sessionId, session);
  return session;
}

async function recallContext(input) {
  const prompt = typeof input.prompt === 'string' ? input.prompt.trim() : '';
  const sessionId = typeof input.session_id === 'string' ? input.session_id : '';
  if (!sessionId) return '';

  const previous = readSession(sessionId);
  reportFollowUp(sessionId, previous, prompt);
  const session = startTurn(sessionId, input, previous);

  const text = withoutSecrets(prompt).slice(0, PROMPT_MAX_CHARS);
  if (!isWorthRecalling(text)) return '';
  const match = bestStrategy(await recallByText(text), new Set(Object.keys(session.injected)));
  if (!match) return '';

  const injection = formatStrategy(match);
  const injected = withInjected(session.injected, match.asset.asset_id, { turn: session.turn, strategyText: injection }, Date.now());
  writeSession(sessionId, { ...session, injected });
  return injection;
}

runHook('UserPromptSubmit', recallContext);
