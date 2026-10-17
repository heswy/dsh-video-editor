/**
 * Shared model-facing result budget.
 *
 * Limits are raw UTF-8 bytes, not JavaScript characters: the same budget must
 * govern the Bridge's Tool result gate, the Tool wrapper and its rendered text.
 * Exceeding it is an explicit E_RESULT_LIMIT, never a truncated success.
 */
export const TOOL_RESULT_BYTES = 64 * 1024;
