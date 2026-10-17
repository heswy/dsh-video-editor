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
});

const REVISION = /^[a-f0-9]{64}$/;
const JOB_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ARTIFACT_NAME = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.(png|mp4)$/;
const OPERATION_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const PROJECT_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const MEDIA = Object.freeze({ png: 'image/png', mp4: 'video/mp4' });
const TOOL_RESULT_LIMIT = 64 * 1024;
const MAX_REGISTRY_BYTES = 1024 * 1024;

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
    fail('E_PARAMS', 'Unsupported edit type', 'params');
  });
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
  return registry;
}

function parseVersion(value) {
  return String(value)
    .split(/[.-]/)
    .slice(0, 2)
    .map((part) => Number(part) || 0);
}

function supportsExplicitSpawn(version) {
  const parsed = parseVersion(version);
  return parsed[0] > 0 || (parsed[0] === 0 && parsed[1] >= 1);
}

function publicResult(limit, result, source) {
  const effectiveLimit = source === 'tool' ? Math.min(limit, TOOL_RESULT_LIMIT) : limit;
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
    this.environment = buildWorkerEnv(process.env);
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
    const registryRoot = await canonicalDirectory(registry.root, 'registry.root');
    const outputRoot = await canonicalDirectory(registry.outputRoot, 'registry.outputRoot');
    const artifactRoot = await canonicalDirectory(config.artifactRoot, 'artifactRoot');
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

    const engine = await this.engineLoader({ baseUrl: this.baseUrl, workerEntry: config.workerEntry });
    if (typeof engine === 'object' && engine !== null && typeof engine.WorkerClient !== 'function') {
      throw configurationError('The installed engine client does not export WorkerClient');
    }
    if (typeof engine === 'object' && engine !== null && supportsExplicitSpawn(engine.clientVersion) === false) {
      throw configurationError('The installed engine client is too old for explicit worker environment/cwd');
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
    const normalized = this.validate(method, params);
    if (method === 'status' || method === 'cancel') {
      const record = this.jobs.get(normalized.jobId);
      if (record === undefined) throw new BridgeError('E_JOB_NOT_FOUND', 'Unknown video job', { stage: 'job' });
    }

    const task = (async () => {
      const result = await this.callClient(method, normalized);
      if (method === 'frame' || method === 'render') {
        this.rememberJob(method, normalized, result);
      } else if (method === 'status' || method === 'cancel') {
        const record = this.jobs.get(normalized.jobId);
        if (record === undefined) throw new BridgeError('E_JOB_NOT_FOUND', 'Unknown video job', { stage: 'job' });
        if (result !== null && typeof result === 'object' && result.projectId !== undefined && result.projectId !== record.projectId) {
          throw new BridgeError('E_JOB_NOT_FOUND', 'Unknown video job', { stage: 'job' });
        }
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
      this.disposed = true;
    })();
    return this.disposePromise;
  }
}
