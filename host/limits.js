/**
 * Shared model-facing result budget.
 *
 * Limits are raw UTF-8 bytes, not JavaScript characters: the same budget must
 * govern the Bridge's Tool result gate, the Tool wrapper and its rendered text.
 * Exceeding it is an explicit E_RESULT_LIMIT, never a truncated success.
 */
export const TOOL_RESULT_BYTES = 64 * 1024;

/**
 * Maximum accepted size of one complete HTML composition document (48 KiB).
 *
 * The Worker enforces the same constant before validating/publishing; the Host
 * rejects the same oversize input before starting the worker so a bad request
 * never costs a subprocess. The ceiling also keeps one `project.source` result
 * (the full document) inside the 64 KiB Tool result budget.
 */
export const MAX_COMPOSITION_BYTES = 48 * 1024;
