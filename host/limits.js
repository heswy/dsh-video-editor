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

/**
 * Maximum accepted size of the JSON-escaped composition string (60 KiB).
 *
 * The worker protocol is JSONL v1 with a fixed 64 KiB request frame
 * (`MAX_LINE = 65536` on the worker side). JSON escaping doubles quotes and
 * backslashes, so a contract-valid 48 KiB document made of quote characters
 * would expand to ~98 KiB and overflow the request line: the worker answers
 * with an uncorrelatable `id: null` E_LINE_LIMIT frame, the engine client treats
 * it as a protocol failure and kills the worker, and every later video request
 * fails with E_WORKER_EXITED until the plugin reloads.
 *
 * The Host therefore bounds the escaped form before starting the worker, with an
 * actionable E_PARAMS instead. The 60 KiB bound plus the small fixed JSONL
 * envelope keeps a valid compose request, a `project.source` result and the
 * model-facing Tool result inside their respective 64 KiB budgets. The engine
 * mirrors this constant for `project.source` results.
 */
export const MAX_COMPOSITION_ESCAPED_BYTES = 61440;
