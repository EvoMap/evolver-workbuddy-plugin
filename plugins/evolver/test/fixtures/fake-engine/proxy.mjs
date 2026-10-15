import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { homedir } from 'node:os';
import { join } from 'node:path';

const version = process.argv[2];
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(req.url === '/proxy/status' ? { running: true, status: 'running' } : { recorded: true }));
});
server.listen(0, '127.0.0.1', () => {
  mkdirSync(join(homedir(), '.evolver'), { recursive: true });
  writeFileSync(join(homedir(), '.evolver', 'settings.json'), JSON.stringify({
    proxy: { url: `http://127.0.0.1:${server.address().port}`, token: 'fake', version },
  }));
  appendFileSync(join(homedir(), 'fake-proxy.pids'), `${process.pid}\n`);
});
setTimeout(() => process.exit(0), 30_000).unref();
