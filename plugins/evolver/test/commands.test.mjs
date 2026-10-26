import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { delimiter, dirname, join } from 'node:path';
import { afterEach, test } from 'node:test';

import { fakeProxy, pluginRoot, sandboxHome, writeProxySettings } from './helpers/sandbox.mjs';

const COMMANDS_DIR = join(pluginRoot, 'commands');
const INLINE = /!`([^`]+)`/g;
const posix = { skip: process.platform === 'win32' && 'the host runs inline commands through bash or PowerShell there' };

let sandbox;
let proxy;

afterEach(async () => {
  await proxy?.close();
  sandbox?.cleanup();
  sandbox = null;
  proxy = null;
});

const bodyOf = (name) => readFileSync(join(COMMANDS_DIR, name), 'utf8').replace(/^---\n[\s\S]*?\n---\n/, '');

// The host's own argument splitting: quotes group words and are dropped, so the command sees them joined by spaces.
function hostArguments(raw) {
  const args = [];
  let current = '';
  let quoted = false;
  let quote = '';
  for (const char of raw.trim()) {
    if (!quoted && (char === '"' || char === "'")) {
      quoted = true;
      quote = char;
    } else if (quoted && char === quote) {
      quoted = false;
      quote = '';
    } else if (!quoted && /\s/.test(char)) {
      if (current) args.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  if (current) args.push(current);
  return args;
}

function shell(command, env) {
  return new Promise((resolve) => {
    execFile('/bin/sh', ['-c', command], { env }, (error, stdout, stderr) => resolve((stdout || stderr || '').trim()));
  });
}

// What the host's custom command renderer does: load-time plugin root and data folder, $ARGUMENTS only when
// there are arguments, then every inline !`…` replaced by its output. The host's shell carries no plugin's data
// folder, so neither does this one.
async function rendered(name, raw, env) {
  const { CODEBUDDY_PLUGIN_DATA: data = '', ...shellEnv } = env;
  const args = hostArguments(raw);
  let text = bodyOf(name)
    .replace(/\$\{CODEBUDDY_PLUGIN_ROOT\}/g, pluginRoot.replace(/[\\/]$/, ''))
    .replace(/\$\{CODEBUDDY_PLUGIN_DATA\}/g, data);
  if (args.length > 0) text = `${text.replace(/\$ARGUMENTS\b/g, args.join(' '))}\n\n\nARGUMENTS: ${args.join(' ')}`;
  for (const [whole, command] of [...text.matchAll(INLINE)]) text = text.replace(whole, await shell(command.trim(), shellEnv));
  return text;
}

async function startSandbox() {
  sandbox = sandboxHome();
  sandbox.env = { ...sandbox.env, PATH: `${dirname(process.execPath)}${delimiter}${sandbox.env.PATH}` };
  proxy = await fakeProxy();
  writeProxySettings(sandbox.home, { url: proxy.url, version: '2.0.44' });
}

test('every command runs through an inline command the host executes, never a fenced block', () => {
  for (const name of readdirSync(COMMANDS_DIR)) {
    const body = bodyOf(name);
    assert.doesNotMatch(body, /```!/, name);
    for (const [, command] of body.matchAll(INLINE)) {
      const script = /scripts\/([\w-]+\.mjs)/.exec(command)?.[1];
      assert.ok(script && existsSync(join(pluginRoot, 'scripts', script)), `${name} runs a script that exists`);
    }
  }
  assert.doesNotMatch(bodyOf('evolver-status.md'), /argument-hint|\$ARGUMENTS/);
});

test('/evolver-search hands its text to the script on stdin and the shell runs nothing of it', posix, async () => {
  await startSandbox();
  const output = await rendered('evolver-search.md', `retry "flaky upload" with $(touch pwned) and it's`, sandbox.env);
  assert.deepEqual(proxy.searches, [{ text: "retry flaky upload with $(touch pwned) and its", limit: 5 }]);
  assert.match(output, /sha256:found/);
  assert.equal(existsSync(join(sandbox.home, 'pwned')), false);
});

test('a command without arguments gets none, though the host leaves $ARGUMENTS in place', posix, async () => {
  await startSandbox();
  assert.match(await rendered('evolver-search.md', '', sandbox.env), /Usage: \/evolver-search/);
  assert.match(await rendered('evolver-distill.md', '', { ...sandbox.env, CODEBUDDY_SESSION_ID: 's-none' }), /Nothing to distill yet/);
  assert.match(await rendered('evolver-status.md', '', sandbox.env), /Evolver WorkBuddy plugin status/);
});

test('a quoted argument line that closes the heredoc runs nothing after it', posix, async () => {
  await startSandbox();
  await rendered('evolver-search.md', `"retry\nEVOLVER_ARGUMENTS\ntouch \"$HOME/pwned\""`, sandbox.env);
  assert.equal(existsSync(join(sandbox.home, 'pwned')), false);
});

test('commands read the state the hooks keep in the plugin data folder', posix, async () => {
  await startSandbox();
  assert.match(await rendered('evolver-status.md', '', sandbox.env), new RegExp(`Plugin-managed install: ${join(sandbox.data, 'engine')}`));
});
