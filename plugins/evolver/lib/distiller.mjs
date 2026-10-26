import {
  argumentsOf, claimCandidate, claimLeftoverCandidates, declineOf, distillBody, distillCandidate, dueCandidates,
  isCurrentCandidate, isSettled, needsAgentModel, settleCandidate, storedOutcomeOf,
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
 * claimed and distilled by whichever worker the next hook starts. With `countModelFailures` off, a try the
 * headless model failed leaves the candidate's tries as they were, for the agent's own model to distill it.
 */
export function createDistiller({ proxyFetch, complete, timeoutMs = DISTILL_TIMEOUT_MS, watchMs = WATCH_MS, countModelFailures = true }) {
  const run = async ({ sessionId, candidate }, focus) => {
    const isCurrent = () => isCurrentCandidate(sessionId, candidate);
    const watch = watchCandidate(isCurrent, watchMs);
    try {
      const outcome = await distillCandidate({ proxyFetch, complete, candidate, focus, timeoutMs, cancel: watch.signal, isCurrent });
      const counted = countModelFailures || !needsAgentModel(outcome);
      settleCandidate(sessionId, candidate, { done: isSettled(outcome), counted });
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
    /**
     * Sends the Gene the agent's own model wrote for the candidate stamped `writtenFor`, or drops that candidate
     * when the agent judged it not worth one; a failed send costs no try, and a Gene written for a candidate
     * that has since been replaced is not sent.
     */
    async postGene(sessionId, text, writtenFor) {
      const declined = declineOf(text);
      const args = declined ? null : argumentsOf(text);
      if (!declined && !args) return { status: 'unparsed' };
      const own = claimCandidate(sessionId);
      if (!own) return dueCandidates({ sessionId }).length === 0 ? { status: 'nothing' } : { status: 'failed', error: 'another process is distilling this candidate' };
      if (own.candidate.at !== writtenFor) {
        settleCandidate(sessionId, own.candidate, { done: false, counted: false });
        return { status: 'dropped' };
      }
      const outcome = declined
        ? { status: 'declined', reason: declined }
        : storedOutcomeOf(await proxyFetch('POST', '/conversation/distill', distillBody(own.candidate, args), AbortSignal.timeout(timeoutMs)));
      settleCandidate(sessionId, own.candidate, { done: isSettled(outcome), counted: false });
      return outcome;
    },
    async distillLeftovers() {
      const outcomes = [];
      for (const due of claimLeftoverCandidates()) outcomes.push(await run(due));
      return outcomes;
    },
  };
}
