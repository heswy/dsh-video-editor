/**
 * Host bridge errors.
 *
 * Every failure that leaves the bridge — to the Fetch route, the Tool, or the
 * Host log — is reduced to this bounded shape. Raw engine/client diagnostics,
 * errno text, absolute paths and stderr never cross this boundary.
 */

const MAX_MESSAGE = 300;
const MAX_STAGE = 32;

function safeString(value, fallback) {
  return typeof value === 'string' && value.length > 0 ? value.slice(0, MAX_MESSAGE) : fallback;
}

function safeStage(value) {
  return typeof value === 'string' && /^[a-z][a-z0-9_-]{0,31}$/.test(value) ? value.slice(0, MAX_STAGE) : 'host';
}

/**
 * Structural error owned by the bridge. `details` stays JSON-safe and is only
 * surfaced for intentional configuration/parameter diagnostics.
 */
export class BridgeError extends Error {
  constructor(code, message, options) {
    const settings = options || {};
    super(safeString(message, 'Request failed'));
    this.name = 'BridgeError';
    this.code = typeof code === 'string' && /^E_[A-Z0-9_]{1,40}$/.test(code) ? code : 'E_INTERNAL';
    this.stage = safeStage(settings.stage);
    this.details = settings.details;
    this.uncertain = settings.uncertain === true;
    this.jobUnknown = settings.jobUnknown === true;
    if (settings.cause !== undefined) this.cause = settings.cause;
  }
}

/** A configuration problem that must stay recoverable without breaking the shell. */
export function configurationError(message, details) {
  return new BridgeError('E_CONFIGURATION', message, { stage: 'config', details });
}

/**
 * Convert any thrown value to the single public error shape. Known engine
 * client codes keep their code/stage and the `uncertain`/`jobUnknown` flags;
 * unknown failures collapse to a generic internal error so paths and stack
 * text cannot leak. The original value is returned as `cause` only for logging.
 */
export function toPublicError(error) {
  if (error instanceof BridgeError) {
    return {
      error: {
        code: error.code,
        message: error.message,
        stage: error.stage,
        ...(error.details === undefined ? {} : { details: error.details }),
        ...(error.uncertain ? { uncertain: true } : {}),
        ...(error.jobUnknown ? { jobUnknown: true } : {}),
      },
      cause: error,
    };
  }
  if (error !== null && typeof error === 'object' && typeof error.code === 'string' && /^E_[A-Z0-9_]{1,40}$/.test(error.code)) {
    const stage = safeStage(error.stage);
    return {
      error: {
        code: error.code,
        message: safeString(error.message, 'Worker request failed'),
        stage,
        ...(error.uncertain === true ? { uncertain: true } : {}),
        ...(error.jobUnknown === true ? { jobUnknown: true } : {}),
      },
      cause: error,
    };
  }
  return {
    error: {
      code: 'E_INTERNAL',
      message: 'The video service failed; try again.',
      stage: 'host',
    },
    cause: error,
  };
}

/** Short bounded log summary for the Host logger; never sent to UI or Tool. */
export function logSummary(error) {
  const publicError = toPublicError(error).error;
  return `${publicError.code}@${publicError.stage}: ${publicError.message}`.slice(0, 400);
}
