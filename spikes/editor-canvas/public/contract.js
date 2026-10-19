// Versioned message + coordinate contract shared by the Host canvas page and
// the sandboxed preview runtime. Pure ESM with no DOM/Node dependency so the
// exact same file is imported by the browser page, the sandboxed runtime
// bundle (conceptually; the runtime is a classic script with equivalent
// checks) and the Node contract tests.
//
// Trust model:
// - The sandboxed document has an opaque origin. `event.origin` is the string
//   "null" for it, so origin is NOT authentication.
// - Binding is: event.source === the exact iframe WindowProxy we created,
//   instanceId (per iframe), nonce (per instance, echoed by the runtime), and
//   strict message shapes/sequence numbers. Nonce is not a sandbox either.
// - The bridge exposes no host/Node/model authority; it can only ask the
//   fixed runtime to seek/play/pause/hit-test and report state.

export const CONTRACT_VERSION = 1;
export const RUNTIME_VERSION = "p3-005b-runtime.1";
export const MAX_MESSAGE_BYTES = 16384;
export const MAX_TEXT_LENGTH = 2048;

const INSTANCE_ID = /^[a-z0-9][a-z0-9-]{7,63}$/;
const NONCE = /^[a-f0-9]{32}$/;

export const COMMAND_TYPES = Object.freeze([
  "ping",
  "state",
  "seek",
  "play",
  "pause",
  "hitTest",
  "getElements",
  "destroy",
]);

export const EVENT_TYPES = Object.freeze([
  "ready",
  "pong",
  "state",
  "seeked",
  "playing",
  "paused",
  "hit",
  "elements",
  "destroyed",
  "error",
]);

const COMMAND_REQUIRED = Object.freeze({
  ping: [],
  state: [],
  seek: ["time"],
  play: [],
  pause: [],
  hitTest: ["x", "y"],
  getElements: [],
  destroy: [],
});

const EVENT_REQUIRED = Object.freeze({
  ready: ["runtimeVersion", "width", "height", "duration"],
  pong: [],
  state: ["time", "duration", "playing"],
  seeked: ["time"],
  playing: ["time"],
  paused: ["time"],
  hit: ["hit"],
  elements: ["elements"],
  destroyed: [],
  error: ["code", "message"],
});

function object(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function finite(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function exactKeys(value, allowed, required) {
  if (!object(value)) return "not-object";
  for (const key of Object.keys(value))
    if (!allowed.includes(key)) return `unknown-key:${key}`;
  for (const key of required)
    if (!(key in value) || value[key] === undefined) return `missing-key:${key}`;
  return null;
}

export function validateInstanceId(value) {
  return typeof value === "string" && INSTANCE_ID.test(value);
}

export function validateNonce(value) {
  return typeof value === "string" && NONCE.test(value);
}

const textEncoder = new TextEncoder();

export function isOversizedMessage(message) {
  try {
    return textEncoder.encode(JSON.stringify(message)).length > MAX_MESSAGE_BYTES;
  } catch {
    return true;
  }
}

const BASE_COMMAND_KEYS = ["v", "kind", "instanceId", "nonce", "seq", "type", "payload"];
const BASE_EVENT_KEYS = [
  "v",
  "kind",
  "instanceId",
  "nonce",
  "seq",
  "type",
  "replyTo",
  "payload",
];

function validateEnvelope(message, kind, types, required, keys) {
  const keyError = exactKeys(message, keys, keys.slice(0, 6).concat(kind === "cmd" ? ["payload"] : ["replyTo", "payload"]));
  if (keyError) return { ok: false, code: "E_MALFORMED", detail: keyError };
  if (message.v !== CONTRACT_VERSION)
    return { ok: false, code: "E_VERSION", detail: "unsupported contract version" };
  if (message.kind !== kind)
    return { ok: false, code: "E_MALFORMED", detail: "wrong kind" };
  if (!validateInstanceId(message.instanceId))
    return { ok: false, code: "E_INSTANCE", detail: "invalid instanceId" };
  if (!validateNonce(message.nonce))
    return { ok: false, code: "E_NONCE", detail: "invalid nonce" };
  if (!Number.isInteger(message.seq) || message.seq < 1)
    return { ok: false, code: "E_SEQ", detail: "seq must be a positive integer" };
  if (!types.includes(message.type))
    return { ok: false, code: "E_TYPE", detail: "unknown message type" };
  if (kind === "evt") {
    if (!(message.replyTo === null || Number.isInteger(message.replyTo)))
      return { ok: false, code: "E_REPLY", detail: "replyTo must be integer or null" };
  }
  if (!object(message.payload))
    return { ok: false, code: "E_PAYLOAD", detail: "payload must be an object" };
  const payloadKeys = required[message.type];
  const payloadError = exactKeys(message.payload, payloadKeys, payloadKeys);
  if (payloadError)
    return { ok: false, code: "E_PAYLOAD", detail: `${message.type}:${payloadError}` };
  return { ok: true };
}

/** Validate a parent→sandbox command. Strict keys, types and ranges. */
export function validateCommand(message) {
  const envelope = validateEnvelope(
    message,
    "cmd",
    COMMAND_TYPES,
    COMMAND_REQUIRED,
    BASE_COMMAND_KEYS,
  );
  if (!envelope.ok) return envelope;
  const payload = message.payload;
  switch (message.type) {
    case "seek":
      if (!finite(payload.time))
        return { ok: false, code: "E_PAYLOAD", detail: "seek.time must be finite" };
      break;
    case "hitTest":
      if (!finite(payload.x) || !finite(payload.y))
        return { ok: false, code: "E_PAYLOAD", detail: "hitTest coordinates must be finite" };
      break;
    default:
      break;
  }
  return { ok: true };
}

/** Validate a sandbox→parent event. Strict keys, types and ranges. */
export function validateEvent(message) {
  const envelope = validateEnvelope(
    message,
    "evt",
    EVENT_TYPES,
    EVENT_REQUIRED,
    BASE_EVENT_KEYS,
  );
  if (!envelope.ok) return envelope;
  const payload = message.payload;
  switch (message.type) {
    case "ready":
      if (
        typeof payload.runtimeVersion !== "string" ||
        !finite(payload.width) ||
        !finite(payload.height) ||
        !finite(payload.duration) ||
        payload.width <= 0 ||
        payload.height <= 0 ||
        payload.duration <= 0
      )
        return { ok: false, code: "E_PAYLOAD", detail: "ready shape" };
      break;
    case "state":
      if (!finite(payload.time) || !finite(payload.duration) || typeof payload.playing !== "boolean")
        return { ok: false, code: "E_PAYLOAD", detail: "state shape" };
      break;
    case "seeked":
    case "playing":
    case "paused":
      if (!finite(payload.time))
        return { ok: false, code: "E_PAYLOAD", detail: `${message.type}.time` };
      break;
    case "hit":
      if (payload.hit !== null && validateHit(payload.hit) !== null)
        return { ok: false, code: "E_PAYLOAD", detail: "hit shape" };
      break;
    case "elements":
      if (!Array.isArray(payload.elements) || payload.elements.length > 512)
        return { ok: false, code: "E_PAYLOAD", detail: "elements shape" };
      break;
    case "error":
      if (
        typeof payload.code !== "string" ||
        !payload.code ||
        payload.code.length > 64 ||
        typeof payload.message !== "string" ||
        payload.message.length > 512
      )
        return { ok: false, code: "E_PAYLOAD", detail: "error shape" };
      break;
    default:
      break;
  }
  return { ok: true };
}

/** Returns null when the hit description is valid, else an error string. */
export function validateHit(hit) {
  if (!object(hit)) return "not-object";
  const allowed = ["stableId", "sceneId", "tag", "text", "rect", "style", "stack"];
  for (const key of Object.keys(hit)) if (!allowed.includes(key)) return `unknown:${key}`;
  if (typeof hit.stableId !== "string" || !hit.stableId) return "stableId";
  if (!(hit.sceneId === null || typeof hit.sceneId === "string")) return "sceneId";
  if (typeof hit.tag !== "string" || hit.tag.length > 32) return "tag";
  if (typeof hit.text !== "string") return "text";
  if (!object(hit.rect)) return "rect";
  const rectError = exactKeys(hit.rect, ["x", "y", "width", "height"], [
    "x",
    "y",
    "width",
    "height",
  ]);
  if (rectError) return `rect:${rectError}`;
  for (const value of Object.values(hit.rect)) if (!finite(value)) return "rect-number";
  if (hit.rect.width < 0 || hit.rect.height < 0) return "rect-negative";
  if (!object(hit.style)) return "style";
  if (!Array.isArray(hit.stack) || hit.stack.length > 32) return "stack";
  for (const id of hit.stack) if (typeof id !== "string") return "stack-id";
  return null;
}

function encodeBase64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

// ── Coordinate contract ────────────────────────────────────────────────────
// Composition coordinates are CSS pixels in the document's own 1280×720-ish
// viewport (the iframe element keeps its natural size; the Host scales the
// whole iframe with a CSS transform inside a letterboxed stage). All messages
// between page and runtime use composition coordinates; only the Host layer
// maps to/from screen coordinates.

export function computeStage({
  containerWidth,
  containerHeight,
  compositionWidth,
  compositionHeight,
}) {
  if (![containerWidth, containerHeight, compositionWidth, compositionHeight].every(finite))
    throw new TypeError("stage dimensions must be finite numbers");
  if (containerWidth <= 0 || containerHeight <= 0)
    return { scale: 0, left: 0, top: 0, width: 0, height: 0 };
  const scale = Math.min(
    containerWidth / compositionWidth,
    containerHeight / compositionHeight,
  );
  const width = compositionWidth * scale;
  const height = compositionHeight * scale;
  return {
    scale,
    left: (containerWidth - width) / 2,
    top: (containerHeight - height) / 2,
    width,
    height,
  };
}

export function compositionToScreen(point, stage) {
  return { x: stage.left + point.x * stage.scale, y: stage.top + point.y * stage.scale };
}

/** Screen (page) coordinates → composition coordinates plus an inside test. */
export function screenToComposition(point, stage, composition) {
  const x = (point.x - stage.left) / stage.scale;
  const y = (point.y - stage.top) / stage.scale;
  const inside =
    Number.isFinite(x) &&
    Number.isFinite(y) &&
    x >= 0 &&
    y >= 0 &&
    x < composition.width &&
    y < composition.height;
  return { x, y, inside };
}

// ── Host-side edit validation (before any worker call) ─────────────────────

/** Match a raw hit's stableId against the worker inspect catalogue. */
export function selectableFromCatalogue(hit, catalogue) {
  if (!hit) return { ok: false, code: "E_NO_HIT" };
  const element = catalogue.find((entry) => entry.stableId === hit.stableId);
  if (!element) return { ok: false, code: "E_UNKNOWN_STABLE_ID", stableId: hit.stableId };
  const capabilities = Array.isArray(element.capabilities) ? element.capabilities : [];
  return {
    ok: true,
    stableId: element.stableId,
    sceneId: element.sceneId ?? null,
    editableText: capabilities.includes("text"),
    editableTiming: capabilities.includes("timing"),
    capabilities,
  };
}

/** Validate a text commit intent against the current revision and catalogue. */
export function validateTextCommit({ stableId, text, expectedRevision, currentRevision, catalogue }) {
  if (typeof text !== "string" || text.trim().length === 0)
    return { ok: false, code: "E_EMPTY_TEXT" };
  if (text.length > MAX_TEXT_LENGTH)
    return { ok: false, code: "E_TEXT_TOO_LONG" };
  if (expectedRevision !== currentRevision)
    return { ok: false, code: "E_STALE_REVISION" };
  const hit = { stableId };
  const selected = selectableFromCatalogue(hit, catalogue);
  if (!selected.ok) return selected;
  if (!selected.editableText)
    return { ok: false, code: "E_NOT_TEXT_EDITABLE", stableId };
  return { ok: true, stableId, sceneId: selected.sceneId };
}

/** Shape of the proposed (not yet supported) typed layout op for evidence. */
export function proposedLayoutOp({ stableId, box }) {
  if (!object(box)) return null;
  const values = ["left", "top", "width", "height"].map((key) => box[key]);
  if (!values.every((value) => finite(value) && value >= 0 && value <= 4096)) return null;
  return {
    type: "layout",
    target: stableId,
    box: { left: box.left, top: box.top, width: box.width, height: box.height },
    unit: "composition-px",
  };
}

// ── Sequence / late-response ledger ────────────────────────────────────────
// One ledger per preview instance. It is deliberately transport-agnostic so
// Node tests can prove stale/cross-instance/late handling without a browser.

export class MessageLedger {
  constructor({ instanceId, nonce, timeoutMs = 4000 } = {}) {
    if (!validateInstanceId(instanceId)) throw new TypeError("invalid instanceId");
    if (!validateNonce(nonce)) throw new TypeError("invalid nonce");
    this.instanceId = instanceId;
    this.nonce = nonce;
    this.timeoutMs = timeoutMs;
    this.nextSeq = 1;
    this.lastEventSeq = 0;
    this.pending = new Map(); // seq -> { type, deadline }
    this.revoked = false;
    this.dropped = [];
  }
  revoke() {
    this.revoked = true;
    const pending = [...this.pending.keys()];
    this.pending.clear();
    return pending;
  }
  command(type, payload = {}) {
    const command = {
      v: CONTRACT_VERSION,
      kind: "cmd",
      instanceId: this.instanceId,
      nonce: this.nonce,
      seq: this.nextSeq,
      type,
      payload,
    };
    const validation = validateCommand(command);
    if (!validation.ok) throw new TypeError(`invalid command: ${validation.detail}`);
    this.nextSeq += 1;
    this.pending.set(command.seq, {
      type,
      deadline: Date.now() + this.timeoutMs,
    });
    return command;
  }
  /** Drop replies whose command was never sent or already expired. */
  expire(now = Date.now()) {
    const expired = [];
    for (const [seq, entry] of this.pending)
      if (entry.deadline <= now) {
        expired.push(seq);
        this.pending.delete(seq);
      }
    return expired;
  }
  /**
   * Accept an event after the caller checked event.source with
   * sourceOk = event.source === expected iframe WindowProxy.
   */
  acceptEvent(event, { sourceOk, now = Date.now() } = {}) {
    const drop = (code, detail) => {
      const record = { code, detail, seq: event?.seq ?? null };
      this.dropped.push(record);
      return { accepted: false, code, detail };
    };
    if (this.revoked) return drop("E_INSTANCE_REVOKED", "instance was revoked");
    if (!sourceOk) return drop("E_SOURCE_MISMATCH", "event source is not this iframe");
    const validation = validateEvent(event);
    if (!validation.ok) return drop(validation.code, validation.detail);
    if (event.instanceId !== this.instanceId)
      return drop("E_WRONG_INSTANCE", "event belongs to another instance");
    if (event.nonce !== this.nonce) return drop("E_NONCE", "nonce mismatch");
    if (event.seq <= this.lastEventSeq)
      return drop("E_STALE_SEQ", "event sequence already seen");
    this.lastEventSeq = event.seq;
    let pending = null;
    if (event.replyTo !== null) {
      pending = this.pending.get(event.replyTo) ?? null;
      if (!pending)
        return drop("E_LATE_RESPONSE", `no pending command for seq ${event.replyTo}`);
      this.pending.delete(event.replyTo);
    } else if (["pong", "seeked", "playing", "paused", "hit", "elements", "state", "destroyed"].includes(event.type)) {
      // Direct responses must correlate with a command instead of floating.
      return drop("E_UNCORRELATED", `${event.type} needs replyTo`);
    }
    void now;
    return {
      accepted: true,
      seq: event.seq,
      type: event.type,
      payload: event.payload,
      replyTo: event.replyTo,
      commandType: pending?.type ?? null,
    };
  }
  pendingCount() {
    return this.pending.size;
  }
}

export { encodeBase64Url };
