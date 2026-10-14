import { spawn } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const version = JSON.parse(readFileSync(join(here, '..', 'package.json'), 'utf8')).version;
const args = process.argv.slice(2);
appendFileSync(join(homedir(), 'fake-evolver.log'), `${JSON.stringify({ args, selfUpdate: process.env.EVOLVER_SELF_UPDATE ?? null })}\n`);

if (args[0] === '--version') {
  process.stdout.write(`${version}\n`);
} else if (args[0] === 'lifecycle' && ['start', 'restart'].includes(args[1])) {
  if (process.env.FAKE_START_FAIL) {
    process.stderr.write('public legacy mode needs EVOMAP_NODE_SECRET\n');
    process.exit(1);
  }
  const proxy = spawn(process.execPath, [join(here, 'fake-proxy.mjs'), version], { detached: true, stdio: 'ignore' });
  proxy.unref();
  process.stdout.write(`${JSON.stringify({ status: 'started', pid: proxy.pid })}\n`);
}
