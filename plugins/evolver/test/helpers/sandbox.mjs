import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PLUGIN_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const TOKEN = 'test-proxy-token';
const ISOLATED_PATH = process.platform === 'win32' ? process.env.PATH : '/usr/bin:/bin';

export function sandboxHome() {
  const home = mkdtempSync(join(tmpdir(), 'evolver-wb-home-'));
  const data = join(home, 'plugin-data');
  mkdirSync(data, { recursive: true });
  return {
    home,
    data,
    env: { ...process.env, HOME: home, USERPROFILE: home, CODEBUDDY_PLUGIN_DATA: data, CODEBUDDY_PLUGIN_ROOT: PLUGIN_ROOT, EVOMAP_PROXY_PORT: '1', PATH: ISOLATED_PATH },
    cleanup: () => rmSync(home, { recursive: true, force: true, maxRetries: 20, retryDelay: 50 }),
  };
}

export function writeProxySettings(home, { url, version }) {
  mkdirSync(join(home, '.evolver'), { recursive: true });
  writeFileSync(join(home, '.evolver', 'settings.json'), JSON.stringify({ proxy: { url, token: TOKEN, version } }));
}

function readBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => resolve(body ? JSON.parse(body) : {}));
  });
}

export async function fakeProxy({ assets = [], reuseAnswers = [] } = {}) {
  const posts = [];
  const recalls = [];
  const answers = [...reuseAnswers];
  const server = http.createServer(async (req, res) => {
    const body = await readBody(req);
    const reply = (status, payload) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(payload));
    };
    if (req.headers.authorization !== `Bearer ${TOKEN}`) return reply(401, { error: 'unauthorized' });
    if (req.method === 'GET' && req.url === '/proxy/status') return reply(200, { running: true, status: 'running' });
    if (req.url === '/asset/fetch') {
      recalls.push(body);
      return reply(200, { assets });
    }
    if (req.url === '/asset/reuse-result') {
      posts.push(body);
      const [status, payload] = answers.length > 1 ? answers.shift() : (answers[0] ?? [200, { recorded: true, eligible: true, counted: true, weight: 1 }]);
      return reply(status, payload);
    }
    return reply(404, {});
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { url: `http://127.0.0.1:${server.address().port}`, posts, recalls, close: () => new Promise((resolve) => server.close(resolve)) };
}

export function runHook(name, input, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [join(PLUGIN_ROOT, 'hooks', `${name}.mjs`)], { env, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', reject);
    child.on('exit', (code) => (code === 0 ? resolve(JSON.parse(stdout || '{}')) : reject(new Error(`${name} exited ${code}: ${stderr}`))));
    child.stdin.end(JSON.stringify(input));
  });
}

export async function waitFor(check, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await check();
    if (Array.isArray(value) ? value.length > 0 : value) return value;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('timed out waiting');
}

export const pluginRoot = PLUGIN_ROOT;
