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

import { createHash } from 'node:crypto';
import { realpath, readFile, stat } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { BridgeError, configurationError, logSummary, toPublicError } from './errors.js';
import { allowsProject, tryNormalizeConfig } from './config.js';
import { buildWorkerEnv } from './env.js';
import { loadEngine } from './engine.js';
import { TOOL_RESULT_BYTES } from './limits.js';
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
  frame: ['projectId', 'revision', 'time', 'timeoutMs'],
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

function timeoutMs(value) {
  if (value === undefined) return undefined;
  return numberInRange(value, 'timeoutMs', 100, 120000);
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
  if (typeof value.title !== 'string' || value.title.length < 1 || value.title.length > 200) fail('E_PARAMS', 'Scene title is invalid', 'params');
  const next = { duration: value.duration, title: value.title };
  if (value.subtitle !== undefined) {
    if (typeof value.subtitle !== 'string' || value.subtitle.length > 300) fail('E_PARAMS', 'Scene subtitle is invalid', 'params');
    next.subtitle = value.subtitle;
  }
  if (value.badge !== undefined) {
    if (typeof value.badge !== 'string' || value.badge.length > 48) fail('E_PARAMS', 'Scene badge is invalid', 'params');
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
  if (method === 'frame') {
    const next = {
      projectId: allowedProject(config, params.projectId),
      revision: revision(params.revision),
      time: numberInRange(params.time, 'time', 0, 3599.999),
    };
    const limit = timeoutMs(params.timeoutMs);
    if (limit !== undefined) next.timeoutMs = limit;
    return next;
  }
  if (method === 'render') {
    const next = {
      projectId: allowedProject(config, params.projectId),
      revision: revision(params.revision),
    };
    const limit = timeoutMs(params.timeoutMs);
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
    this.snapshots = new SnapshotRoutes(this.ctx !== undefined && this.ctx !== null ? this.ctx.connection : undefined);
    this.assets = new AssetInbox({
      connection: this.ctx !== undefined && this.ctx !== null ? this.ctx.connection : undefined,
      root: this.config !== null && this.config.assetInboxRoot !== undefined ? this.config.assetInboxRoot : undefined,
      maxBytes: this.config !== null ? this.config.maxAssetBytes : undefined,
    });
  }

  /** Register the authenticated asset upload route from the plugin effect. */
  installAssetRoute() {
    this.assets.install();
    return () => this.assets.dispose();
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
    if (this.runtime !== null) this.runtime.managed = next;
    return next;
  }

  /** Trusted managed project ids, or the static allowlist in legacy mode. */
  listProjects() {
    const config = this.requireConfig();
    return [...config.projectIds].sort();
  }

  /** Root directory the worker writes private preview snapshots under. */
  previewRoot() {
    const runtime = this.runtime;
    if (runtime === null) return null;
    return join(runtime.artifactRoot, 'previews');
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

  validate(method, params) {
    const config = this.requireConfig();
    if (REQUEST_METHODS.includes(method) === false) fail('E_METHOD', 'Unknown video action', 'params');
    return validateParams(config, method, params);
  }

  async invoke(method, params, options) {
    const settings = options || {};
    if (this.closing || this.disposed) {
      throw new BridgeError('E_WORKER_DISPOSED', 'The video service is stopping', { stage: 'lifecycle' });
    }
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
      return { projects: this.listProjects().map((projectId) => ({ projectId })) };
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
      const released = await this.callClient('preview.release', normalized);
      this.snapshots.revoke(normalized.snapshotId);
      return publicResult(this.requireConfig().maxResultBytes, released, settings.source);
    }
    if (method === 'preview') {
      if (settings.source === 'tool') {
        throw new BridgeError('E_METHOD', 'Preview is a UI-only action, not a model tool action', { stage: 'params' });
      }
      const previewTask = (async () => {
        const config = this.requireConfig();
        const ownerProject = await this.sessions.projectForSession(normalized.sessionId);
        if (ownerProject === null) {
          throw new BridgeError('E_SESSION_NOT_BOUND', 'This Session is not bound to a video project', { stage: 'scope' });
        }
        if (ownerProject !== normalized.projectId) {
          throw new BridgeError('E_PROJECT_SCOPE', 'The preview targets a Session outside this project', { stage: 'scope' });
        }
        return readPreviewFile({
          sessionCwd: config.sessionCwd,
          artifactRoot: config.artifactRoot,
          path: normalized.path,
          maxBytes: config.maxPreviewBytes,
        });
      })();
      this.inFlight.add(previewTask);
      try {
        return await previewTask;
      } finally {
        this.inFlight.delete(previewTask);
      }
    }
    if (SESSION_METHODS.includes(method)) {
      if (settings.source === 'tool') throw new BridgeError('E_METHOD', 'Session management is not a model tool action', { stage: 'params' });
      this.requireConfig();
      // Session operations are accepted work too: track them in the same
      // inFlight set so dispose refuses new calls, drains accepted creates and
      // only then lets SessionService tear down its store/context.
      const sessionTask = (async () => this.sessions.handle(method, normalized))();
      this.inFlight.add(sessionTask);
      try {
        return await sessionTask;
      } finally {
        this.inFlight.delete(sessionTask);
      }
    }
    if (method === 'status' || method === 'cancel') {
      const record = this.jobs.get(normalized.jobId);
      if (record === undefined) throw new BridgeError('E_JOB_NOT_FOUND', 'Unknown video job', { stage: 'job' });
    }

    const task = (async () => {
      if (settings.source === 'tool' && method !== 'doctor') {
        await this.assertToolScope(method, normalized, settings.agentSessionId);
      }
      const result = await this.callClient(method, normalized);
      if (method === 'frame' || method === 'render') {
        this.rememberJob(method, normalized, result);
      } else if (method === 'inspect' || method === 'open') {
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
      return publicResult(this.requireConfig().maxResultBytes, result, settings.source);
    })();
    this.inFlight.add(task);
    try {
      return await task;
    } finally {
      this.inFlight.delete(task);
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

  /** Bounded, non-sensitive project facts for live prompt context. */
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
    this.projectFactsById.set(projectId, {
      revision,
      width: Number.isFinite(Number(result.width)) ? Number(result.width) : null,
      height: Number.isFinite(Number(result.height)) ? Number(result.height) : null,
      duration: Number.isFinite(Number(result.duration)) ? Number(result.duration) : null,
      targets,
      scenes,
      images,
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

  /** Refuse new work, then await every accepted request and the one worker teardown. */
  dispose() {
    if (this.disposePromise !== null) return this.disposePromise;
    this.closing = true;
    const startTask = this.starting;
    this.disposePromise = (async () => {
      if (startTask !== null) {
        try {
          await startTask;
        } catch (_ignored) {
          /* a failed start has no live worker left to stop */
        }
      }
      const client = this.client;
      this.client = null;
      this.started = false;
      let teardown;
      if (client !== null && typeof client.dispose === 'function') {
        try {
          teardown = client.dispose();
        } catch (error) {
          this.log(error, 'worker dispose');
        }
      }
      await Promise.allSettled([...this.inFlight]);
      if (teardown !== undefined) {
        try {
          await teardown;
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
        this.assets.dispose();
      } catch (error) {
        this.log(error, 'asset inbox dispose');
      }
      this.disposed = true;
    })();
    return this.disposePromise;
  }
}
