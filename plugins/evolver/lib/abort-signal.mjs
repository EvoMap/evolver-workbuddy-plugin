// AbortSignal.any arrived in Node.js 20.3; the hooks still run on 18.
export function eitherSignal(signals) {
  if (AbortSignal.any) return AbortSignal.any(signals);
  const controller = new AbortController();
  for (const signal of signals) {
    if (signal.aborted) controller.abort(signal.reason);
    else signal.addEventListener('abort', () => controller.abort(signal.reason), { once: true });
  }
  return controller.signal;
}
