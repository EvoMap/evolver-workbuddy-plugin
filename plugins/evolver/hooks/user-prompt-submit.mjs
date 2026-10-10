#!/usr/bin/env node
/**
 * WorkBuddy / CodeBuddy UserPromptSubmit hook: recall one reusable strategy.
 *
 * Sends the user's prompt to Proxy `/asset/fetch` (text recall, no ids) and
 * injects the best asset's full strategy, at most once per asset per session.
 * Fails open: any error yields `{}` and never blocks the prompt.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { proxyConnection, proxyRequest } from './proxy-client.mjs';
import { bestStrategy, formatStrategy, recalledAssets } from './strategy-recall.mjs';

const MIN_PROMPT_CHARS = 8;
const PROMPT_MAX_CHARS = 400;
const RECALL_LIMIT = 5;
const RECALL_TIMEOUT_MS = 5000;
const SESSION_STATE_TTL_MS = 24 * 60 * 60 * 1000;
const STDIN_WATCHDOG_MS = 1000;

const ACKNOWLEDGEMENT =
  /^(ok|okay|yes|no|y|n|go|lgtm|thanks?|thx|continue|next|好|好的|行|可以|嗯|对|是|是的|继续|谢谢|收到|没问题)[\s.!。！~]*$/i;

function isWorthRecalling(prompt) {
  if (prompt.startsWith('/')) return false;
  if (ACKNOWLEDGEMENT.test(prompt)) return false;
  return [...prompt].length >= MIN_PROMPT_CHARS;
}

function stateFilePath() {
  const dir = process.env.CODEBUDDY_PLUGIN_DATA || join(homedir(), '.evolver', 'workbuddy-hooks');
  return { dir, file: join(dir, 'recall-state.json') };
}

function loadSessionState() {
  try {
    const state = JSON.parse(readFileSync(stateFilePath().file, 'utf8'));
    return state && typeof state === 'object' ? state : {};
  } catch {
    return {};
  }
}

function saveInjected(state, sessionId, assetId) {
  const now = Date.now();
  const previous = state[sessionId]?.injected || [];
  state[sessionId] = { injected: [...new Set([...previous, assetId])], at: now };
  for (const [id, entry] of Object.entries(state)) {
    if (!entry || now - entry.at > SESSION_STATE_TTL_MS) delete state[id];
  }
  try {
    const { dir, file } = stateFilePath();
    mkdirSync(dir, { recursive: true });
    writeFileSync(file, JSON.stringify(state));
  } catch {
    // Dedupe is best effort; a lost write only risks one repeat injection.
  }
}

async function recallByText(text) {
  const body = await proxyRequest(proxyConnection(), 'POST', '/asset/fetch', {
    body: { text, limit: RECALL_LIMIT },
    timeoutMs: RECALL_TIMEOUT_MS
  });
  return recalledAssets(body);
}

async function recallContext(input) {
  const prompt = typeof input?.prompt === 'string' ? input.prompt.trim().slice(0, PROMPT_MAX_CHARS) : '';
  const sessionId = typeof input?.session_id === 'string' ? input.session_id : '';
  if (!sessionId || !isWorthRecalling(prompt)) return '';

  const state = loadSessionState();
  const injectedIds = new Set(state[sessionId]?.injected || []);
  const match = bestStrategy(await recallByText(prompt), injectedIds);
  if (!match) return '';

  saveInjected(state, sessionId, match.asset.asset_id);
  return formatStrategy(match);
}

function emit(context) {
  const output = context
    ? { hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: context } }
    : {};
  process.stdout.write(JSON.stringify(output), () => process.exit(0));
}

async function run(raw) {
  try {
    emit(await recallContext(JSON.parse(raw)));
  } catch {
    emit('');
  }
}

let buffer = '';
let started = false;
const start = () => {
  if (started) return;
  started = true;
  run(buffer);
};
setTimeout(start, STDIN_WATCHDOG_MS).unref();
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buffer += chunk;
});
process.stdin.on('end', start);
process.stdin.on('error', start);
process.stdin.resume();
