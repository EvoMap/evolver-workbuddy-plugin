#!/usr/bin/env node
/**
 * WorkBuddy / CodeBuddy UserPromptSubmit hook: prompt-relevant Gene/Capsule recall.
 *
 * Runs on every user message, so every gate below exists to keep the cost at
 * zero tokens unless a hit is both relevant and new to this session. Fails
 * open: any error yields `{}` and never blocks the prompt.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { proxyConnection, proxyRequest } from './proxy-client.mjs';

const MIN_PROMPT_CHARS = 12;
const MAX_QUERY_CHARS = 200;
const SEARCH_LIMIT = 5;
const SEARCH_TIMEOUT_MS = 3000;
const MIN_SIMILARITY = 0.9;
const MAX_HITS = 2;
const SUMMARY_MAX_CHARS = 160;
const SESSION_STATE_TTL_MS = 24 * 60 * 60 * 1000;
const STDIN_WATCHDOG_MS = 1000;

const ACKNOWLEDGEMENT =
  /^(ok|okay|yes|no|y|n|go|lgtm|thanks?|thx|continue|next|好|好的|行|可以|嗯|对|是|是的|继续|谢谢|收到|没问题)[\s.!。！~]*$/i;

function isWorthSearching(prompt) {
  const text = prompt.trim();
  if (text.startsWith('/')) return false;
  if (ACKNOWLEDGEMENT.test(text)) return false;
  return [...text].length >= MIN_PROMPT_CHARS;
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

function saveInjected(state, sessionId, assetIds) {
  const now = Date.now();
  const previous = state[sessionId]?.injected || [];
  state[sessionId] = { injected: [...new Set([...previous, ...assetIds])], at: now };
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

async function searchAssets(prompt) {
  const text = prompt.trim().slice(0, MAX_QUERY_CHARS);
  // `text` is read by the v2 Proxy, `query` by the v1 Proxy; each ignores the other.
  const body = await proxyRequest(proxyConnection(), 'POST', '/asset/search', {
    body: { text, query: text, limit: SEARCH_LIMIT },
    timeoutMs: SEARCH_TIMEOUT_MS
  });
  return Array.isArray(body?.results) ? body.results : [];
}

function selectNewRelevantHits(results, alreadyInjected) {
  return results
    .filter((hit) => typeof hit?.asset_id === 'string' && Number(hit.similarity) >= MIN_SIMILARITY)
    .filter((hit) => !alreadyInjected.has(hit.asset_id))
    .sort((a, b) => Number(b.similarity) - Number(a.similarity))
    .slice(0, MAX_HITS);
}

function clip(text, max) {
  const value = String(text || '').replace(/\s+/g, ' ').trim();
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

function formatHits(hits) {
  const lines = hits.map((hit) => {
    const title = clip(hit.short_title || hit.local_id || hit.asset_type, 80);
    const summary = clip(hit.nl_summary || hit.trigger_text, SUMMARY_MAX_CHARS);
    return `- [${hit.asset_type}] ${title} (${hit.asset_id}): ${summary}`;
  });
  return [
    '[Evolver recall] Possibly relevant evolution assets for this request:',
    ...lines,
    'Use one only if it clearly fits: fetch it with evolver_fetch_asset first. Ignore otherwise; do not mention this note to the user.'
  ].join('\n');
}

async function recallContext(input) {
  const prompt = typeof input?.prompt === 'string' ? input.prompt : '';
  const sessionId = typeof input?.session_id === 'string' ? input.session_id : '';
  if (!sessionId || !isWorthSearching(prompt)) return '';

  const state = loadSessionState();
  const alreadyInjected = new Set(state[sessionId]?.injected || []);
  const hits = selectNewRelevantHits(await searchAssets(prompt), alreadyInjected);
  if (hits.length === 0) return '';

  saveInjected(state, sessionId, hits.map((hit) => hit.asset_id));
  return formatHits(hits);
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
