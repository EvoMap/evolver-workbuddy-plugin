import { appendFileSync, cpSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
appendFileSync(join(homedir(), 'fake-npm.log'), `${JSON.stringify(args)}\n`);
await new Promise((resolve) => setTimeout(resolve, Number(process.env.FAKE_NPM_DELAY_MS || 0)));
if (process.env.FAKE_NPM_FAIL) {
  process.stderr.write('npm ERR! code ENOTFOUND\nnpm ERR! network request to registry failed\n');
  process.exit(1);
}
const prefix = args[args.indexOf('--prefix') + 1];
const packageDir = join(prefix, 'node_modules', '@evomap', 'evolver');
mkdirSync(join(packageDir, 'bin'), { recursive: true });
cpSync(fileURLToPath(new URL('./evolver.mjs', import.meta.url)), join(packageDir, 'bin', 'evolver.js'));
cpSync(fileURLToPath(new URL('./proxy.mjs', import.meta.url)), join(packageDir, 'bin', 'fake-proxy.mjs'));
writeFileSync(join(packageDir, 'package.json'), JSON.stringify({
  name: '@evomap/evolver',
  version: process.env.FAKE_LATEST || '2.0.44',
  type: 'module',
  bin: { evolver: './bin/evolver.js' },
}));
