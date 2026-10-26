import {
  argumentsOf, claimCandidate, claimLeftoverCandidates, distillBody, distillCandidate, dueCandidates, isCurrentCandidate,
  needsAgentModel, settleCandidate,
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
      settleCandidate(sessionId, candidate, { sent: outcome.status === 'sent', counted });
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
    /** Sends the Gene the agent's own model wrote for this session's candidate; a failed send costs no try. */
    async postGene(sessionId, text) {
      const args = argumentsOf(text);
      if (!args) return { status: 'unparsed' };
      const own = claimCandidate(sessionId);
      if (!own) return dueCandidates({ sessionId }).length === 0 ? { status: 'nothing' } : { status: 'failed', error: 'another process is distilling this candidate' };
      const result = await proxyFetch('POST', '/conversation/distill', distillBody(own.candidate, args), AbortSignal.timeout(timeoutMs));
      settleCandidate(sessionId, own.candidate, { sent: Boolean(result?.ok), counted: false });
      return result?.ok ? { status: 'sent', data: result.data } : { status: 'failed', error: String(result?.error) };
    },
    async distillLeftovers() {
      const outcomes = [];
      for (const due of claimLeftoverCandidates()) outcomes.push(await run(due));
      return outcomes;
    },
  };
}
