const STDIN_WATCHDOG_MS = 1000;

function parsedInput(raw) {
  try {
    const input = JSON.parse(raw);
    return input && typeof input === 'object' ? input : {};
  } catch {
    return null;
  }
}

function emit(eventName, context) {
  const output = context ? { hookSpecificOutput: { hookEventName: eventName, additionalContext: context } } : {};
  process.stdout.write(JSON.stringify(output), () => process.exit(0));
}

// The host may never close stdin, so the hook proceeds on a watchdog once what
// arrived is a whole JSON payload (or nothing); a large payload still arriving
// is waited for, up to the hook's own timeout. Reading stdin to the end also
// keeps the host's writer from hitting EPIPE.
export function runHook(eventName, handle) {
  let buffer = '';
  let started = false;
  const start = async () => {
    if (started) return;
    started = true;
    try {
      emit(eventName, await handle(parsedInput(buffer) ?? {}));
    } catch {
      emit(eventName, '');
    }
  };
  const watchdog = () => {
    if (buffer.trim() === '' || parsedInput(buffer) !== null) start();
    else setTimeout(watchdog, STDIN_WATCHDOG_MS).unref();
  };
  setTimeout(watchdog, STDIN_WATCHDOG_MS).unref();
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => {
    buffer += chunk;
  });
  process.stdin.on('end', start);
  process.stdin.on('error', start);
  process.stdin.resume();
}
