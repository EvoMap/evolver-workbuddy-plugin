import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { eitherSignal } from './abort-signal.mjs';

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);
const STATUS_TIMEOUT_MS = 1500;
const REPORT_TIMEOUT_MS = 8000;

const DEFAULT_PORT = 19820;
const MAX_PORT = 65535;

export function fallbackProxyUrl() {
  const raw = process.env.EVOMAP_PROXY_PORT ?? '';
  const port = /^\d{1,5}$/.test(raw) && Number(raw) >= 1 && Number(raw) <= MAX_PORT ? Number(raw) : DEFAULT_PORT;
  return `http://127.0.0.1:${port}`;
}

export function proxyConnection() {
  const fallback = { url: fallbackProxyUrl(), token: null, version: null };
  try {
    const { proxy } = JSON.parse(readFileSync(join(homedir(), '.evolver', 'settings.json'), 'utf8'));
    const url = new URL(String(proxy.url));
    if (!LOOPBACK_HOSTS.has(url.hostname)) return fallback;
    return { url: url.origin, token: proxy.token ? String(proxy.token) : null, version: proxy.version ? String(proxy.version) : null };
  } catch {
    return fallback;
  }
}

async function proxyAnswer({ url, token }, method, path, { body, timeoutMs, signal }) {
  const headers = {};
  if (body) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(url + path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
    redirect: 'error',
    signal: signal ? eitherSignal([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs)
  });
  const text = await res.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }
  return { ok: res.ok, status: res.status, data };
}

export async function proxyRequest(connection, method, path, options) {
  const answer = await proxyAnswer(connection, method, path, options);
  if (!answer.ok) throw new Error(`Proxy ${path} returned HTTP ${answer.status}`);
  return answer.data;
}

export async function proxyStatus(connection = proxyConnection()) {
  try {
    const body = await proxyRequest(connection, 'GET', '/proxy/status', { timeoutMs: STATUS_TIMEOUT_MS });
    return body?.status === 'running' ? body : null;
  } catch {
    return null;
  }
}

export function postReuseResult(report) {
  return proxyAnswer(proxyConnection(), 'POST', '/asset/reuse-result', { body: report, timeoutMs: REPORT_TIMEOUT_MS });
}

/** A Proxy call that resolves to `{ ok, status, data }` or `{ ok: false, error }`; never throws. */
export async function proxyFetch(method, path, body, signal) {
  try {
    const answer = await proxyAnswer(proxyConnection(), method, path, { body, timeoutMs: REPORT_TIMEOUT_MS, signal });
    return answer.ok ? answer : { ...answer, error: answer.data?.error ?? `Proxy ${path} returned HTTP ${answer.status}` };
  } catch (error) {
    return { ok: false, error: String(error?.message ?? error) };
  }
}
