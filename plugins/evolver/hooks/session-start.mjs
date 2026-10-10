#!/usr/bin/env node
/**
 * WorkBuddy / CodeBuddy SessionStart hook.
 *
 * Emits `hookSpecificOutput.additionalContext`, which the host appends to the
 * session context on startup, resume, clear, and compact. Fails open: any
 * error yields `{}` so a broken Evolver install never blocks a session.
 */

import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { proxyConnection, proxyRequest } from './proxy-client.mjs';

const PROXY_PROBE_TIMEOUT_MS = 1500;
const STDIN_WATCHDOG_MS = 1000;

async function isProxyRunning(connection) {
  try {
    const body = await proxyRequest(connection, 'GET', '/proxy/status', { timeoutMs: PROXY_PROBE_TIMEOUT_MS });
    return body?.status === 'running';
  } catch {
    return false;
  }
}

function pendingClaimUrl() {
  try {
    const url = readFileSync(join(homedir(), '.evomap', 'claim_url'), 'utf8').trim();
    return /^https?:\/\//.test(url) ? url : null;
  } catch {
    return null;
  }
}

async function sessionContext() {
  const connection = proxyConnection();
  const parts = [];

  if (await isProxyRunning(connection)) {
    parts.push(
      '[Evolver] The local Evolver Proxy is running, so the evolver_* MCP tools are live. ' +
        'For clear error text, repeated workflows, or substantial tasks, call evolver_recipe_search ' +
        'with the task or error text first; fall back to evolver_search_assets when no Recipe fits.'
    );
  } else {
    parts.push(
      `[Evolver] The local Evolver Proxy is not reachable at ${connection.url}, so evolver_* MCP tools ` +
        'will fail this session. Only if the user asks for Evolver, suggest running `evolver` once inside ' +
        'a git repo to start it, or /evolver-status to diagnose.'
    );
  }

  const claimUrl = pendingClaimUrl();
  if (claimUrl) {
    parts.push(
      '[Evolver] This node is registered but not yet claimed on evomap.ai. Local memory works regardless. ' +
        `Only if the user asks about network features, tell them to open ${claimUrl} while signed in to evomap.ai.`
    );
  }

  return parts.join('\n\n');
}

function emit(context) {
  const output = context
    ? { hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: context } }
    : {};
  process.stdout.write(JSON.stringify(output), () => process.exit(0));
}

async function run() {
  try {
    emit(await sessionContext());
  } catch {
    emit('');
  }
}

// The host pipes a JSON payload we don't need; drain it so the writer never
// hits EPIPE, and proceed on a watchdog in case stdin never closes.
let started = false;
const start = () => {
  if (started) return;
  started = true;
  run();
};
setTimeout(start, STDIN_WATCHDOG_MS).unref();
process.stdin.on('data', () => {});
process.stdin.on('end', start);
process.stdin.on('error', start);
process.stdin.resume();
