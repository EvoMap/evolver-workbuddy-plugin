#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { engineDir } from '../lib/engine-runtime.mjs';
import { engineNoticeOf } from '../lib/engine-notice.mjs';
import { readEngineState } from '../lib/engine-state.mjs';
import { MIN_EVOLVER_VERSION } from '../lib/engine-version.mjs';
import { proxyConnection, proxyStatus } from '../lib/proxy-client.mjs';
import { outboxPath } from '../lib/report-queue.mjs';
import { readState } from '../lib/state-file.mjs';

const RECENT_REPORTS = 5;

function line(mark, label, value) {
  console.log(`${mark} ${label}: ${value}`);
}

function at(ms) {
  return ms ? new Date(ms).toISOString() : '(never)';
}

function printEngine(outcome) {
  line('INFO', 'Required Evolver', `${MIN_EVOLVER_VERSION} or newer`);
  line('INFO', 'Plugin-managed install', engineDir());
  if (!outcome) {
    line('INFO', 'Engine setup', 'not run yet; it runs in the background at the next session start');
    return;
  }
  const mark = outcome.failures > 0 ? 'FAIL' : 'OK';
  line(mark, 'Engine setup', `${outcome.status} at ${at(outcome.at)}${outcome.version ? `, Evolver ${outcome.version} (${outcome.source})` : ''}`);
  const notice = engineNoticeOf(outcome);
  if (notice) console.log(`     ${notice.replace(/^\[Evolver\] /, '')}`);
}

function receiptPhrase(receipt = {}) {
  const parts = [];
  if (receipt.eligible !== undefined) parts.push(`eligible=${receipt.eligible}`);
  if (receipt.counted !== undefined) parts.push(`counted=${receipt.counted}`);
  if (receipt.weight !== undefined) parts.push(`weight=${receipt.weight}`);
  if (receipt.reason) parts.push(`reason=${receipt.reason}`);
  return parts.length > 0 ? parts.join(' ') : 'recorded';
}

function printReports() {
  const entries = Object.values(readState(outboxPath(), {}));
  const pending = entries.filter((entry) => !entry.sentAt && !entry.rejectedAt);
  const delivered = entries.filter((entry) => entry.sentAt).sort((a, b) => b.sentAt - a.sentAt).slice(0, RECENT_REPORTS);
  const rejected = entries.filter((entry) => entry.rejectedAt).sort((a, b) => b.rejectedAt - a.rejectedAt).slice(0, RECENT_REPORTS);
  line('INFO', 'Reuse reports', `${pending.length} waiting, ${delivered.length ? 'recent deliveries below' : 'none delivered yet'}`);
  for (const entry of delivered) {
    console.log(`     sent ${at(entry.sentAt)} ${entry.report.task_id} ${entry.report.asset_id} tier=${entry.report.evidence.tier} ${receiptPhrase(entry.receipt)}`);
  }
  for (const entry of rejected) {
    const { reason, status } = entry.rejection ?? {};
    console.log(`     REJECTED ${at(entry.rejectedAt)} ${entry.report.task_id} ${entry.report.asset_id} reason=${reason}${status ? ` status=${status}` : ''}`);
  }
}

function printClaim() {
  const claimUrlPath = path.join(os.homedir(), '.evomap', 'claim_url');
  if (!fs.existsSync(claimUrlPath)) {
    console.log('INFO Network: local memory works with zero config; no pending claim link.');
    return;
  }
  console.log('INFO Network: node registered but NOT YET CLAIMED.');
  console.log('     To connect, sign in to https://evomap.ai and open this link:');
  console.log(`     ${fs.readFileSync(claimUrlPath, 'utf8').trim()}`);
  console.log("     That's the only step — no id or secret to find. Local memory works regardless.");
}

const connection = proxyConnection();
const running = await proxyStatus(connection);
console.log('Evolver WorkBuddy plugin status');
line('INFO', 'Node.js', process.version);
line(running ? 'OK' : 'MISSING', 'Proxy', running ? `running at ${connection.url}${connection.version ? `, Evolver ${connection.version}` : ''}` : `not reachable at ${connection.url}`);
printEngine(readEngineState());
printReports();
try {
  printClaim();
} catch {
  console.log('INFO Network: could not read claim state; local memory works regardless.');
}
