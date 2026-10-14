export const EDIT_TOOL_NAMES = ['Write', 'Edit', 'MultiEdit', 'NotebookEdit'];

const CONTENT_KEYS = ['content', 'new_string', 'new_source'];

function firstString(input, keys) {
  for (const key of keys) {
    if (typeof input?.[key] === 'string' && input[key].length > 0) return input[key];
  }
  return '';
}

export function editedContent(input) {
  if (Array.isArray(input?.edits)) {
    return input.edits.map((edit) => firstString(edit, CONTENT_KEYS)).filter(Boolean).join('\n');
  }
  return firstString(input, CONTENT_KEYS);
}

export function editedPath(input) {
  return firstString(input, ['file_path', 'notebook_path']);
}
