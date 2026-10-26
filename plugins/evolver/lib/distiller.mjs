import {
  claimCandidate, claimLeftoverCandidates, distillCandidate, dueCandidates, isCurrentCandidate, settleCandidate,
} from './session-distill.mjs';

export const DISTILL_TIMEOUT_MS = 120_000;
const WATCH_MS = 1_000;

// Each hook is its own process, so a correction cannot reach a distillation running in the worker; the
// worker watches the candidate file instead and stops once the candidate it distills is gone or replaced.
function watchCandidate(isCurrent, watchMs) {
  const controller = new AbortController();
  const timer = setInterval(() => {
    if (!isCurrent()) controller.abort();
  }, watchMs);
  timer.unref?.();
  return { signal: controller.signal, stop: () => clearInterval(timer) };
}

/**
 * Session-end distillation through `complete`, the host's headless model. A candidate stays on disk until
 * distilled (or given up), and one whose session is over — ended, or killed with its host process — is
 * claimed and distilled by whichever worker the next hook starts.
 */
export function createDistiller({ proxyFetch, complete, timeoutMs = DISTILL_TIMEOUT_MS, watchMs = WATCH_MS }) {
  const run = async ({ sessionId, candidate }, focus) => {
    const isCurrent = () => isCurrentCandidate(sessionId, candidate);
    const watch = watchCandidate(isCurrent, watchMs);
    try {
      const outcome = await distillCandidate({ proxyFetch, complete, candidate, focus, timeoutMs, cancel: watch.signal, isCurrent });
      settleCandidate(sessionId, candidate, { sent: outcome.status === 'sent' });
      return outcome;
    } finally {
      watch.stop();
    }
  };
  return {
    async distillSession(sessionId, focus = '') {
      if (dueCandidates({ sessionId }).length === 0) return { status: 'nothing' };
      const own = claimCandidate(sessionId);
      return own ? run(own, focus) : { status: 'failed', error: 'another process is distilling this candidate' };
    },
    async distillLeftovers() {
      const outcomes = [];
      for (const due of claimLeftoverCandidates()) outcomes.push(await run(due));
      return outcomes;
    },
  };
}
