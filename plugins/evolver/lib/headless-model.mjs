import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const HEADLESS_MARKER = 'EVOLVER_HEADLESS';
const HEADLESS_ARGS = ['-p', '--tools', '', '--no-session-persistence', '--output-format', 'json', '--max-turns', '1'];
const MODEL_ID = /^[\w.:@/-]+$/;
const ERROR_MAX_CHARS = 300;
const BUNDLED_CLI = ['app.asar.unpacked', 'cli', 'bin', 'codebuddy'];

function bundledCandidates(env, platform) {
  if (platform === 'darwin') {
    const app = ['WorkBuddy.app', 'Contents', 'Resources', ...BUNDLED_CLI];
    return [path.join(os.homedir(), 'Applications', ...app), path.join('/Applications', ...app)];
  }
  if (platform === 'win32') {
    return [env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, 'Programs', 'WorkBuddy'), env.ProgramFiles && path.join(env.ProgramFiles, 'WorkBuddy')]
      .filter(Boolean)
      .map((dir) => path.join(dir, 'resources', ...BUNDLED_CLI));
  }
  return [];
}

// On Windows the `codebuddy` on PATH is an npm shell shim that cannot run without a shell.
function pathCandidates(env, platform) {
  if (platform === 'win32') return [];
  return String(env.PATH ?? '').split(path.delimiter).filter(Boolean).map((dir) => path.join(dir, 'codebuddy'));
}

/** The CodeBuddy CLI to run headless: the one bundled with WorkBuddy first, else one on PATH; null when none. */
export function codebuddyCli({ env = process.env, platform = process.platform, exists = fs.existsSync } = {}) {
  const file = [...bundledCandidates(env, platform), ...pathCandidates(env, platform)].find((candidate) => exists(candidate));
  if (!file) return null;
  return platform === 'win32' ? { command: process.execPath, args: [file] } : { command: file, args: [] };
}

function runCli({ command, args }, input, signal) {
  return new Promise((resolve, reject) => {
    // The headless run loads this plugin too; the marker keeps its hooks from recalling, reporting or
    // starting workers for the distillation's own session.
    const env = { ...process.env, [HEADLESS_MARKER]: '1' };
    const child = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, cwd: os.homedir(), env, signal });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr }));
    child.stdin.on('error', () => {});
    child.stdin.end(input);
  });
}

function usageOf(usage) {
  const inputTokens = usage?.input_tokens;
  const outputTokens = usage?.output_tokens;
  return Number.isFinite(inputTokens) && Number.isFinite(outputTokens) ? { inputTokens, outputTokens } : null;
}

function parsedJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * The answer and token usage of one `--output-format json` run. The CLI prints a single `result` object
 * (an array of events under --verbose); an error, or plain text such as "Authentication required", throws.
 */
export function completionOf({ stdout, stderr }) {
  const parsed = parsedJson(String(stdout ?? '').trim());
  const result = Array.isArray(parsed) ? parsed.findLast((event) => event?.type === 'result') : parsed;
  if (!result || result.is_error || typeof result.result !== 'string') {
    const detail = Array.isArray(result?.errors) ? result.errors.join('; ') : `${stdout ?? ''}${stderr ?? ''}`;
    throw new Error(`codebuddy gave no answer: ${String(detail).trim().slice(0, ERROR_MAX_CHARS) || 'empty output'}`);
  }
  return { answer: result.result, usage: usageOf(result.usage) };
}

const cliArgs = (model) => [...HEADLESS_ARGS, ...(MODEL_ID.test(model ?? '') ? ['--model', model] : [])];

/**
 * `complete(model, text, signal)` over the headless CodeBuddy CLI, the prompt on stdin, or null when there
 * is no CLI to run. Hooks have no model API of their own.
 */
export function headlessModel({ cli = codebuddyCli(), run = runCli } = {}) {
  if (!cli) return null;
  return async ({ model }, text, signal) =>
    completionOf(await run({ command: cli.command, args: [...cli.args, ...cliArgs(model)] }, text, signal));
}
