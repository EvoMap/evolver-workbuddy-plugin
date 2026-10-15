import { isSetupDue, prepareEngine, setupErrorOutcome } from './engine-setup.mjs';
import { readEngineState, writeEngineState } from './engine-state.mjs';
import { withLock } from './state-file.mjs';

const LOCK_REFRESH_MS = 30 * 1000;

export function setUpEngine(runtime) {
  return withLock('engine', async (lock) => {
    const previous = readEngineState();
    if (!isSetupDue(previous, runtime.now())) return;
    const refresh = setInterval(() => lock.refresh(), LOCK_REFRESH_MS);
    try {
      writeEngineState(await prepareEngine(runtime, previous));
    } catch (error) {
      writeEngineState(setupErrorOutcome(error, previous, runtime.now()));
    } finally {
      clearInterval(refresh);
    }
  });
}
