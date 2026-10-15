import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';

import { fallbackProxyUrl } from '../lib/proxy-client.mjs';

const saved = process.env.EVOMAP_PROXY_PORT;

afterEach(() => {
  if (saved === undefined) delete process.env.EVOMAP_PROXY_PORT;
  else process.env.EVOMAP_PROXY_PORT = saved;
});

test('a port setting that is not a port never points the Proxy request away from loopback', () => {
  for (const raw of ['80@attacker.example', '0', '70000', '19821/../x', ' 19821']) {
    process.env.EVOMAP_PROXY_PORT = raw;
    assert.equal(fallbackProxyUrl(), 'http://127.0.0.1:19820', raw);
  }
});

test('a valid port setting is used', () => {
  process.env.EVOMAP_PROXY_PORT = '19821';
  assert.equal(fallbackProxyUrl(), 'http://127.0.0.1:19821');
  delete process.env.EVOMAP_PROXY_PORT;
  assert.equal(fallbackProxyUrl(), 'http://127.0.0.1:19820');
});
