import { execFile } from 'node:child_process';

import { managedEnginePath, windowsQuoted } from './engine-runtime.mjs';
import { MIN_EVOLVER_VERSION } from './engine-version.mjs';

const OUTPUT_MAX_CHARS = 4_000;
const CLI_TIMEOUT_MS = 10 * 60 * 1000;
const KILL_GRACE_MS = 5_000;
const IS_WINDOWS = process.platform === 'win32';
// The fallback runs whatever npm resolves, so it is held to the range this plugin is built against.
const CLI_PACKAGE = `@evomap/evolver@^${MIN_EVOLVER_VERSION}`;

export const success = (text) => ({ kind: 'success', text });
export const failure = (text) => ({ kind: 'error', text });

export function shown(value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  return text.length > OUTPUT_MAX_CHARS ? `${text.slice(0, OUTPUT_MAX_CHARS)}\n…` : text;
}

/**
 * Quotes group words the way a shell would (`--summary="two words"` stays one argument) and a backslash
 * escapes the character after it, so a quote can be part of a value; nothing else is expanded.
 */
export function argumentsOf(rawInput) {
  const args = [];
  let current = '';
  let quote = null;
  let started = false;
  let escaped = false;
  for (const char of rawInput) {
    if (escaped) {
      current += char;
      escaped = false;
    } else if (char === '\\' && quote !== "'") {
      escaped = true;
      started = true;
    } else if (quote) {
      if (char === quote) quote = null;
      else current += char;
    } else if (char === '"' || char === "'") {
      quote = char;
      started = true;
    } else if (/\s/.test(char)) {
      if (started) args.push(current);
      current = '';
      started = false;
    } else {
      current += char;
      started = true;
    }
  }
  if (started) args.push(current);
  return args;
}

// The CLI starts the Proxy and workers of its own, so a timed-out run takes down the whole process group it
// leads rather than only the process this plugin started. Windows has no group to signal.
function endTree(child) {
  const target = IS_WINDOWS ? child.pid : -child.pid;
  const signalTree = (name) => {
    try {
      process.kill(target, name);
    } catch {
    }
  };
  signalTree('SIGTERM');
  setTimeout(() => signalTree('SIGKILL'), KILL_GRACE_MS).unref?.();
}

// npm's `evolver` and `npx` are .cmd shims on Windows, which only start through a shell.
function execute(file, args) {
  const shell = IS_WINDOWS && file !== process.execPath;
  return new Promise((resolve) => {
    const child = execFile(file, shell ? args.map(windowsQuoted) : args, { maxBuffer: 16 * 1024 * 1024, detached: !IS_WINDOWS, shell, windowsHide: true },
      (error, stdout, stderr) => {
        clearTimeout(timer);
        resolve({ error, output: `${stdout ?? ''}${stderr ? `\n${stderr}` : ''}`.trim() });
      });
    const timer = setTimeout(() => endTree(child), CLI_TIMEOUT_MS);
    timer.unref?.();
  });
}

const isMissing = (error, output) => error?.code === 'ENOENT' || (IS_WINDOWS && /is not recognized/i.test(output));

/** The engine this plugin installed when there is one, else the installed `evolver`, else the published package through npx. */
export async function runEvolverCli(args, { run = execute, managedEngine = managedEnginePath } = {}) {
  const managed = managedEngine();
  let { error, output } = managed ? await run(process.execPath, [managed, ...args]) : await run('evolver', args);
  if (!managed && isMissing(error, output)) ({ error, output } = await run('npx', ['-y', CLI_PACKAGE, ...args]));
  return error ? failure(shown(output || String(error.message))) : success(shown(output || 'done'));
}
