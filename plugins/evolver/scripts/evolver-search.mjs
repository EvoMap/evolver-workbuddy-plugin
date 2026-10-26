#!/usr/bin/env node
import { answer, commandInput } from '../lib/command-output.mjs';
import { failure, shown, success } from '../lib/evolver-cli.mjs';
import { proxyFetch } from '../lib/proxy-client.mjs';

const USAGE = 'Usage: /evolver-search <task description or error text>';

async function searched(text) {
  if (!text) return failure(USAGE);
  const result = await proxyFetch('POST', '/asset/search', { text, limit: 5 });
  return result.ok ? success(shown(result.data)) : failure(String(result.error));
}

answer(await searched(commandInput()));
