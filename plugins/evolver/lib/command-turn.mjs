const TYPED = /^\/(?:[\w-]+:)?evolver-[\w-]+/;
const RENDERED = /<command-name>\/(?:[\w-]+:)?evolver-[\w-]+<\/command-name>/;

/**
 * Whether a prompt is one of this plugin's /evolver-* commands, as typed or as the host renders it into the
 * turn (`<command-message>…</command-message> <command-name>/evolver-…</command-name>` plus the command's
 * output). Commands run as model turns on this host; such a turn is neither recalled for nor distilled.
 */
export function isEvolverCommand(prompt) {
  const text = String(prompt ?? '').trim();
  return TYPED.test(text) || RENDERED.test(text);
}
