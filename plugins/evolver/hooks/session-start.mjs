#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { DRAIN_TASK, ENGINE_TASK, startInBackground } from '../lib/background.mjs';
import { engineNoticeOf, isFailure } from '../lib/engine-notice.mjs';
import { isSetupDue } from '../lib/engine-setup.mjs';
import { isAnnounced, markAnnounced, readEngineState } from '../lib/engine-state.mjs';
import { meetsMinimum } from '../lib/engine-version.mjs';
import { runHook } from '../lib/hook-io.mjs';
import { projectDirOf } from '../lib/project-dir.mjs';
import { proxyConnection, proxyStatus } from '../lib/proxy-client.mjs';
import { queueReports } from '../lib/report-queue.mjs';
import { retentionReportsOf, takeDueRetentions } from '../lib/retention-pending.mjs';

const RUNNING_NOTE =
  '[Evolver] The local Evolver Proxy is running, so the evolver_* MCP tools are live. ' +
  'For clear error text, repeated workflows, or substantial tasks, call evolver_recipe_search ' +
  'with the task or error text first; fall back to evolver_search_assets when no Recipe fits.';

function pendingClaimUrl() {
  try {
    const url = readFileSync(join(homedir(), '.evomap', 'claim_url'), 'utf8').trim();
    return /^https?:\/\//.test(url) ? url : null;
  } catch {
    return null;
  }
}

function queueRetentionReports(sessionId, projectDir) {
  if (!sessionId) return;
  queueReports(takeDueRetentions({ sessionId, projectDir }).flatMap(retentionReportsOf));
}

function proxyNote({ isRunning, isStarting, url, outcome }) {
  if (isRunning) return RUNNING_NOTE;
  if (isStarting) {
    return `[Evolver] The local Evolver Proxy is not reachable at ${url} yet. This plugin is installing or starting Evolver ` +
      'in the background, so evolver_* MCP tools may fail for the next minute; /evolver-status shows how it went.';
  }
  return engineNoticeOf(outcome) ?? `[Evolver] The local Evolver Proxy is not reachable at ${url}; run /evolver-status to diagnose.`;
}

function engineChangeNote(outcome) {
  if (!outcome || isFailure(outcome) || isAnnounced(outcome)) return null;
  markAnnounced(outcome);
  return engineNoticeOf(outcome);
}

async function sessionContext(input) {
  const connection = proxyConnection();
  const isRunning = Boolean(await proxyStatus(connection));
  const outcome = readEngineState();
  const needsEngine = !isRunning || !meetsMinimum(connection.version);
  const isStarting = needsEngine && isSetupDue(outcome, Date.now());

  queueRetentionReports(input.session_id, projectDirOf(input));
  startInBackground([...(isStarting ? [ENGINE_TASK] : []), DRAIN_TASK]);

  const claimUrl = pendingClaimUrl();
  return [
    proxyNote({ isRunning, isStarting, url: connection.url, outcome }),
    isRunning && engineChangeNote(outcome),
    claimUrl && '[Evolver] This node is registered but not yet claimed on evomap.ai. Local memory works regardless. ' +
      `Only if the user asks about network features, tell them to open ${claimUrl} while signed in to evomap.ai.`
  ].filter(Boolean).join('\n\n');
}

runHook('SessionStart', sessionContext);
