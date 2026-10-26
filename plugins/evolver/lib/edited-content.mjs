export const EDIT_TOOL_NAMES = ['Write', 'Edit', 'MultiEdit', 'NotebookEdit'];

function firstString(input, keys) {
  for (const key of keys) {
    if (typeof input?.[key] === 'string' && input[key].length > 0) return input[key];
  }
  return '';
}

export function editedPath(input) {
  return firstString(input, ['file_path', 'notebook_path']);
}
