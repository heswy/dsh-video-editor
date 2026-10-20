/**
 * VideoBridge — the single Host business object behind both the exact Fetch
 * route and the `video_engine` Tool.
 *
 * The worker owns project content, revisions, idempotency and job state. This
 * bridge validates trusted/typed inputs, keeps one worker lifecycle per plugin
 * fiber, remembers only the job-to-project/revision ownership needed to fence
 * status/cancel/artifact reads, and publishes already-produced bytes after
 * re-verifying the worker's succeeded artifact record.
 */

import { createHash, randomBytes } from 'node:crypto';
import { mkdir, realpath, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BridgeError, configurationError, logSummary, toPublicError } from './errors.js';
import { allowsProject, tryNormalizeConfig } from './config.js';
import { buildWorkerEnv } from './env.js';
import { loadEngine } from './engine.js';
import { MAX_COMPOSITION_BYTES, MAX_COMPOSITION_ESCAPED_BYTES, TOOL_RESULT_BYTES } from './limits.js';
import { SessionService } from './sessions.js';
import { SESSION_ID_PATTERN } from './session-state.js';
import { readPreviewFile } from './preview.js';
import { AssetInbox, ASSET_UPLOAD_ROUTE } from './asset-inbox.js';
import { SnapshotRoutes, SNAPSHOT_ROUTE_BASE } from './snapshot.js';

export const REQUEST_METHODS = Object.freeze([
  'doctor',
  'open',
  'inspect',
  'edit',
  'frame',
  'render',
  'status',
  'cancel',
  'close',
  'session.list',
  'session.create',
  'session.select',
  'session.diagnose',
  'preview',
  'project.create',
  'project.rename',
  'project.compose',
  'project.source',
  'project.list',
  'asset.import',
  'scene.create',
  'scene.update',
  'scene.remove',
  'scene.reorder',
  'project.revise',
  'history',
  'undo',
  'redo',
  'preview.snapshot',
  'preview.release',
]);

const METHOD_PARAMS = Object.freeze({
  doctor: [],
  open: ['projectId'],
  inspect: ['projectId'],
  edit: ['projectId', 'expectedRevision', 'operationId', 'ops'],
  frame: ['projectId', 'revision', 'time', 'times', 'timeoutMs', 'wait'],
  render: ['projectId', 'revision', 'timeoutMs'],
  status: ['jobId'],
  cancel: ['jobId'],
  close: ['projectId'],
  'session.list': ['projectId'],
  'session.create': ['projectId', 'requestId'],
  'session.select': ['projectId', 'sessionId'],
  'session.diagnose': [],
  preview: ['projectId', 'sessionId', 'path'],
  'project.create': ['templateId', 'title', 'width', 'height', 'fps'],
  'project.rename': ['projectId', 'title'],
  'project.compose': ['projectId', 'expectedRevision', 'operationId', 'html'],
  'project.source': ['projectId'],
  'project.list': [],
  'asset.import': ['projectId', 'expectedRevision', 'operationId', 'receiptId'],
  'scene.create': ['projectId', 'expectedRevision', 'operationId', 'sceneId', 'afterSceneId', 'template'],
  'scene.update': ['projectId', 'expectedRevision', 'operationId', 'sceneId', 'template'],
  'scene.remove': ['projectId', 'expectedRevision', 'operationId', 'sceneId'],
  'scene.reorder': ['projectId', 'expectedRevision', 'operationId', 'order'],
  'project.revise': ['projectId', 'baseRevision', 'expectedRevision', 'operationId', 'sceneId', 'template'],
  history: ['projectId', 'limit'],
  undo: ['projectId', 'expectedRevision', 'operationId'],
  redo: ['projectId', 'expectedRevision', 'operationId'],
  'preview.snapshot': ['projectId', 'revision', 'ttlMs'],
  'preview.release': ['snapshotId'],
});

const SESSION_METHODS = Object.freeze(['session.list', 'session.create', 'session.select', 'session.diagnose']);

const REVISION = /^[a-f0-9]{64}$/;
const JOB_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ARTIFACT_NAME = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.(png|mp4)$/;
const OPERATION_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const REQUEST_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const PROJECT_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const MEDIA = Object.freeze({ png: 'image/png', mp4: 'video/mp4' });
const MAX_REGISTRY_BYTES = 1024 * 1024;
const SNAPSHOT_ID = /^[a-f0-9]{32}$/;
const TEMPLATE_ID = 'product-launch-v1';
const SCENE_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
/** P3-016: trimmed display-title bound shared with the worker manifest contract. */
const PROJECT_TITLE_MAX = 120;
/** Bounded advisory read of one worker-owned `project.json`; never throws. */
const PROJECT_MANIFEST_MAX_BYTES = 16384;
/** Frame batch bounds shared with the worker contract. */
const MAX_FRAME_TIMES = 4;
/**
 * Worker job deadlines. A frame is a short snapshot; a full MP4 render scales
 * with composition duration and legitimately needs minutes (a 20s composition
 * measures ~112s on the reviewed machine), so render accepts up to 15 minutes
 * while frame keeps the 120s bound. Both limits are enforced again by the
 * worker so a direct JSONL caller cannot widen them.
 */
const MAX_FRAME_TIMEOUT_MS = 120000;
const MAX_RENDER_TIMEOUT_MS = 900000;
const TERMINAL_JOB_STATES = Object.freeze(['succeeded', 'failed', 'cancelled', 'timed_out']);
const FRAME_WAIT_MAX_MS = 30000;
const FRAME_WAIT_INTERVAL_MS = 250;
/**
 * Host-only hand-off for a settled `frame` wait result: the re-verified PNG is
 * copied under the project Session workspace so the model can hand this fixed
 * workspace-relative path straight to `read_image`. The latest frame replaces
 * the previous one (nothing accumulates) and no Host path is ever returned.
 */
const FRAME_IMAGE_DIR = '.dsh-video-frames';
const FRAME_IMAGE_FILE = 'latest.png';
const FRAME_IMAGE_PATH = `${FRAME_IMAGE_DIR}/${FRAME_IMAGE_FILE}`;
/**
 * Frozen engine 0.3.2 scene.template text limits: title 1..2048, subtitle/badge
 * 0..2048 when present (the same contract as typed text edits). The Host keeps
 * the upper bound: valid long copy is passed through untruncated.
 */
const SCENE_TEXT_MAX = 2048;

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(value, allowed) {
  if (isPlainObject(value) === false) return false;
  return Object.keys(value).every((key) => allowed.includes(key));
}

function fail(code, message, stage, flags) {
  throw new BridgeError(code, message, { stage, ...(flags || {}) });
}

function text(value, name, max) {
  if (typeof value !== 'string' || value.length === 0 || value.length > max || value.includes('\0')) {
    fail('E_PARAMS', `Invalid "${name}"`, 'params');
  }
  return value;
}

function projectId(value) {
  return text(value, 'projectId', 128);
}

/**
 * P3-016 display title: trimmed 1..120 characters, no NUL. The Host always
 * sends the normalized (trimmed) value so the worker manifest stays canonical.
 */
function projectTitle(value) {
  if (typeof value !== 'string' || value.includes('\0')) {
    fail('E_PARAMS', 'Invalid project title', 'params');
  }
  const title = value.trim();
  if (title.length < 1 || title.length > PROJECT_TITLE_MAX) {
    fail('E_PARAMS', 'Invalid project title', 'params');
  }
  return title;
}

function allowedProject(config, value) {
  const id = projectId(value);
  if (allowsProject(config, id) === false) {
    fail('E_PROJECT_NOT_FOUND', 'Project is not registered for this Host bridge', 'project');
  }
  return id;
}

function revision(value) {
  if (typeof value !== 'string' || REVISION.test(value) === false) {
    fail('E_PARAMS', 'Expected a SHA-256 revision', 'params');
  }
  return value;
}

function operationId(value) {
  if (typeof value !== 'string' || OPERATION_ID.test(value) === false) {
    fail('E_PARAMS', 'Invalid operationId', 'params');
  }
  return value;
}

/**
 * One complete HTML composition document submitted for an atomic publish.
 *
 * The Host bound is raw UTF-8 bytes because the Worker validates and stores
 * bytes; a character-count check would let a multibyte document through here
 * only to be rejected after the worker started. NUL bytes are rejected too, so
 * the document is a plain text document before it ever reaches the worker.
 *
 * Two byte budgets are enforced, both before any worker start:
 * - the raw document is at most 48 KiB (the worker's validation bound);
 * - its JSON-escaped form is at most 60 KiB, so the JSONL request frame stays
 *   under the worker's 64 KiB line limit. Quotes and backslashes double when
 *   escaped; without this bound a contract-valid quote-heavy document would
 *   overflow the frame, and the worker's uncorrelatable E_LINE_LIMIT reply would
 *   take the worker process (and every later video request) down with it.
 */
function compositionHtml(value) {
  if (typeof value !== 'string' || value.length === 0) {
    fail('E_PARAMS', 'Expected a complete HTML composition document', 'params');
  }
  if (value.includes('\0')) {
    fail('E_PARAMS', 'Composition HTML must not contain NUL bytes', 'params');
  }
  const bytes = Buffer.byteLength(value, 'utf8');
  if (bytes > MAX_COMPOSITION_BYTES) {
    fail(
      'E_PARAMS',
      `Composition HTML is too large (${bytes} UTF-8 bytes); the limit is 48 KiB (${MAX_COMPOSITION_BYTES} bytes)`,
      'params'
    );
  }
  const escapedBytes = Buffer.byteLength(JSON.stringify(value), 'utf8');
  if (escapedBytes > MAX_COMPOSITION_ESCAPED_BYTES) {
    fail(
      'E_PARAMS',
      `Composition HTML is too large after JSON escaping (${bytes} raw UTF-8 bytes expand to ${escapedBytes} bytes; the escaped-frame limit is ${MAX_COMPOSITION_ESCAPED_BYTES} bytes). Reduce repeated quotes/backslashes or shorten the document.`,
      'params'
    );
  }
  return value;
}

function jobId(value) {
  if (typeof value !== 'string' || JOB_ID.test(value) === false) {
    fail('E_PARAMS', 'Invalid jobId', 'params');
  }
  return value;
}

function numberInRange(value, name, min, max) {
  if (typeof value !== 'number' || Number.isFinite(value) === false || value < min || value > max) {
    fail('E_PARAMS', `Invalid "${name}"`, 'params');
  }
  return value;
}

function timeoutMs(value, max) {
  if (value === undefined) return undefined;
  return numberInRange(value, 'timeoutMs', 100, max);
}

/**
 * Batch frame times: 1..MAX_FRAME_TIMES distinct seconds, canonical to the
 * worker's millisecond still-name granularity and sorted ascending before they
 * ever reach the worker. Two inputs that would name the same still are
 * duplicates.
 */
function frameTimes(value) {
  if (Array.isArray(value) === false || value.length < 1 || value.length > MAX_FRAME_TIMES) {
    fail('E_PARAMS', `"times" must list 1-${MAX_FRAME_TIMES} frame times`, 'params');
  }
  const seen = new Set();
  const times = [];
  for (const entry of value) {
    const time = numberInRange(entry, 'times[]', 0, 3599.999);
    const canonical = Number(time.toFixed(3));
    if (seen.has(canonical)) fail('E_PARAMS', '"times" must be distinct at millisecond precision', 'params');
    seen.add(canonical);
    times.push(canonical);
  }
  times.sort((left, right) => left - right);
  return times;
}

const COLOR = /^#[0-9a-fA-F]{6}$/;
const ELEMENT_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;

function finite(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function validateOps(value) {
  if (Array.isArray(value) === false || value.length === 0 || value.length > 32) {
    fail('E_PARAMS', 'Expected 1–32 typed ops', 'params');
  }
  return value.map((op) => {
    if (isPlainObject(op) === false) fail('E_PARAMS', 'Invalid edit op', 'params');
    if (op.type === 'text') {
      if (hasExactKeys(op, ['type', 'target', 'text']) === false) fail('E_PARAMS', 'Invalid text edit fields', 'params');
      const target = text(op.target, 'target', 256);
      if (typeof op.text !== 'string' || op.text.length > 2048 || op.text.includes('\0')) {
        fail('E_PARAMS', 'Invalid text edit', 'params');
      }
      return { type: 'text', target, text: op.text };
    }
    if (op.type === 'timing') {
      if (hasExactKeys(op, ['type', 'target', 'start', 'duration']) === false) fail('E_PARAMS', 'Invalid timing edit fields', 'params');
      if (op.start === undefined && op.duration === undefined) fail('E_PARAMS', 'Timing change missing', 'params');
      const next = { type: 'timing', target: text(op.target, 'target', 256) };
      if (op.start !== undefined) next.start = numberInRange(op.start, 'start', 0, 3600);
      if (op.duration !== undefined) next.duration = numberInRange(op.duration, 'duration', 1 / 240, 3600);
      return next;
    }
    if (op.type === 'layout') {
      if (hasExactKeys(op, ['type', 'target', 'unit', 'box']) === false) fail('E_PARAMS', 'Invalid layout edit fields', 'params');
      if (op.unit !== 'composition-px') fail('E_PARAMS', 'Unsupported layout unit', 'params');
      if (isPlainObject(op.box) === false) fail('E_PARAMS', 'Invalid layout box', 'params');
      const box = {};
      const allowed = ['left', 'top', 'width', 'height'];
      for (const key of Object.keys(op.box)) {
        if (allowed.includes(key) === false) fail('E_PARAMS', 'Unexpected layout field', 'params');
        if (finite(op.box[key]) === false) fail('E_PARAMS', 'Layout values must be finite numbers', 'params');
        box[key] = op.box[key];
      }
      if (Object.keys(box).length === 0) fail('E_PARAMS', 'Layout box is empty', 'params');
      if (box.left !== undefined && (box.left < 0 || box.left > 3840)) fail('E_PARAMS', 'Layout left out of range', 'params');
      if (box.top !== undefined && (box.top < 0 || box.top > 2160)) fail('E_PARAMS', 'Layout top out of range', 'params');
      if (box.width !== undefined && (box.width < 1 || box.width > 3840)) fail('E_PARAMS', 'Layout width out of range', 'params');
      if (box.height !== undefined && (box.height < 1 || box.height > 2160)) fail('E_PARAMS', 'Layout height out of range', 'params');
      return { type: 'layout', target: text(op.target, 'target', 256), unit: 'composition-px', box };
    }
    if (op.type === 'style') {
      if (hasExactKeys(op, ['type', 'target', 'styles']) === false) fail('E_PARAMS', 'Invalid style edit fields', 'params');
      if (isPlainObject(op.styles) === false) fail('E_PARAMS', 'Invalid style patch', 'params');
      const styles = {};
      for (const key of Object.keys(op.styles)) {
        if (['color', 'fontSize', 'fontWeight', 'textAlign'].includes(key) === false) fail('E_PARAMS', 'Unexpected style field', 'params');
        const value = op.styles[key];
        if (key === 'color') {
          if (typeof value !== 'string' || COLOR.test(value) === false) fail('E_PARAMS', 'Invalid style color', 'params');
          styles.color = value.toLowerCase();
        } else if (key === 'fontSize') {
          if (finite(value) === false || value < 8 || value > 256) fail('E_PARAMS', 'Invalid font size', 'params');
          styles.fontSize = value;
        } else if (key === 'fontWeight') {
          if (Number.isInteger(value) === false || value < 100 || value > 900 || value % 100 !== 0) fail('E_PARAMS', 'Invalid font weight', 'params');
          styles.fontWeight = value;
        } else {
          if (!['left', 'center', 'right'].includes(value)) fail('E_PARAMS', 'Invalid text align', 'params');
          styles.textAlign = value;
        }
      }
      if (Object.keys(styles).length === 0) fail('E_PARAMS', 'Style patch is empty', 'params');
      return { type: 'style', target: text(op.target, 'target', 256), styles };
    }
    fail('E_PARAMS', 'Unsupported edit type', 'params');
  });
}

function sceneTemplate(value, allowSceneId) {
  if (isPlainObject(value) === false) fail('E_PARAMS', 'Invalid scene template', 'params');
  const allowed = ['duration', 'title', 'subtitle', 'badge', 'color', 'accent', 'logo', 'shot'];
  if (allowSceneId === true) allowed.push('sceneId');
  for (const key of Object.keys(value)) {
    if (allowed.includes(key) === false) fail('E_PARAMS', 'Unexpected scene template field', 'params');
  }
  if (finite(value.duration) === false || value.duration < 0.5 || value.duration > 60) fail('E_PARAMS', 'Scene duration out of range', 'params');
  if (typeof value.title !== 'string' || value.title.length < 1 || value.title.length > SCENE_TEXT_MAX) fail('E_PARAMS', 'Scene title is invalid', 'params');
  const next = { duration: value.duration, title: value.title };
  if (value.subtitle !== undefined) {
    if (typeof value.subtitle !== 'string' || value.subtitle.length > SCENE_TEXT_MAX) fail('E_PARAMS', 'Scene subtitle is invalid', 'params');
    next.subtitle = value.subtitle;
  }
  if (value.badge !== undefined) {
    if (typeof value.badge !== 'string' || value.badge.length > SCENE_TEXT_MAX) fail('E_PARAMS', 'Scene badge is invalid', 'params');
    next.badge = value.badge;
  }
  for (const [key, pattern] of [['color', COLOR], ['accent', COLOR]]) {
    if (value[key] === undefined) continue;
    if (typeof value[key] !== 'string' || pattern.test(value[key]) === false) fail('E_PARAMS', `Scene ${key} is invalid`, 'params');
    next[key] = value[key].toLowerCase();
  }
  for (const key of ['logo', 'shot']) {
    if (value[key] === undefined) continue;
    if (typeof value[key] !== 'string' || /^assets\/[A-Za-z0-9][A-Za-z0-9._-]*\.(png|jpe?g)$/i.test(value[key]) === false) {
      fail('E_PARAMS', `Scene ${key} is invalid`, 'params');
    }
    next[key] = value[key];
  }
  if (allowSceneId === true && value.sceneId !== undefined) {
    if (typeof value.sceneId !== 'string' || SCENE_ID.test(value.sceneId) === false) fail('E_PARAMS', 'Invalid sceneId', 'params');
    next.sceneId = value.sceneId;
  }
  return next;
}

/** Validate and normalize one typed request against the worker v1 contract. */
export function validateParams(config, method, params) {
  if (REQUEST_METHODS.includes(method) === false) fail('E_METHOD', 'Unknown video action', 'params');
  if (isPlainObject(params) === false) fail('E_PARAMS', 'Expected an object of parameters', 'params');
  const allowed = METHOD_PARAMS[method];
  for (const key of Object.keys(params)) {
    if (allowed.includes(key) === false) fail('E_PARAMS', `Unexpected "${key}" parameter`, 'params');
  }

  if (method === 'doctor') return {};
  if (method === 'open' || method === 'inspect' || method === 'close') {
    return { projectId: allowedProject(config, params.projectId) };
  }
  if (method === 'status' || method === 'cancel') {
    return { jobId: jobId(params.jobId) };
  }
  if (method === 'edit') {
    const next = {
      projectId: allowedProject(config, params.projectId),
      expectedRevision: revision(params.expectedRevision),
      operationId: operationId(params.operationId),
      ops: validateOps(params.ops),
    };
    return next;
  }
  if (method === 'project.compose') {
    return {
      projectId: allowedProject(config, params.projectId),
      expectedRevision: revision(params.expectedRevision),
      operationId: operationId(params.operationId),
      html: compositionHtml(params.html),
    };
  }
  if (method === 'project.source') {
    return { projectId: allowedProject(config, params.projectId) };
  }
  if (method === 'frame') {
    const next = {
      projectId: allowedProject(config, params.projectId),
      revision: revision(params.revision),
    };
    const hasTime = params.time !== undefined;
    const hasTimes = params.times !== undefined;
    if (hasTime === hasTimes) fail('E_PARAMS', 'Provide exactly one of "time" or "times"', 'params');
    if (hasTime) next.time = numberInRange(params.time, 'time', 0, 3599.999);
    else next.times = frameTimes(params.times);
    const limit = timeoutMs(params.timeoutMs, MAX_FRAME_TIMEOUT_MS);
    if (limit !== undefined) next.timeoutMs = limit;
    if (params.wait !== undefined) {
      if (typeof params.wait !== 'boolean') fail('E_PARAMS', 'Invalid "wait"', 'params');
      next.wait = params.wait;
    }
    return next;
  }
  if (method === 'render') {
    const next = {
      projectId: allowedProject(config, params.projectId),
      revision: revision(params.revision),
    };
    const limit = timeoutMs(params.timeoutMs, MAX_RENDER_TIMEOUT_MS);
    if (limit !== undefined) next.timeoutMs = limit;
    return next;
  }
  if (method === 'preview') {
    const sessionId = params.sessionId;
    if (typeof sessionId !== 'string' || SESSION_ID_PATTERN.test(sessionId) === false) fail('E_PARAMS', 'Invalid sessionId', 'params');
    return {
      projectId: allowedProject(config, params.projectId),
      sessionId,
      path: text(params.path, 'path', 4096),
    };
  }
  if (method === 'session.diagnose') return {};
  if (method === 'session.list') return { projectId: allowedProject(config, params.projectId) };
  if (method === 'session.create') {
    const next = { projectId: allowedProject(config, params.projectId) };
    if (params.requestId !== undefined) {
      if (typeof params.requestId !== 'string' || REQUEST_ID.test(params.requestId) === false || params.requestId.length > 128) {
        fail('E_PARAMS', 'Invalid session requestId', 'params');
      }
      next.requestId = params.requestId;
    }
    return next;
  }
  if (method === 'session.select') {
    const sessionId = params.sessionId;
    if (typeof sessionId !== 'string' || SESSION_ID_PATTERN.test(sessionId) === false) fail('E_PARAMS', 'Invalid sessionId', 'params');
    return { projectId: allowedProject(config, params.projectId), sessionId };
  }
  if (method === 'project.create') {
    if (params.templateId !== TEMPLATE_ID) fail('E_PARAMS', 'Unsupported project template', 'params');
    const next = { templateId: TEMPLATE_ID };
    if (params.title !== undefined) {
      if (typeof params.title !== 'string' || params.title.length < 1 || params.title.length > 120) fail('E_PARAMS', 'Invalid project title', 'params');
      next.title = params.title;
    }
    if (params.width !== undefined) {
      if (Number.isInteger(params.width) === false || params.width < 320 || params.width > 3840) fail('E_PARAMS', 'Invalid project width', 'params');
      next.width = params.width;
    }
    if (params.height !== undefined) {
      if (Number.isInteger(params.height) === false || params.height < 180 || params.height > 2160) fail('E_PARAMS', 'Invalid project height', 'params');
      next.height = params.height;
    }
    if (params.fps !== undefined && params.fps !== 30) fail('E_PARAMS', 'Only 30 fps is supported', 'params');
    return next;
  }
  if (method === 'project.rename') {
    return {
      projectId: allowedProject(config, params.projectId),
      title: projectTitle(params.title),
    };
  }
  if (method === 'project.list') return {};
  if (method === 'asset.import') {
    if (typeof params.receiptId !== 'string' || /^[0-9a-f-]{36}$/.test(params.receiptId) === false) fail('E_PARAMS', 'Invalid upload receipt', 'params');
    return {
      projectId: allowedProject(config, params.projectId),
      expectedRevision: revision(params.expectedRevision),
      operationId: operationId(params.operationId),
      receiptId: params.receiptId,
    };
  }
  if (method === 'scene.create' || method === 'scene.update' || method === 'scene.remove' || method === 'scene.reorder') {
    const next = {
      projectId: allowedProject(config, params.projectId),
      expectedRevision: revision(params.expectedRevision),
      operationId: operationId(params.operationId),
    };
    if (method === 'scene.create') {
      if (params.sceneId !== undefined) {
        if (typeof params.sceneId !== 'string' || SCENE_ID.test(params.sceneId) === false) fail('E_PARAMS', 'Invalid sceneId', 'params');
        next.sceneId = params.sceneId;
      }
      if (params.afterSceneId !== undefined) {
        if (typeof params.afterSceneId !== 'string' || SCENE_ID.test(params.afterSceneId) === false) fail('E_PARAMS', 'Invalid afterSceneId', 'params');
        next.afterSceneId = params.afterSceneId;
      }
      next.template = sceneTemplate(params.template, true);
    } else if (method === 'scene.update') {
      if (typeof params.sceneId !== 'string' || SCENE_ID.test(params.sceneId) === false) fail('E_PARAMS', 'Invalid sceneId', 'params');
      next.sceneId = params.sceneId;
      next.template = sceneTemplate(params.template, false);
    } else if (method === 'scene.remove') {
      if (typeof params.sceneId !== 'string' || SCENE_ID.test(params.sceneId) === false) fail('E_PARAMS', 'Invalid sceneId', 'params');
      next.sceneId = params.sceneId;
    } else {
      if (Array.isArray(params.order) === false || params.order.length < 1 || params.order.length > 12) fail('E_PARAMS', 'Invalid scene order', 'params');
      if (new Set(params.order).size !== params.order.length) fail('E_PARAMS', 'Scene order has duplicates', 'params');
      next.order = params.order.map((id) => {
        if (typeof id !== 'string' || SCENE_ID.test(id) === false) fail('E_PARAMS', 'Invalid scene id in order', 'params');
        return id;
      });
    }
    return next;
  }
  if (method === 'project.revise') {
    if (typeof params.sceneId !== 'string' || SCENE_ID.test(params.sceneId) === false) fail('E_PARAMS', 'Invalid sceneId', 'params');
    return {
      projectId: allowedProject(config, params.projectId),
      baseRevision: revision(params.baseRevision),
      expectedRevision: revision(params.expectedRevision),
      operationId: operationId(params.operationId),
      sceneId: params.sceneId,
      template: sceneTemplate(params.template, false),
    };
  }
  if (method === 'history') {
    const next = { projectId: allowedProject(config, params.projectId) };
    if (params.limit !== undefined) {
      if (Number.isInteger(params.limit) === false || params.limit < 1 || params.limit > 64) fail('E_PARAMS', 'Invalid history limit', 'params');
      next.limit = params.limit;
    }
    return next;
  }
  if (method === 'undo' || method === 'redo') {
    return {
      projectId: allowedProject(config, params.projectId),
      expectedRevision: revision(params.expectedRevision),
      operationId: operationId(params.operationId),
    };
  }
  if (method === 'preview.snapshot') {
    const next = { projectId: allowedProject(config, params.projectId), revision: revision(params.revision) };
    if (params.ttlMs !== undefined) {
      if (Number.isInteger(params.ttlMs) === false || params.ttlMs < 100 || params.ttlMs > 1800000) fail('E_PARAMS', 'Invalid snapshot TTL', 'params');
      next.ttlMs = params.ttlMs;
    }
    return next;
  }
  if (method === 'preview.release') {
    if (typeof params.snapshotId !== 'string' || SNAPSHOT_ID.test(params.snapshotId) === false) fail('E_PARAMS', 'Invalid snapshotId', 'params');
    return { snapshotId: params.snapshotId };
  }
  return fail('E_METHOD', 'Unknown video action', 'params');
}

function inside(root, path) {
  const pathRelative = relative(root, path);
  return pathRelative === '' || (pathRelative.startsWith('..') === false && isAbsolute(pathRelative) === false);
}

async function canonicalDirectory(path, name) {
  try {
    const real = await realpath(path);
    const info = await stat(real);
    if (info.isDirectory() === false) throw new Error('not a directory');
    return real;
  } catch (_error) {
    throw configurationError(`"${name}" must be an existing absolute directory`);
  }
}

async function canonicalFile(path, name) {
  try {
    const real = await realpath(path);
    const info = await stat(real);
    if (info.isFile() === false) throw new Error('not a file');
    return real;
  } catch (_error) {
    throw configurationError(`"${name}" must be an existing absolute file`);
  }
}

/**
 * Best-effort advisory title from a trusted project's worker-owned manifest.
 * Display metadata only: an unreadable/corrupt/malformed/oversized manifest
 * yields null and never fails the project list. The stored value must already
 * be the canonical trimmed form written by the worker.
 */
async function readManifestTitle(directory) {
  if (typeof directory !== 'string') return null;
  try {
    const manifestPath = join(directory, 'project.json');
    const info = await stat(manifestPath);
    if (info.isFile() === false || info.size > PROJECT_MANIFEST_MAX_BYTES) return null;
    const parsed = JSON.parse(await readFile(manifestPath, 'utf8'));
    if (isPlainObject(parsed) === false || typeof parsed.title !== 'string') return null;
    const title = parsed.title;
    if (title !== title.trim() || title.length < 1 || title.length > PROJECT_TITLE_MAX) return null;
    return title;
  } catch (_error) {
    return null;
  }
}

function parseRegistry(textValue) {
  let registry;
  try {
    registry = JSON.parse(textValue);
  } catch (_error) {
    throw configurationError('The worker registry is not valid JSON');
  }
  if (isPlainObject(registry) === false) throw configurationError('The worker registry must be an object');
  if (Object.prototype.hasOwnProperty.call(registry, 'projectsRoot')) {
    const managedAllowed = ['projectsRoot', 'registryPath', 'outputRoot', 'assetInboxRoot', 'browserPath'];
    for (const key of Object.keys(registry)) {
      if (managedAllowed.includes(key) === false) throw configurationError(`Unknown managed worker config key "${key}"`);
    }
    if (typeof registry.projectsRoot !== 'string' || isAbsolute(registry.projectsRoot) === false) throw configurationError('managed projectsRoot must be absolute');
    if (typeof registry.registryPath !== 'string' || isAbsolute(registry.registryPath) === false) throw configurationError('managed registryPath must be absolute');
    if (typeof registry.outputRoot !== 'string' || isAbsolute(registry.outputRoot) === false) throw configurationError('managed outputRoot must be absolute');
    if (registry.assetInboxRoot !== undefined && (typeof registry.assetInboxRoot !== 'string' || isAbsolute(registry.assetInboxRoot) === false)) {
      throw configurationError('managed assetInboxRoot must be absolute when present');
    }
    if (registry.browserPath !== undefined && (typeof registry.browserPath !== 'string' || isAbsolute(registry.browserPath) === false)) {
      throw configurationError('managed browserPath must be absolute when present');
    }
    return {
      managed: true,
      root: registry.projectsRoot,
      managedRegistryPath: registry.registryPath,
      outputRoot: registry.outputRoot,
      assetInboxRoot: registry.assetInboxRoot,
      browserPath: registry.browserPath,
    };
  }
  const allowed = ['root', 'projects', 'outputRoot', 'browserPath'];
  for (const key of Object.keys(registry)) {
    if (allowed.includes(key) === false) throw configurationError(`Unknown worker registry key "${key}"`);
  }
  if (typeof registry.root !== 'string' || isAbsolute(registry.root) === false) throw configurationError('registry.root must be absolute');
  if (typeof registry.outputRoot !== 'string' || isAbsolute(registry.outputRoot) === false) throw configurationError('registry.outputRoot must be absolute');
  if (isPlainObject(registry.projects) === false || Object.keys(registry.projects).length === 0) {
    throw configurationError('registry.projects must declare at least one controlled project');
  }
  for (const [id, path] of Object.entries(registry.projects)) {
    if (PROJECT_ID.test(id) === false) throw configurationError('registry.projects contains an invalid project id');
    if (typeof path !== 'string' || isAbsolute(path) === false) throw configurationError('registry project paths must be absolute');
  }
  if (registry.browserPath !== undefined && (typeof registry.browserPath !== 'string' || isAbsolute(registry.browserPath) === false)) {
    throw configurationError('registry.browserPath must be an absolute path when present');
  }
  return { managed: false, ...registry };
}

const MIN_EXPLICIT_SPAWN_CLIENT = Object.freeze([0, 1, 1]);
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

/** Strict full semantic version core; invalid/unknown input is never coerced to 0. */
function parseVersion(value) {
  if (typeof value !== 'string') return null;
  const match = value.match(SEMVER);
  if (match === null) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function compareVersion(left, right) {
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return left[index] < right[index] ? -1 : 1;
  }
  return 0;
}

/**
 * Explicit env/cwd exists from client 0.1.1. The old 0.1.0 client ignores both
 * options, so it must be rejected; malformed/unknown versions are rejected
 * rather than parsed into a permissive 0.0.0.
 */
function supportsExplicitSpawn(version) {
  const parsed = parseVersion(version);
  return parsed !== null && compareVersion(parsed, MIN_EXPLICIT_SPAWN_CLIENT) >= 0;
}

function publicResult(limit, result, source) {
  const effectiveLimit = source === 'tool' ? Math.min(limit, TOOL_RESULT_BYTES) : limit;
  let serialized;
  try {
    serialized = JSON.stringify(result);
  } catch (_error) {
    throw new BridgeError('E_RESULT_LIMIT', 'The worker result is not bounded JSON', { stage: 'result' });
  }
  if (typeof serialized !== 'string' || Buffer.byteLength(serialized, 'utf8') > effectiveLimit) {
    throw new BridgeError('E_RESULT_LIMIT', 'The worker result exceeds the Host result limit', { stage: 'result' });
  }
  return result;
}

async function readManagedProjectMap(registryPath, projectsRoot, idPattern) {
  let parsed;
  try {
    parsed = JSON.parse(await readFile(registryPath, 'utf8'));
  } catch (_error) {
    throw configurationError('The managed project registry is not valid JSON');
  }
  if (isPlainObject(parsed) === false || isPlainObject(parsed.projects) === false) {
    throw configurationError('The managed project registry has no projects object');
  }
  const projects = new Map();
  for (const [id, value] of Object.entries(parsed.projects)) {
    if (idPattern.test(id) === false) throw configurationError('The managed registry contains an invalid project id');
    if (typeof value !== 'string' || isAbsolute(value) === false) throw configurationError('Managed project paths must be absolute');
    let real;
    try {
      real = await realpath(value);
      if ((await stat(real)).isDirectory() === false) throw new Error('not a directory');
    } catch (_error) {
      throw configurationError(`Managed project "${id}" is unavailable`);
    }
    if (inside(projectsRoot, real) === false) throw configurationError(`Managed project "${id}" escapes projectsRoot`);
    projects.set(id, real);
  }
  return projects;
}

export class VideoBridge {
  /**
   * @param options.ctx - Host plugin context with connection/tools/subprocess and logger.
   * @param options.rawConfig - trusted Loader row config; invalid config keeps the shell alive.
   * @param options.engineLoader - optional injection seam for contract tests.
   * @param options.baseUrl - module base for package resolution; defaults to this module.
   */
  constructor(options) {
    const settings = options || {};
    this.ctx = settings.ctx;
    this.engineLoader = typeof settings.engineLoader === 'function' ? settings.engineLoader : loadEngine;
    this.baseUrl = settings.baseUrl;
    const parsed = tryNormalizeConfig(settings.rawConfig);
    this.config = parsed.ok ? parsed.config : null;
    this.configError = parsed.ok ? null : parsed.error;
    this.client = null;
    this.runtime = null;
    this.started = false;
    this.starting = null;
    this.closing = false;
    this.disposed = false;
    this.disposePromise = null;
    this.jobs = new Map();
    this.inFlight = new Set();
    this.projectFactsById = new Map();
    this.environment = buildWorkerEnv(process.env);
    this.sessions = new SessionService({
      ctx: this.ctx,
      bridge: this,
      config: this.config,
      configError: this.configError,
    });
    this.managedProjects = null;
    this.projectDirectoryCache = null;
    const snapshotWebServer = this.ctx !== undefined && this.ctx !== null && typeof this.ctx.get === 'function'
      ? this.ctx.get('webServer')
      : undefined;
    this.snapshots = new SnapshotRoutes(
      this.ctx !== undefined && this.ctx !== null ? this.ctx.connection : undefined,
      snapshotWebServer
    );
    this.assets = new AssetInbox({
      connection: this.ctx !== undefined && this.ctx !== null ? this.ctx.connection : undefined,
      root: this.config !== null && this.config.assetInboxRoot !== undefined ? this.config.assetInboxRoot : undefined,
      maxBytes: this.config !== null ? this.config.maxAssetBytes : undefined,
      // The bridge owns the trusted allowlist; an upload may only land in the
      // inbox for a project this deployment has actually registered.
      isTrustedProject: (id) => this.config !== null && this.config.projectIds.has(id),
    });
  }

  /** Register the authenticated asset upload route from the plugin effect. */
  installAssetRoute() {
    this.assets.install();
    // On plugin disable the request/artifact/tool registrations are torn down
    // first; accepted uploads are drained and cleaned by VideoBridge.dispose.
    return () => {
      this.assets.close();
      this.assets.uninstall();
    };
  }

  /** Exact route handler for the authenticated asset upload. */
  async uploadAsset(request) {
    return this.assets.handle(request);
  }

  /** Re-read the worker-managed project registry and add trusted ids to the allowlist. */
  async discoverManagedProjects() {
    const config = this.requireConfig();
    if (config.projectsRoot === undefined && this.runtime?.managed === null) return null;
    let managedConfig;
    try {
      managedConfig = parseRegistry(await readFile(config.registryPath, 'utf8'));
    } catch (_error) {
      return null;
    }
    if (managedConfig.managed !== true) return null;
    const projectsRoot = await canonicalDirectory(managedConfig.root, 'registry.projectsRoot');
    const registryPath = await canonicalFile(managedConfig.managedRegistryPath, 'registry.registryPath');
    const projects = await readManagedProjectMap(registryPath, projectsRoot, PROJECT_ID);
    for (const id of projects.keys()) config.projectIds.add(id);
    const next = { ...managedConfig, projectsRoot, registryPath, projects };
    if (managedConfig.assetInboxRoot !== undefined) {
      next.assetInboxRoot = await canonicalDirectory(managedConfig.assetInboxRoot, 'assetInboxRoot');
    }
    this.managedProjects = next;
    this.projectDirectoryCache = projects;
    if (this.runtime !== null) this.runtime.managed = next;
    return next;
  }

  /** Trusted managed project ids, or the static allowlist in legacy mode. */
  listProjects() {
    const config = this.requireConfig();
    return [...config.projectIds].sort();
  }

  /**
   * UI-only project picker payload.
   *
   * Every trusted project is listed with the modification time of its entry
   * composition (`index.html`) so the client can auto-open the most recently
   * updated managed project, plus the optional P3-016 manifest `title` (null
   * for legacy projects without one). Ids outside the trusted allowlist are
   * never returned; a project whose directory/entry/manifest cannot be read
   * keeps updatedAt 0 / title null instead of failing the whole list. The
   * legacy fixture demo project is included here and filtered by the client.
   */
  async projectList() {
    const directories = await this.projectDirectories();
    const projects = [];
    for (const projectId of this.listProjects()) {
      const directory = directories.get(projectId);
      let updatedAt = 0;
      let title = null;
      if (typeof directory === 'string') {
        try {
          const info = await stat(join(directory, 'index.html'));
          updatedAt = Number.isFinite(info.mtimeMs) ? info.mtimeMs : 0;
        } catch (_error) {
          updatedAt = 0;
        }
        // P3-016: the display title is optional metadata; old projects report
        // null and the client keeps its content-derived fallback.
        title = await readManifestTitle(directory);
      }
      projects.push({ projectId, updatedAt, title });
    }
    projects.sort((left, right) => right.updatedAt - left.updatedAt || (left.projectId < right.projectId ? -1 : left.projectId > right.projectId ? 1 : 0));
    return { projects, defaultProjectId: projects.length > 0 ? projects[0].projectId : null };
  }

  /** Root directory the worker writes private preview snapshots under. */
  previewRoot() {
    const runtime = this.runtime;
    if (runtime === null) return null;
    return join(runtime.artifactRoot, 'previews');
  }

  /**
   * Canonical per-project content directories from the trusted worker registry.
   *
   * Managed mode reads the worker-managed registry once discovered; legacy mode
   * resolves `registry.projects` directly, bounded to this deployment's trusted
   * id allowlist. Never starts the worker.
   */
  async projectDirectories() {
    const config = this.requireConfig();
    if (this.managedProjects !== null) return this.managedProjects.projects;
    if (this.projectDirectoryCache !== null) return this.projectDirectoryCache;
    let registry;
    try {
      registry = parseRegistry(await readFile(config.registryPath, 'utf8'));
    } catch (_error) {
      return new Map();
    }
    const map = new Map();
    try {
      if (registry.managed === true) {
        const projectsRoot = await canonicalDirectory(registry.root, 'registry.projectsRoot');
        const managedRegistryPath = await canonicalFile(registry.managedRegistryPath, 'registry.registryPath');
        for (const [id, projectPath] of await readManagedProjectMap(managedRegistryPath, projectsRoot, PROJECT_ID)) {
          if (config.projectIds.has(id)) map.set(id, projectPath);
        }
      } else {
        const registryRoot = await canonicalDirectory(registry.root, 'registry.root');
        for (const [id, projectPath] of Object.entries(registry.projects)) {
          if (config.projectIds.has(id) === false) continue;
          try {
            const real = await realpath(projectPath);
            if ((await stat(real)).isDirectory() === false) continue;
            if (inside(registryRoot, real) === false) continue;
            map.set(id, real);
          } catch (_error) {
            /* an unavailable registered project simply has no previewable root */
          }
        }
      }
    } catch (_error) {
      return new Map();
    }
    this.projectDirectoryCache = map;
    return map;
  }

  /** Canonical directory root, or null when it is missing/not a directory. */
  async canonicalPreviewRoot(path) {
    if (typeof path !== 'string' || path.length === 0) return null;
    try {
      const real = await realpath(path);
      return (await stat(real)).isDirectory() ? real : null;
    } catch (_error) {
      return null;
    }
  }

  /** Whether one canonical artifact file is a recorded output of this project's job. */
  artifactOwnedBy(projectId, artifactRoot, canonical) {
    if (typeof projectId !== 'string' || typeof canonical !== 'string') return false;
    if (dirname(canonical) !== artifactRoot) return false;
    const match = basename(canonical).match(ARTIFACT_NAME);
    if (match === null) return false;
    const record = this.jobs.get(match[1]);
    return record !== undefined && record.projectId === projectId;
  }

  /**
   * Provenance roots for previewing one bound project/Session pair (R3).
   *
   * Unrestricted roots are owned outright by this project: its trusted content
   * directory and its per-project Session working directory. Artifact, upload
   * receipt and legacy shared-Session-root files carry an exact ownership probe.
   */
  async previewRoots(projectId, sessionId, requestedPath) {
    const config = this.requireConfig();
    const roots = [];
    let projectDirectory = null;
    try {
      projectDirectory = (await this.projectDirectories()).get(projectId) || null;
    } catch (_error) {
      projectDirectory = null;
    }
    if (projectDirectory !== null) roots.push({ kind: 'project', path: projectDirectory });

    let sessionCwd = null;
    try {
      sessionCwd = await this.sessions.sessionCwd();
    } catch (_error) {
      sessionCwd = null;
    }
    if (sessionCwd !== null) {
      let projectSessionRoot = null;
      try {
        projectSessionRoot = await this.sessions.projectSessionRoot(projectId);
      } catch (_error) {
        projectSessionRoot = null;
      }
      if (projectSessionRoot !== null && inside(sessionCwd, projectSessionRoot)) {
        roots.push({ kind: 'session', path: projectSessionRoot });
      }
      // The user-visible form may differ from the canonical form (for example a
      // `/var` vs `/private/var` prefix on macOS); the Session log names whatever
      // the native chat rendered, so accept the literal requested form too. Both
      // forms are only honored when the real canonical file is inside this root.
      const literalForms = [];
      if (typeof requestedPath === 'string' && requestedPath.length > 0 && requestedPath.length <= 4096) {
        let literal = requestedPath;
        if (literal.startsWith('file://')) {
          try {
            literal = fileURLToPath(literal);
          } catch (_error) {
            literal = null;
          }
        }
        if (typeof literal === 'string' && isAbsolute(literal) && literal.includes('\0') === false) {
          literalForms.push(literal);
        } else if (typeof literal === 'string' && typeof config.sessionCwd === 'string' && isAbsolute(config.sessionCwd)) {
          literalForms.push(join(config.sessionCwd, literal));
        }
      }
      const ownedSessionRoots = [...config.projectIds].map((id) => join(sessionCwd, id));
      roots.push({
        kind: 'legacy',
        path: sessionCwd,
        // The old shared root holds several projects' files; only the bound
        // Session's own inspected events can prove one exact path. Files under a
        // per-project Session root stay owned by that project and never qualify.
        verify: (canonical) => {
          for (const owned of ownedSessionRoots) {
            if (inside(owned, canonical)) return false;
          }
          const forms = literalForms.filter((form) => form !== canonical);
          return this.sessions.sessionReferencesPath(sessionId, [canonical, ...forms]);
        },
      });
    }

    const artifactRoot = await this.canonicalPreviewRoot(
      this.runtime !== null ? this.runtime.artifactRoot : config.artifactRoot
    );
    if (artifactRoot !== null) {
      roots.push({
        kind: 'artifact',
        path: artifactRoot,
        verify: (canonical) => this.artifactOwnedBy(projectId, artifactRoot, canonical),
      });
    }
    if (typeof this.assets.root === 'string' && this.assets.root.length > 0) {
      const inboxRoot = await this.canonicalPreviewRoot(this.assets.root);
      if (inboxRoot !== null) {
        roots.push({
          kind: 'receipt',
          path: inboxRoot,
          verify: (canonical) => this.assets.ownsFile(projectId, canonical),
        });
      }
    }
    return roots;
  }

  /** Bounded diagnostic state; never includes paths, environment values or stderr. */
  state() {
    return {
      configured: this.config !== null,
      started: this.started,
      starting: this.starting !== null,
      closing: this.closing,
      jobs: this.jobs.size,
      inFlight: this.inFlight.size,
      sessions: this.sessions.diagnose(),
    };
  }

  log(error, context) {
    try {
      const logger = this.ctx && this.ctx.logger;
      if (logger && typeof logger.warn === 'function') logger.warn(`dsh-video host ${context}: ${logSummary(error)}`);
    } catch (_ignored) {
      /* diagnostics must never break a request */
    }
  }

  requireConfig() {
    if (this.configError !== null) throw this.configError;
    if (this.config === null) throw configurationError('Host bridge configuration is missing');
    return this.config;
  }

  /** Resolve paths, validate the registry and load the reviewed engine packages once. */
  async prepareRuntime() {
    const config = this.requireConfig();
    const subprocess = this.ctx && this.ctx.subprocess;
    if (!subprocess || typeof subprocess.resolveExecutable !== 'function') {
      throw configurationError('Host subprocess.resolveExecutable is unavailable');
    }

    const workerCwd = await canonicalDirectory(config.workerCwd, 'workerCwd');
    let nodeExecutable;
    try {
      nodeExecutable = await subprocess.resolveExecutable(config.workerNode, this.environment);
    } catch (_error) {
      throw configurationError('"workerNode" could not be resolved from the trusted configuration');
    }
    if (typeof nodeExecutable !== 'string' || isAbsolute(nodeExecutable) === false) {
      throw configurationError('"workerNode" did not resolve to an absolute executable');
    }
    const nodeReal = await canonicalFile(nodeExecutable, 'workerNode');

    const registryPath = await canonicalFile(config.registryPath, 'registryPath');
    const registryStat = await stat(registryPath);
    if (registryStat.size > MAX_REGISTRY_BYTES) throw configurationError('The worker registry exceeds the size limit');
    const registry = parseRegistry(await readFile(registryPath, 'utf8'));
    const artifactRoot = await canonicalDirectory(config.artifactRoot, 'artifactRoot');
    let managed = null;
    let outputRoot;
    if (registry.managed === true) {
      const projectsRoot = await canonicalDirectory(registry.root, 'registry.projectsRoot');
      const managedRegistryPath = await canonicalFile(registry.managedRegistryPath, 'registry.registryPath');
      const managedProjects = await readManagedProjectMap(managedRegistryPath, projectsRoot, PROJECT_ID);
      if (config.projectsRoot !== undefined) {
        const configuredRoot = await canonicalDirectory(config.projectsRoot, 'projectsRoot');
        if (configuredRoot !== projectsRoot) throw configurationError('"projectsRoot" must resolve to the managed projectsRoot');
      }
      let assetInboxRoot = null;
      if (registry.assetInboxRoot !== undefined) {
        assetInboxRoot = await canonicalDirectory(registry.assetInboxRoot, 'assetInboxRoot');
        if (config.assetInboxRoot !== undefined) {
          const configuredInbox = await canonicalDirectory(config.assetInboxRoot, 'assetInboxRoot');
          if (configuredInbox !== assetInboxRoot) throw configurationError('"assetInboxRoot" must resolve to the managed assetInboxRoot');
        }
      } else if (config.assetInboxRoot !== undefined) {
        assetInboxRoot = await canonicalDirectory(config.assetInboxRoot, 'assetInboxRoot');
      }
      outputRoot = await canonicalDirectory(registry.outputRoot, 'registry.outputRoot');
      if (outputRoot !== artifactRoot) throw configurationError('"artifactRoot" must resolve to the worker registry outputRoot');
      for (const [id, projectPath] of managedProjects) config.projectIds.add(id);
      managed = { projectsRoot, registryPath: managedRegistryPath, assetInboxRoot, projects: managedProjects };
      if (registry.browserPath !== undefined) await stat(registry.browserPath).catch(() => {});
    } else {
      const registryRoot = await canonicalDirectory(registry.root, 'registry.root');
      outputRoot = await canonicalDirectory(registry.outputRoot, 'registry.outputRoot');
      if (outputRoot !== artifactRoot) {
        throw configurationError('"artifactRoot" must resolve to the worker registry outputRoot');
      }
      for (const allowed of config.allowedProjects) {
        const projectPath = registry.projects[allowed];
        if (typeof projectPath !== 'string') {
          throw configurationError(`Allowed project "${allowed}" is not present in the worker registry`);
        }
        let projectReal;
        try {
          projectReal = await realpath(projectPath);
          if ((await stat(projectReal)).isDirectory() === false) throw new Error('not a directory');
        } catch (_error) {
          throw configurationError(`Allowed project "${allowed}" is unavailable in the trusted registry`);
        }
        if (inside(registryRoot, projectReal) === false) {
          throw configurationError(`Allowed project "${allowed}" escapes the trusted registry root`);
        }
      }
      if (registry.browserPath !== undefined) {
        try {
          await stat(registry.browserPath);
        } catch (_error) {
          // The worker doctor reports an unavailable browser; a missing configured
          // browser path must not make the shell unusable before the first request.
        }
      }
    }

    const engine = await this.engineLoader({ baseUrl: this.baseUrl, workerEntry: config.workerEntry });
    if (typeof engine === 'object' && engine !== null && typeof engine.WorkerClient !== 'function') {
      throw configurationError('The installed engine client does not export WorkerClient');
    }
    if (typeof engine === 'object' && engine !== null && supportsExplicitSpawn(engine.clientVersion) === false) {
      throw configurationError(`The installed engine client version ${JSON.stringify(engine.clientVersion)} does not support explicit worker environment/cwd (requires >= 0.1.1)`);
    }
    const workerEntry = engine.workerEntry;
    if (typeof workerEntry !== 'string' || isAbsolute(workerEntry) === false) {
      throw configurationError('The worker entry did not resolve to an absolute file');
    }
    const workerEntryReal = await canonicalFile(workerEntry, 'workerEntry');

    return {
      config,
      nodeExecutable: nodeReal,
      workerEntry: workerEntryReal,
      workerCwd,
      registryPath,
      artifactRoot,
      managed,
      WorkerClient: engine.WorkerClient,
      workerVersion: engine.workerVersion,
      clientVersion: engine.clientVersion,
    };
  }

  async startOnce() {
    const runtime = await (this.runtime === null ? this.prepareRuntime() : Promise.resolve(this.runtime));
    this.runtime = runtime;

    let client;
    try {
      client = new runtime.WorkerClient({
        nodeExecutable: runtime.nodeExecutable,
        workerEntry: runtime.workerEntry,
        registryPath: runtime.registryPath,
        cwd: runtime.workerCwd,
        env: Object.assign({}, this.environment),
        startupTimeoutMs: runtime.config.startupTimeoutMs,
        requestTimeoutMs: runtime.config.requestTimeoutMs,
        shutdownTimeoutMs: runtime.config.shutdownTimeoutMs,
        forceKillTimeoutMs: runtime.config.forceKillTimeoutMs,
        maxPending: runtime.config.maxPending,
        maxLineBytes: runtime.config.maxLineBytes,
        maxStderrBytes: runtime.config.maxStderrBytes,
      });
    } catch (error) {
      this.log(error, 'worker client construction');
      throw new BridgeError('E_WORKER_START', 'The video engine could not start', { stage: 'start', cause: error });
    }
    this.client = client;
    try {
      await client.start();
      this.started = true;
      return client;
    } catch (error) {
      this.started = false;
      this.client = null;
      try {
        await client.dispose();
      } catch (_ignored) {
        /* startup failure is reported below; teardown is best effort */
      }
      if (error instanceof BridgeError) throw error;
      const publicError = toPublicError(error);
      this.log(error, 'worker start');
      throw new BridgeError(
        publicError.error.code === 'E_INTERNAL' ? 'E_WORKER_START' : publicError.error.code,
        'The video engine could not start',
        { stage: 'start', cause: error }
      );
    }
  }

  /** Single-flight lazy startup; no import/apply side effect and no per-panel restart. */
  async ensureClient() {
    if (this.closing || this.disposed) {
      throw new BridgeError('E_WORKER_DISPOSED', 'The video service is stopping', { stage: 'lifecycle' });
    }
    if (this.started && this.client !== null) {
      const debug = typeof this.client.debug === 'function' ? this.client.debug() : null;
      if (debug && (debug.state === 'failed' || debug.state === 'disposed')) {
        throw new BridgeError('E_WORKER_EXITED', 'The video engine is no longer running', { stage: 'lifecycle' });
      }
      return this.client;
    }
    if (this.starting !== null) {
      await this.starting;
      return this.client;
    }
    this.starting = this.startOnce();
    try {
      const client = await this.starting;
      return client;
    } finally {
      this.starting = null;
    }
  }

  async callClient(method, params) {
    const config = this.requireConfig();
    const client = await this.ensureClient();
    try {
      return await client.request(method, params, { timeoutMs: config.requestTimeoutMs });
    } catch (error) {
      const publicError = toPublicError(error);
      this.log(error, `worker ${method}`);
      throw new BridgeError(publicError.error.code, publicError.error.message, {
        stage: publicError.error.stage,
        uncertain: publicError.error.uncertain === true,
        jobUnknown: publicError.error.jobUnknown === true,
        cause: error,
      });
    }
  }

  /**
   * Best-effort worker cleanup that must still run after `closing` is set (for
   * example releasing a snapshot the worker produced for a request that was
   * already accepted). It talks to the live client directly, never starts one.
   */
  async releaseWorkerSnapshot(snapshotId) {
    const client = this.client !== null ? this.client : null;
    if (client === null || typeof client.request !== 'function') return false;
    try {
      const config = this.config;
      const options = config !== null ? { timeoutMs: config.requestTimeoutMs } : undefined;
      await client.request('preview.release', { snapshotId }, options);
      return true;
    } catch (error) {
      this.log(error, 'late snapshot release');
      return false;
    }
  }

  validate(method, params) {
    const config = this.requireConfig();
    if (REQUEST_METHODS.includes(method) === false) fail('E_METHOD', 'Unknown video action', 'params');
    return validateParams(config, method, params);
  }

  /**
   * Admit one accepted request synchronously, then run it.
   *
   * Every request that passes the closing gate enters the single `inFlight` set
   * before any await inside the dispatcher. Dispose therefore drains exactly the
   * work it accepted — including the early-return branches (project.list,
   * project.create, project.rename, asset.import, preview snapshots, preview,
   * session.*) — and nothing they publish can outlive the teardown.
   */
  invoke(method, params, options) {
    if (this.closing || this.disposed) {
      return Promise.reject(new BridgeError('E_WORKER_DISPOSED', 'The video service is stopping', { stage: 'lifecycle' }));
    }
    const task = this.dispatch(method, params, options || {});
    this.inFlight.add(task);
    const settle = () => {
      this.inFlight.delete(task);
    };
    task.then(settle, settle);
    return task;
  }

  async dispatch(method, params, settings) {
    const config = this.requireConfig();
    if (config.projectsRoot !== undefined) {
      try {
        await this.discoverManagedProjects();
      } catch (error) {
        if (error instanceof BridgeError) throw error;
        throw new BridgeError('E_CONFIGURATION', 'The managed project registry could not be read', { stage: 'project' });
      }
    }
    const normalized = this.validate(method, params);
    if (method === 'project.list') {
      if (settings.source === 'tool') throw new BridgeError('E_METHOD', 'Project listing is a UI-only action', { stage: 'params' });
      return this.projectList();
    }
    if (method === 'project.create') {
      if (settings.source === 'tool') throw new BridgeError('E_METHOD', 'Project creation is a UI-only action', { stage: 'params' });
      const created = await this.callClient('project.create', normalized);
      await this.discoverManagedProjects();
      if (this.config === null || this.config.projectIds.has(created.projectId) === false) {
        throw new BridgeError('E_PROJECT', 'The created project was not published to the trusted registry', { stage: 'project' });
      }
      return publicResult(this.requireConfig().maxResultBytes, created, settings.source);
    }
    if (method === 'project.rename') {
      // P3-016: display-title metadata only. It never touches the composition,
      // revision or history and stays out of the model Tool surface.
      if (settings.source === 'tool') throw new BridgeError('E_METHOD', 'Project renaming is a UI-only action', { stage: 'params' });
      const renamed = await this.callClient('project.rename', normalized);
      if (
        isPlainObject(renamed) === false ||
        renamed.projectId !== normalized.projectId ||
        typeof renamed.title !== 'string' ||
        typeof renamed.revision !== 'string' ||
        REVISION.test(renamed.revision) === false
      ) {
        throw new BridgeError('E_WORKER_RESPONSE', 'The worker returned an invalid rename result', { stage: 'response' });
      }
      return publicResult(this.requireConfig().maxResultBytes, renamed, settings.source);
    }
    if (method === 'asset.import') {
      if (settings.source === 'tool') throw new BridgeError('E_METHOD', 'Asset import is a UI-only action', { stage: 'params' });
      const { receiptId, ...request } = normalized;
      const receipt = this.assets.take(normalized.projectId, receiptId);
      const imported = await this.callClient('asset.import', {
        ...request,
        sourceName: receipt.sourceName,
        name: receipt.originalName,
        mediaType: receipt.mediaType,
      });
      await this.assets.finish(receipt);
      return publicResult(this.requireConfig().maxResultBytes, imported, settings.source);
    }
    if (method === 'preview.snapshot') {
      if (settings.source === 'tool') throw new BridgeError('E_METHOD', 'Preview snapshot is a UI-only action', { stage: 'params' });
      const snapshot = await this.callClient('preview.snapshot', normalized);
      // A worker result that arrives after disable began must not publish routes;
      // release the private snapshot instead of registering it.
      if (this.closing || this.disposed) {
        const snapshotId = snapshot !== null && typeof snapshot === 'object' ? snapshot.snapshotId : undefined;
        if (typeof snapshotId === 'string' && SNAPSHOT_ID.test(snapshotId)) {
          await this.releaseWorkerSnapshot(snapshotId);
        }
        throw new BridgeError('E_WORKER_DISPOSED', 'The video service is stopping', { stage: 'lifecycle' });
      }
      const root = this.previewRoot();
      if (root === null) throw new BridgeError('E_WORKER_START', 'The preview root is unavailable before worker startup', { stage: 'preview' });
      try {
        const registered = await this.snapshots.register(normalized.projectId, snapshot, root);
        return publicResult(this.requireConfig().maxResultBytes, { ...snapshot, ...registered, routeBase: SNAPSHOT_ROUTE_BASE }, settings.source);
      } catch (error) {
        if (error instanceof BridgeError) throw error;
        try {
          await this.callClient('preview.release', { snapshotId: snapshot.snapshotId });
        } catch (_ignored) {
          /* the failed registration must still surface */
        }
        throw new BridgeError('E_SNAPSHOT', 'The worker preview snapshot could not be published', { stage: 'preview', cause: error });
      }
    }
    if (method === 'preview.release') {
      if (settings.source === 'tool') throw new BridgeError('E_METHOD', 'Preview release is a UI-only action', { stage: 'params' });
      // Revoke the Host route even when the worker snapshot is already gone
      // (TTL expiry / duplicate release): cleanup stays idempotent and no stale
      // route is left behind. Other worker failures still surface after cleanup.
      let released;
      try {
        released = await this.callClient('preview.release', normalized);
      } catch (error) {
        this.snapshots.revoke(normalized.snapshotId);
        if (error instanceof BridgeError && error.code === 'E_SNAPSHOT_NOT_FOUND') {
          return publicResult(this.requireConfig().maxResultBytes, { snapshotId: normalized.snapshotId, released: false }, settings.source);
        }
        throw error;
      }
      this.snapshots.revoke(normalized.snapshotId);
      return publicResult(this.requireConfig().maxResultBytes, released, settings.source);
    }
    if (method === 'preview') {
      if (settings.source === 'tool') {
        throw new BridgeError('E_METHOD', 'Preview is a UI-only action, not a model tool action', { stage: 'params' });
      }
      const ownerProject = await this.sessions.projectForSession(normalized.sessionId);
      if (ownerProject === null) {
        throw new BridgeError('E_SESSION_NOT_BOUND', 'This Session is not bound to a video project', { stage: 'scope' });
      }
      if (ownerProject !== normalized.projectId) {
        throw new BridgeError('E_PROJECT_SCOPE', 'The preview targets a Session outside this project', { stage: 'scope' });
      }
      const roots = await this.previewRoots(normalized.projectId, normalized.sessionId, normalized.path);
      return readPreviewFile({
        roots,
        path: normalized.path,
        maxBytes: config.maxPreviewBytes,
      });
    }
    if (SESSION_METHODS.includes(method)) {
      if (settings.source === 'tool') throw new BridgeError('E_METHOD', 'Session management is not a model tool action', { stage: 'params' });
      return this.sessions.handle(method, normalized);
    }
    if (method === 'status' || method === 'cancel') {
      const record = this.jobs.get(normalized.jobId);
      if (record === undefined) throw new BridgeError('E_JOB_NOT_FOUND', 'Unknown video job', { stage: 'job' });
    }

    if (settings.source === 'tool' && method !== 'doctor') {
      await this.assertToolScope(method, normalized, settings.agentSessionId);
    }
    // `wait` is Host-only semantics: the worker contract never receives it.
    let workerParams = normalized;
    let wait = false;
    if (method === 'frame' && normalized.wait !== undefined) {
      const { wait: requestedWait, ...request } = normalized;
      workerParams = request;
      wait = requestedWait === true;
    }
    const result = await this.callClient(method, workerParams);
    if (method === 'frame' || method === 'render') {
      this.rememberJob(method, workerParams, result);
    } else if (method === 'inspect' || method === 'open' || method === 'project.compose') {
      // inspect/open and project.compose results both carry the authoritative
      // revision for the next prompt assembly; a free-form composition project
      // reports `scenes: []`, which is how the composition mode is detected.
      this.rememberFacts(result);
    } else if (method === 'status' || method === 'cancel') {
      const record = this.jobs.get(normalized.jobId);
      if (record === undefined) throw new BridgeError('E_JOB_NOT_FOUND', 'Unknown video job', { stage: 'job' });
      if (result !== null && typeof result === 'object' && result.projectId !== undefined && result.projectId !== record.projectId) {
        throw new BridgeError('E_JOB_NOT_FOUND', 'Unknown video job', { stage: 'job' });
      }
    }
    if (method === 'close' && result !== null && typeof result === 'object' && result.closed === true) {
      this.snapshots.revokeProject(normalized.projectId);
    }
    if (wait) {
      const settled = await this.waitForFrameJob(result, normalized);
      const published = await this.publishFrameImage(settled, normalized);
      return publicResult(this.requireConfig().maxResultBytes, published, settings.source);
    }
    return publicResult(this.requireConfig().maxResultBytes, result, settings.source);
  }

  /**
   * Host-level `wait` for one frame job: rememberJob already fenced ownership,
   * so this polls the worker's own status view at a fixed interval until a
   * terminal state, the wait deadline (30s or the request timeoutMs, whichever
   * is smaller) or plugin shutdown. On deadline the current queued/running
   * view is returned and the job stays queryable through `status`/`cancel`.
   */
  async waitForFrameJob(started, params) {
    const budget = Math.min(FRAME_WAIT_MAX_MS, params.timeoutMs !== undefined ? params.timeoutMs : FRAME_WAIT_MAX_MS);
    const deadline = Date.now() + budget;
    let view = started;
    while (TERMINAL_JOB_STATES.includes(view.state) === false) {
      // Never hold dispose/closing open for the poll interval or the deadline.
      if (this.closing || this.disposed) {
        throw new BridgeError('E_WORKER_DISPOSED', 'The video service is stopping', { stage: 'lifecycle' });
      }
      const remaining = deadline - Date.now();
      if (remaining <= 0) break;
      await new Promise((resolve) => setTimeout(resolve, Math.min(FRAME_WAIT_INTERVAL_MS, remaining)));
      view = await this.callClient('status', { jobId: started.jobId });
      if (
        view === null ||
        typeof view !== 'object' ||
        view.jobId !== started.jobId ||
        view.projectId !== params.projectId ||
        view.revision !== params.revision
      ) {
        throw new BridgeError('E_WORKER_RESPONSE', 'The worker returned an invalid job status', { stage: 'response' });
      }
    }
    return view;
  }

  /**
   * Hand a settled successful frame to the Agent workspace: re-read the
   * artifact through readArtifact (so name/hash/bytes/realpath are verified
   * again), then replace the fixed workspace-relative PNG used by read_image.
   * Only `wait:true` succeeded views with an artifact are eligible.
   *
   * The replacement goes through a same-directory exclusive temporary file and
   * `rename`, so a pre-existing `latest.png` symlink is replaced as a directory
   * entry instead of being followed, and the published file always has the
   * 0600 mode regardless of the previous file's mode. A disabled Session, an
   * unavailable root or any copy failure is logged and leaves the successful
   * job view untouched, so the Tool contract never turns a good render into an
   * error just because the convenience copy failed.
   */
  async publishFrameImage(view, params) {
    if (view === null || typeof view !== 'object' || view.state !== 'succeeded') return view;
    const artifact = view.artifact;
    if (artifact === null || typeof artifact !== 'object' || typeof artifact.jobId !== 'string') return view;
    if (artifact.jobId !== view.jobId) return view;
    // Never touch the worker or the workspace while the plugin is stopping.
    if (this.closing || this.disposed) return view;
    let temporary = null;
    try {
      const published = await this.readArtifact(artifact.jobId);
      const sessionRoot = await this.sessions.projectSessionRoot(params.projectId);
      const directory = join(sessionRoot, FRAME_IMAGE_DIR);
      await mkdir(directory, { recursive: true, mode: 0o700 });
      // The Session workspace is agent-writable: refuse a symlinked directory
      // that resolves outside the trusted per-project root.
      const realDirectory = await realpath(directory);
      if (inside(sessionRoot, realDirectory) === false) throw new Error('frame image directory escaped the Session root');
      // Never publish a convenience copy while the plugin is stopping.
      if (this.closing || this.disposed) return view;
      temporary = join(realDirectory, `.latest-${randomBytes(8).toString('hex')}.tmp`);
      await writeFile(temporary, published.bytes, { mode: 0o600, flag: 'wx' });
      // rename(2) replaces the directory entry itself: it never follows a
      // symlink planted at latest.png, and the new inode keeps mode 0600.
      await rename(temporary, join(realDirectory, FRAME_IMAGE_FILE));
      temporary = null;
      return { ...view, frameImage: FRAME_IMAGE_PATH };
    } catch (error) {
      if (temporary !== null) {
        try {
          await unlink(temporary);
        } catch (_ignored) {
          /* best-effort private temp cleanup */
        }
      }
      this.log(error, 'frame image publish');
      return view;
    }
  }

  /**
   * A Tool call may only touch the project bound to the trusted Agent Session.
   * Doctor is read-only diagnosis and needs no binding; every project or job
   * action does. The mapping is authoritative on the Host, never in tool args.
   */
  async assertToolScope(method, normalized, agentSessionId) {
    if (typeof agentSessionId !== 'string' || agentSessionId.length === 0) {
      throw new BridgeError('E_AGENT_REQUIRED', 'This video action needs a trusted Agent Session', { stage: 'scope' });
    }
    const projectId = await this.sessions.projectForSession(agentSessionId);
    if (projectId === null) {
      throw new BridgeError('E_SESSION_NOT_BOUND', 'This Agent Session is not bound to a video project', { stage: 'scope' });
    }
    let targetProject = normalized.projectId;
    if (targetProject === undefined && (method === 'status' || method === 'cancel')) {
      const record = this.jobs.get(normalized.jobId);
      if (record === undefined) throw new BridgeError('E_JOB_NOT_FOUND', 'Unknown video job', { stage: 'job' });
      targetProject = record.projectId;
    }
    if (targetProject !== projectId) {
      throw new BridgeError('E_PROJECT_SCOPE', 'The video action targets a project outside this Agent Session binding', { stage: 'scope' });
    }
    return projectId;
  }

  /**
   * Bounded, non-sensitive project facts for live prompt context.
   *
   * inspect/open and project.compose results both carry `scenes`; a free-form
   * composition project reports an empty scene list, which is the composition
   * mode the prompt context turns into the project.source + project.compose
   * edit path.
   */
  rememberFacts(result) {
    if (result === null || typeof result !== 'object') return;
    const projectId = result.projectId;
    if (typeof projectId !== 'string' || this.config === null || this.config.projectIds.has(projectId) === false) return;
    const revision = typeof result.revision === 'string' && REVISION.test(result.revision) ? result.revision : null;
    if (revision === null) return;
    const elements = Array.isArray(result.elements) ? result.elements : [];
    const targets = [];
    for (const element of elements.slice(0, 40)) {
      if (element === null || typeof element !== 'object' || typeof element.stableId !== 'string') continue;
      const capabilities = Array.isArray(element.capabilities) ? element.capabilities.filter((value) => typeof value === 'string').slice(0, 8) : [];
      targets.push({ stableId: element.stableId.slice(0, 128), capabilities });
    }
    const scenes = Array.isArray(result.scenes)
      ? result.scenes.slice(0, 12).map((scene) => ({
          sceneId: typeof scene.sceneId === 'string' ? scene.sceneId.slice(0, 64) : '',
          title: typeof scene.title === 'string' ? scene.title.slice(0, 200) : '',
          start: Number.isFinite(Number(scene.start)) ? Number(scene.start) : null,
          duration: Number.isFinite(Number(scene.duration)) ? Number(scene.duration) : null,
        })).filter((scene) => scene.sceneId !== '')
      : [];
    const images = Array.isArray(result.files)
      ? result.files
          .filter((file) => file !== null && typeof file.path === 'string' && /\.(png|jpe?g)$/i.test(file.path))
          .slice(0, 16)
          .map((file) => file.path.slice(0, 256))
      : [];
    // A free-form composition is a project whose worker result has an empty
    // scene list (`scenes: []`), both for inspect and for a compose publish.
    const mode = Array.isArray(result.scenes) ? (result.scenes.length === 0 ? 'composition' : 'scenes') : null;
    this.projectFactsById.set(projectId, {
      revision,
      width: Number.isFinite(Number(result.width)) ? Number(result.width) : null,
      height: Number.isFinite(Number(result.height)) ? Number(result.height) : null,
      duration: Number.isFinite(Number(result.duration)) ? Number(result.duration) : null,
      targets,
      scenes,
      images,
      mode,
    });
  }

  /** Read the last inspected project facts; never starts or resumes the worker. */
  projectFacts(projectId) {
    const facts = this.projectFactsById.get(projectId);
    if (facts === undefined) return null;
    return {
      revision: facts.revision,
      width: facts.width,
      height: facts.height,
      duration: facts.duration,
      targets: facts.targets.map((target) => ({ stableId: target.stableId, capabilities: target.capabilities.slice() })),
      scenes: facts.scenes.map((scene) => ({ ...scene })),
      images: facts.images.slice(),
      mode: facts.mode,
    };
  }

  rememberJob(method, params, result) {
    if (result === null || typeof result !== 'object' || JOB_ID.test(String(result.jobId)) === false) {
      throw new BridgeError('E_WORKER_RESPONSE', 'The worker returned an invalid job', { stage: 'response' });
    }
    if (result.projectId !== params.projectId || result.revision !== params.revision) {
      throw new BridgeError('E_WORKER_RESPONSE', 'The worker job does not match the request', { stage: 'response' });
    }
    this.jobs.set(result.jobId, {
      projectId: params.projectId,
      revision: params.revision,
      kind: method,
    });
  }

  async readArtifact(requestedJobId) {
    const config = this.requireConfig();
    const id = jobId(requestedJobId);
    const record = this.jobs.get(id);
    if (record === undefined) throw new BridgeError('E_JOB_NOT_FOUND', 'Unknown video job', { stage: 'job' });

    const job = await this.callClient('status', { jobId: id });
    if (job === null || typeof job !== 'object' || job.projectId !== record.projectId || job.revision !== record.revision) {
      throw new BridgeError('E_JOB_NOT_FOUND', 'Unknown video job', { stage: 'job' });
    }
    if (job.state !== 'succeeded' || job.artifact === undefined || job.artifact === null) {
      throw new BridgeError('E_ARTIFACT_NOT_READY', 'The video artifact is not ready', { stage: 'artifact' });
    }
    const artifact = job.artifact;
    if (typeof artifact.name !== 'string' || ARTIFACT_NAME.test(artifact.name) === false) {
      throw new BridgeError('E_ARTIFACT_INTEGRITY', 'The video artifact record is invalid', { stage: 'artifact' });
    }
    const match = artifact.name.match(ARTIFACT_NAME);
    const kind = match[2];
    if (artifact.jobId !== id || artifact.projectId !== record.projectId || artifact.revision !== record.revision) {
      throw new BridgeError('E_ARTIFACT_INTEGRITY', 'The video artifact record is invalid', { stage: 'artifact' });
    }
    if (typeof artifact.hash !== 'string' || REVISION.test(artifact.hash) === false) {
      throw new BridgeError('E_ARTIFACT_INTEGRITY', 'The video artifact record is invalid', { stage: 'artifact' });
    }
    if (typeof artifact.bytes !== 'number' || Number.isFinite(artifact.bytes) === false || artifact.bytes < 0) {
      throw new BridgeError('E_ARTIFACT_INTEGRITY', 'The video artifact record is invalid', { stage: 'artifact' });
    }
    if (artifact.bytes > config.maxArtifactBytes) {
      throw new BridgeError('E_ARTIFACT_LIMIT', 'The video artifact exceeds the Host size limit', { stage: 'artifact' });
    }

    const artifactRoot = this.runtime !== null ? this.runtime.artifactRoot : config.artifactRoot;
    const path = join(artifactRoot, artifact.name);
    let filePath;
    try {
      filePath = await realpath(path);
      if (inside(artifactRoot, filePath) === false) throw new Error('escaped root');
      const info = await stat(filePath);
      if (info.isFile() === false) throw new Error('not a regular file');
      if (info.size !== artifact.bytes) throw new Error('size mismatch');
    } catch (_error) {
      throw new BridgeError('E_ARTIFACT_INTEGRITY', 'The video artifact failed validation', { stage: 'artifact' });
    }
    let bytes;
    try {
      bytes = await readFile(filePath);
    } catch (_error) {
      throw new BridgeError('E_ARTIFACT_INTEGRITY', 'The video artifact failed validation', { stage: 'artifact' });
    }
    if (bytes.length !== artifact.bytes || bytes.length > config.maxArtifactBytes) {
      throw new BridgeError('E_ARTIFACT_INTEGRITY', 'The video artifact failed validation', { stage: 'artifact' });
    }
    const hash = createHash('sha256').update(bytes).digest('hex');
    if (hash !== artifact.hash) {
      throw new BridgeError('E_ARTIFACT_INTEGRITY', 'The video artifact failed validation', { stage: 'artifact' });
    }
    return {
      bytes,
      mediaType: MEDIA[kind],
      size: bytes.length,
      hash,
      filename: artifact.name,
    };
  }

  /**
   * Refuse new work, abort pending uploads, drain every accepted request, then
   * tear down the worker, Sessions, snapshot routes and inbox receipts. Nothing
   * accepted or published can outlive the resolved dispose promise.
   */
  dispose() {
    if (this.disposePromise !== null) return this.disposePromise;
    this.closing = true;
    // Streams are not in inFlight; closing the inbox rejects new bytes and
    // cancels active readers before the drain below waits on accepted work.
    try {
      this.assets.close();
    } catch (error) {
      this.log(error, 'asset inbox close');
    }
    const startTask = this.starting;
    this.disposePromise = (async () => {
      if (startTask !== null) {
        try {
          await startTask;
        } catch (_ignored) {
          /* a failed start has no live worker left to stop */
        }
      }
      // Accepted requests may still need the worker; drain them before teardown.
      await Promise.allSettled([...this.inFlight]);
      const client = this.client;
      this.client = null;
      this.started = false;
      if (client !== null && typeof client.dispose === 'function') {
        try {
          await client.dispose();
        } catch (error) {
          this.log(error, 'worker dispose');
        }
      }
      try {
        await this.sessions.dispose();
      } catch (error) {
        this.log(error, 'session dispose');
      }
      try {
        this.snapshots.dispose();
      } catch (error) {
        this.log(error, 'preview routes dispose');
      }
      try {
        await this.assets.dispose();
      } catch (error) {
        this.log(error, 'asset inbox dispose');
      }
      this.disposed = true;
    })();
    return this.disposePromise;
  }
}
