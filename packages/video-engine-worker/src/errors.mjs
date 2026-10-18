export class WorkerError extends Error {
  constructor(code, message, stage = "request", { uncertain = false } = {}) {
    super(message);
    this.code = code;
    this.stage = stage;
    this.uncertain = uncertain === true;
  }
}
export function fail(code, message, stage, options) {
  throw new WorkerError(code, message, stage, options);
}
export function publicError(error) {
  if (!(error instanceof WorkerError))
    return {
      code: "E_INTERNAL",
      message: "Operation failed; inspect bounded worker diagnostics",
      stage: "worker",
    };
  const details = {
    code: error.code,
    message: error.message,
    stage: error.stage,
  };
  // Only publish the flag when the outcome is genuinely uncertain: a failed
  // publish whose rollback also failed may have left a different entry.
  if (error.uncertain) details.uncertain = true;
  return details;
}
export function object(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
export function keys(value, allowed, required = []) {
  if (
    !object(value) ||
    Object.keys(value).some((k) => !allowed.includes(k)) ||
    required.some((k) => !(k in value))
  )
    fail("E_PARAMS", "Invalid parameter fields");
}
export function string(value, max = 128) {
  if (typeof value !== "string" || !value.length || value.length > max)
    fail("E_PARAMS", "Invalid string parameter");
  return value;
}
export function number(value, min, max) {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < min ||
    value > max
  )
    fail("E_PARAMS", "Number outside supported range");
  return value;
}

export function revision(value) {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value))
    fail("E_PARAMS", "Expected SHA-256 revision");
  return value;
}
