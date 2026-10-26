import fs from 'node:fs';
import path from 'node:path';

import { OUTBOX_TTL_MS } from './report-outbox.mjs';
import { appendStateLine, readState, sessionStatePath, stateDir, takeStateLines, updateState } from './state-file.mjs';

const SESSION_FILE = /^(?:session-[0-9a-f]{16}\.json|edits-[0-9a-f]{16}\.jsonl)$/;
export const SESSION_PREFIX = 'session';

const sessionPath = (sessionId) => sessionStatePath(SESSION_PREFIX, sessionId);
const withDefaults = (state) => ({ turn: 0, turnStart: null, injected: {}, labelable: [], ...state });
const editsPath = (sessionId) => sessionStatePath('edits', sessionId, 'jsonl');

export function readSession(sessionId) {
  return withDefaults(readState(sessionPath(sessionId), {}));
}

/** Changes a session's state under the state lock; `mutate` returns the next state, or undefined to keep it. */
export function updateSession(sessionId, mutate) {
  return updateState(sessionPath(sessionId), {}, (state) => mutate(withDefaults(state)));
}

export function noteFileBefore(sessionId, file, hash) {
  appendStateLine(editsPath(sessionId), { path: file, before: hash });
}

export function takeFilesBefore(sessionId) {
  const { lines, commit } = takeStateLines(editsPath(sessionId));
  const editedBefore = new Map();
  for (const { path: file, before } of lines) {
    if (typeof file === 'string' && !editedBefore.has(file)) editedBefore.set(file, before);
  }
  return { editedBefore, commit };
}

export function pruneOldSessions(now = Date.now()) {
  let names = [];
  try {
    names = fs.readdirSync(stateDir());
  } catch {
    return;
  }
  for (const name of names.filter((candidate) => SESSION_FILE.test(candidate))) {
    const file = path.join(stateDir(), name);
    try {
      if (now - fs.statSync(file).mtimeMs > OUTBOX_TTL_MS) fs.rmSync(file, { force: true });
    } catch {
    }
  }
}
