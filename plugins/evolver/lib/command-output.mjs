import fs from 'node:fs';

// The host leaves `$ARGUMENTS` as it is when a command gets no argument.
const UNSUBSTITUTED = '$ARGUMENTS';

/** The command's arguments, which its markdown hands over on stdin so no quote in them reaches a shell. */
export function commandInput() {
  if (process.stdin.isTTY) return '';
  let text = '';
  try {
    text = fs.readFileSync(0, 'utf8').trim();
  } catch {
    return '';
  }
  return text === UNSUBSTITUTED ? '' : text;
}

export function answer({ kind, text }) {
  console.log(text);
  process.exitCode = kind === 'success' ? 0 : 1;
}
