import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

export function proxyConnection() {
  const fallback = { url: `http://127.0.0.1:${process.env.EVOMAP_PROXY_PORT || '19820'}`, token: null };
  try {
    const { proxy } = JSON.parse(readFileSync(join(homedir(), '.evolver', 'settings.json'), 'utf8'));
    const url = new URL(String(proxy.url));
    if (!LOOPBACK_HOSTS.has(url.hostname)) return fallback;
    return { url: url.origin, token: proxy.token ? String(proxy.token) : null };
  } catch {
    return fallback;
  }
}

export async function proxyRequest({ url, token }, method, path, { body, timeoutMs }) {
  const headers = {};
  if (body) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(url + path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(timeoutMs)
  });
  if (!res.ok) throw new Error(`Proxy ${path} returned HTTP ${res.status}`);
  return res.json();
}
