import { appendFileSync } from 'node:fs';

const GENE = { title: 'Retry uploads', summary: 'Retry a flaky upload with backoff.', strategy: '1. Measure. 2. Back off.', signals: ['retry'] };

let prompt = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => { prompt += chunk; });
process.stdin.on('end', () => {
  appendFileSync(process.env.FAKE_CODEBUDDY_LOG, `${JSON.stringify({ args: process.argv.slice(2), prompt, headless: process.env.EVOLVER_HEADLESS ?? null })}\n`);
  if (process.env.FAKE_CODEBUDDY_ANSWER === 'auth') {
    process.stdout.write('Authentication required. Please use /login command to sign in to your account\n');
    return;
  }
  process.stdout.write(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: JSON.stringify(GENE), usage: { input_tokens: 900, output_tokens: 120 } }));
});
