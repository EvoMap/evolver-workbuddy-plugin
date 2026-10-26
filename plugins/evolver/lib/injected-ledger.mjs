import fs from 'node:fs';
import path from 'node:path';

import { hostPid, ownerIsGone } from './process-owner.mjs';
import { SESSION_PREFIX, updateSession } from './session-state.mjs';
import { stateDir, updateState } from './state-file.mjs';

const ENTRY_PRUNE_MS = 7 * 24 * 60 * 60 * 1000;

function pruned(ledger, now) {
  return Object.fromEntries(Object.entries(ledger ?? {}).filter(([, entry]) => {
    const at = Number(entry?.injectedAt);
    return Number.isFinite(at) && now - at <= ENTRY_PRUNE_MS;
  }));
}

/**
 * Every entry in a ledger belongs to the session it is named after, so each injection also stamps the
 * entries already there with the live owner: an entry written before this version, or by the host process a
 * resumed session ran in, would otherwise read as an unclaimable or orphaned one.
 */
const owned = (ledger, sessionId, pid) =>
  Object.fromEntries(Object.entries(ledger).map(([id, entry]) => [id, { ...entry, sessionId, pid }]));

export function withInjected(ledger, assetId, { turn, strategyText, sessionId, pid }, now) {
  const kept = owned(pruned(ledger, now), sessionId, pid);
  if (kept[assetId]) return kept;
  return { ...kept, [assetId]: { turn, injectedAt: now, strategyText, sessionId, pid } };
}

const unreportedEntry = ([assetId, entry]) => ({ assetId, strategyText: entry.strategyText ?? '', turn: entry.turn, sessionId: entry.sessionId });

export function unreportedOf(ledger, turn) {
  return Object.entries(ledger ?? {})
    .filter(([, entry]) => !entry?.reportedAt && Number(entry?.turn) <= turn)
    .map(unreportedEntry);
}

export function withReported(ledger, assetIds, now) {
  const kept = pruned(ledger, now);
  for (const assetId of assetIds) if (kept[assetId]) kept[assetId] = { ...kept[assetId], reportedAt: now };
  return kept;
}

/** Records an injection in the session's ledger; false when the asset was already injected into this session. */
export function rememberInjected(sessionId, assetId, injection, now = Date.now(), pid = hostPid()) {
  if (!sessionId) return false;
  let added = false;
  updateSession(sessionId, (session) => {
    added = !session.injected[assetId];
    return { ...session, injected: withInjected(session.injected, assetId, { ...injection, sessionId, pid }, now) };
  });
  return added;
}

export function takeUnreported(sessionId, turn, now = Date.now()) {
  if (!sessionId) return [];
  let due = [];
  updateSession(sessionId, (session) => {
    due = unreportedOf(session.injected, turn);
    return due.length > 0 ? { ...session, injected: withReported(session.injected, due.map((asset) => asset.assetId), now) } : undefined;
  });
  return due;
}

/**
 * Injections no turn end ever reported, from sessions whose host process is gone: a host killed mid-turn
 * leaves them behind. They are taken, marked reported and returned for an aborted report. A session that is
 * merely idle keeps its open injections.
 */
export function takeOrphanedUnreported({ isGone = ownerIsGone, now = Date.now() } = {}) {
  let files = [];
  try {
    files = fs.readdirSync(stateDir()).filter((file) => file.startsWith(`${SESSION_PREFIX}-`) && file.endsWith('.json'));
  } catch {
    return [];
  }
  const orphaned = [];
  for (const file of files) {
    updateState(path.join(stateDir(), file), {}, (session) => {
      const due = Object.entries(session.injected ?? {})
        .filter(([, entry]) => !entry?.reportedAt && entry?.sessionId && isGone(entry.pid))
        .map(unreportedEntry);
      if (due.length === 0) return undefined;
      orphaned.push(...due);
      return { ...session, injected: withReported(session.injected, due.map((asset) => asset.assetId), now) };
    });
  }
  return orphaned;
}
