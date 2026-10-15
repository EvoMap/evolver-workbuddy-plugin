#!/usr/bin/env node
import { EDIT_TOOL_NAMES, editedPath } from '../lib/edited-content.mjs';
import { runHook } from '../lib/hook-io.mjs';
import { resolvedPath } from '../lib/project-dir.mjs';
import { contentHashOf } from '../lib/retention-pending.mjs';
import { noteFileBefore } from '../lib/session-state.mjs';

runHook('PreToolUse', (input) => {
  const file = editedPath(input.tool_input);
  if (!input.session_id || !EDIT_TOOL_NAMES.includes(input.tool_name) || !file) return '';
  const target = resolvedPath(input, file);
  noteFileBefore(input.session_id, target, contentHashOf(target));
  return '';
});
