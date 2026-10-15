import { closeSync, openSync, readSync, statSync } from 'node:fs';

import { EDIT_TOOL_NAMES, editedContent } from './edited-content.mjs';
import { isVerificationCommand, verificationFailed } from './verification.mjs';

const SHELL_TOOLS = new Set(['Bash', 'PowerShell']);
const PATH_KEYS = ['file_path', 'notebook_path', 'path'];
const TURN_EDITED_MAX_CHARS = 200_000;
const CHECK_COMMAND_MAX_CHARS = 200;
const EXIT_CODE = /^Exit Code: (-?\d+)/m;
const TOOL_ERROR = /^\s*(?:Error\b|<tool_use_error>)/;
const NEWLINE = 0x0a;

export function transcriptSize(transcriptPath) {
  try {
    return statSync(transcriptPath).size;
  } catch {
    return 0;
  }
}

function recordsOf(text) {
  return text.split('\n').flatMap((line) => {
    try {
      const record = line.trim() ? JSON.parse(line) : null;
      return record && typeof record === 'object' ? [record] : [];
    } catch {
      return [];
    }
  });
}

function textFrom(start, transcriptPath) {
  const size = transcriptSize(transcriptPath);
  if (size <= start) return '';
  const buffer = Buffer.alloc(size - start);
  const fd = openSync(transcriptPath, 'r');
  try {
    readSync(fd, buffer, 0, buffer.length, start);
  } finally {
    closeSync(fd);
  }
  return buffer.toString('utf8');
}

function afterLastUserMessage(records) {
  const last = records.findLastIndex((record) => record.type === 'message' && record.role === 'user');
  return records.slice(last + 1);
}

function startsALine(transcriptPath, offset) {
  if (offset === 0) return true;
  const byte = Buffer.alloc(1);
  const fd = openSync(transcriptPath, 'r');
  try {
    return readSync(fd, byte, 0, 1, offset - 1) === 1 && byte[0] === NEWLINE;
  } finally {
    closeSync(fd);
  }
}

// The offset was taken when the prompt was submitted; a transcript that has
// since been rewritten no longer has a line boundary there, so the turn is
// found again from the last user message instead.
export function turnRecordsSince(transcriptPath, offset) {
  if (!transcriptPath || transcriptSize(transcriptPath) === 0) return [];
  if (transcriptSize(transcriptPath) < offset || !startsALine(transcriptPath, offset)) {
    return afterLastUserMessage(recordsOf(textFrom(0, transcriptPath)));
  }
  return recordsOf(textFrom(offset, transcriptPath));
}

function argumentsOf(record) {
  if (record.arguments && typeof record.arguments === 'object') return record.arguments;
  try {
    const parsed = JSON.parse(record.arguments ?? '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function blocksText(content) {
  const blocks = Array.isArray(content) ? content : [content];
  return blocks.filter((block) => typeof block?.text === 'string').map((block) => block.text).join('');
}

function shellOutputOf(text) {
  const stdout = text.indexOf('\nStdout:');
  return stdout === -1 ? text : text.slice(stdout);
}

function shellFailed(result) {
  if (result.status !== 'completed') return true;
  const exit = EXIT_CODE.exec(result.text);
  if (exit && Number(exit[1]) !== 0) return true;
  return verificationFailed({ text: shellOutputOf(result.text) });
}

function isCheck(call) {
  return SHELL_TOOLS.has(call.name) && call.args.run_in_background !== true && isVerificationCommand(call.args.command);
}

function editSucceeded(result) {
  return result?.status === 'completed' && !TOOL_ERROR.test(result.text);
}

function callsOf(records) {
  const results = new Map(records
    .filter((record) => record.type === 'function_call_result')
    .map((record) => [record.callId, { status: record.status, text: blocksText(record.output) }]));
  return records
    .filter((record) => record.type === 'function_call')
    .map((record) => ({ name: record.name, args: argumentsOf(record), result: results.get(record.callId) }));
}

function lastAnswerOf(records) {
  const answers = records.filter((record) => record.type === 'message' && record.role === 'assistant');
  return answers.length > 0 ? blocksText(answers.at(-1).content).trim() : '';
}

function editsOf(calls) {
  const edits = [];
  let chars = 0;
  for (const call of calls) {
    if (!EDIT_TOOL_NAMES.includes(call.name) || !editSucceeded(call.result)) continue;
    const kept = editedContent(call.args).slice(0, TURN_EDITED_MAX_CHARS - chars);
    if (!kept) continue;
    edits.push(kept);
    chars += kept.length;
  }
  return edits;
}

export function turnActivityOf(records) {
  const calls = callsOf(records);
  return {
    commands: calls.map((call) => call.args.command).filter((command) => typeof command === 'string'),
    paths: calls.flatMap((call) => PATH_KEYS.map((key) => call.args[key]).filter((value) => typeof value === 'string')),
    edits: editsOf(calls),
    checks: calls
      .filter((call) => isCheck(call) && call.result)
      .map((call) => ({ command: call.args.command.slice(0, CHECK_COMMAND_MAX_CHARS), failed: shellFailed(call.result) })),
    answer: lastAnswerOf(records),
  };
}
