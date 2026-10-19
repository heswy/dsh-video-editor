/**
 * Versioned, atomically written session metadata for the Host bridge.
 *
 * The DSH Session is the authority for messages, model selection and titles.
 * This store holds only the plugin-owned relationship the host cannot express:
 * which creation Sessions belong to which controlled video project, plus the
 * active one. It never stores chat content, credentials or engine revision
 * inputs, and it never writes into the worker project directory.
 *
 * Writes are serialized and use write-temp + rename in the same directory. A
 * corrupt or unknown-version file is left untouched and surfaces as a typed
 * error until the deployment fixes it; it is never silently cleared.
 */

import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomBytes } from 'node:crypto';
import { BridgeError } from './errors.js';

export const SESSION_STATE_VERSION = 1;
export const MAX_STATE_BYTES = 512 * 1024;
export const MAX_SESSIONS_PER_PROJECT = 200;
export const SESSION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,191}$/;
const PROJECT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const STATE_KEYS = ['version', 'projects', 'sessions'];
const PROJECT_KEYS = ['sessionIds', 'activeSessionId', 'createdAt', 'updatedAt'];
const SESSION_KEYS = ['projectId', 'createdAt'];

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function stateError(code, message) {
  return new BridgeError(code, message, { stage: 'session' });
}

function emptyState() {
  return { version: SESSION_STATE_VERSION, projects: {}, sessions: {} };
}

/** Deep copy of the small plain-JSON state; keeps committed readers isolated. */
function cloneState(state) {
  return JSON.parse(JSON.stringify(state));
}

function nowMs() {
  return Date.now();
}

function numberOr(value, fallback) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fallback;
}

/** Validate one parsed state; returns a normalized deep copy or throws a typed error. */
function validateState(parsed, allowedProjects) {
  if (isPlainObject(parsed) === false) throw stateError('E_SESSION_STATE_CORRUPT', 'Session state is not an object');
  if (parsed.version !== SESSION_STATE_VERSION) {
    throw stateError('E_SESSION_STATE_VERSION', `Session state version ${JSON.stringify(parsed.version)} is not supported`);
  }
  for (const key of Object.keys(parsed)) {
    if (STATE_KEYS.includes(key) === false) throw stateError('E_SESSION_STATE_CORRUPT', `Session state has an unknown field "${key}"`);
  }
  if (isPlainObject(parsed.projects) === false || isPlainObject(parsed.sessions) === false) {
    throw stateError('E_SESSION_STATE_CORRUPT', 'Session state projects/sessions must be objects');
  }
  const state = emptyState();
  for (const [projectId, rawProject] of Object.entries(parsed.projects)) {
    if (PROJECT_ID_PATTERN.test(projectId) === false) throw stateError('E_SESSION_STATE_CORRUPT', 'Session state has an invalid project id');
    if (isPlainObject(rawProject) === false) throw stateError('E_SESSION_STATE_CORRUPT', `Session state project "${projectId}" is not an object`);
    for (const key of Object.keys(rawProject)) {
      if (PROJECT_KEYS.includes(key) === false) throw stateError('E_SESSION_STATE_CORRUPT', `Session state project "${projectId}" has an unknown field`);
    }
    if (Array.isArray(rawProject.sessionIds) === false) throw stateError('E_SESSION_STATE_CORRUPT', `Session state project "${projectId}" has no session list`);
    if (rawProject.sessionIds.length > MAX_SESSIONS_PER_PROJECT) throw stateError('E_SESSION_STATE_CORRUPT', `Session state project "${projectId}" has too many sessions`);
    const sessionIds = [];
    for (const sessionId of rawProject.sessionIds) {
      if (typeof sessionId !== 'string' || SESSION_ID_PATTERN.test(sessionId) === false) {
        throw stateError('E_SESSION_STATE_CORRUPT', `Session state project "${projectId}" references an invalid session id`);
      }
      if (sessionIds.includes(sessionId)) throw stateError('E_SESSION_STATE_CORRUPT', `Session state project "${projectId}" repeats a session id`);
      sessionIds.push(sessionId);
    }
    const active = rawProject.activeSessionId === undefined || rawProject.activeSessionId === null ? null : rawProject.activeSessionId;
    if (active !== null && sessionIds.includes(active) === false) {
      throw stateError('E_SESSION_STATE_CORRUPT', `Session state project "${projectId}" has an active session outside its list`);
    }
    state.projects[projectId] = {
      sessionIds,
      activeSessionId: active,
      createdAt: numberOr(rawProject.createdAt, nowMs()),
      updatedAt: numberOr(rawProject.updatedAt, nowMs()),
    };
  }
  for (const [sessionId, rawSession] of Object.entries(parsed.sessions)) {
    if (SESSION_ID_PATTERN.test(sessionId) === false) throw stateError('E_SESSION_STATE_CORRUPT', 'Session state has an invalid session id');
    if (isPlainObject(rawSession) === false) throw stateError('E_SESSION_STATE_CORRUPT', `Session state session "${sessionId}" is not an object`);
    for (const key of Object.keys(rawSession)) {
      if (SESSION_KEYS.includes(key) === false) throw stateError('E_SESSION_STATE_CORRUPT', `Session state session "${sessionId}" has an unknown field`);
    }
    const projectId = rawSession.projectId;
    if (typeof projectId !== 'string' || state.projects[projectId] === undefined) {
      throw stateError('E_SESSION_STATE_CORRUPT', `Session state session "${sessionId}" names an unknown project`);
    }
    if (state.projects[projectId].sessionIds.includes(sessionId) === false) {
      throw stateError('E_SESSION_STATE_CORRUPT', `Session state session "${sessionId}" is missing from its project`);
    }
    state.sessions[sessionId] = { projectId, createdAt: numberOr(rawSession.createdAt, nowMs()) };
  }
  // Unknown-but-well-formed projects stay in the file; they are simply not
  // exposed through this deployment's allowlist. Never delete user data.
  return state;
}

/** One Host-owned session-state file. */
export class SessionStateStore {
  /**
   * @param options.path - trusted absolute state file path, or undefined when session features are disabled.
   * @param options.allowedProjects - trusted project allowlist Set.
   * @param options.logger - optional Host logger.
   */
  constructor(options) {
    const settings = options || {};
    this.path = typeof settings.path === 'string' && settings.path.length > 0 ? settings.path : null;
    this.allowedProjects = settings.allowedProjects instanceof Set ? settings.allowedProjects : new Set(settings.allowedProjects || []);
    this.logger = settings.logger;
    this.state = null;
    this.loadError = null;
    this.loaded = false;
    this.queue = Promise.resolve();
    this.disposed = false;
    this.ready = this.load();
  }

  configured() {
    return this.path !== null;
  }

  async load() {
    if (this.path === null) {
      this.loadError = stateError('E_SESSION_CONFIG', 'Session state storage is not configured');
      return;
    }
    let info;
    try {
      info = await stat(this.path);
    } catch (error) {
      if (error && error.code === 'ENOENT') {
        this.state = emptyState();
        this.loaded = true;
        return;
      }
      this.loadError = stateError('E_SESSION_STATE_CORRUPT', 'Session state could not be read');
      return;
    }
    if (info.isFile() === false) {
      this.loadError = stateError('E_SESSION_STATE_CORRUPT', 'Session state path is not a regular file');
      return;
    }
    if (info.size > MAX_STATE_BYTES) {
      this.loadError = stateError('E_SESSION_STATE_CORRUPT', 'Session state exceeds the size limit');
      return;
    }
    let parsed;
    try {
      parsed = JSON.parse(await readFile(this.path, 'utf8'));
    } catch (_error) {
      this.loadError = stateError('E_SESSION_STATE_CORRUPT', 'Session state is not valid JSON');
      return;
    }
    try {
      this.state = validateState(parsed, this.allowedProjects);
      this.loaded = true;
    } catch (error) {
      this.loadError = error instanceof BridgeError ? error : stateError('E_SESSION_STATE_CORRUPT', 'Session state is invalid');
    }
  }

  async ensureReady() {
    await this.ready;
    if (this.loadError !== null) throw this.loadError;
    if (this.state === null) throw stateError('E_SESSION_STATE_CORRUPT', 'Session state is unavailable');
    return this.state;
  }

  /** Deep copy one project's mapping for one allowed project. */
  async project(projectId) {
    const state = await this.ensureReady();
    if (this.allowedProjects.has(projectId) === false) throw new BridgeError('E_PROJECT_NOT_FOUND', 'Project is not registered for this Host bridge', { stage: 'project' });
    const record = state.projects[projectId];
    if (record === undefined) return { sessionIds: [], activeSessionId: null, exists: false };
    return { sessionIds: record.sessionIds.slice(), activeSessionId: record.activeSessionId, createdAt: record.createdAt, updatedAt: record.updatedAt, exists: true };
  }

  /** Map one session id to its owning project, or null. */
  async projectForSession(sessionId) {
    const state = await this.ensureReady();
    const record = state.sessions[sessionId];
    return record === undefined ? null : record.projectId;
  }

  /**
   * Serialize one mutation against an isolated candidate copy. The mutation is
   * applied to the copy, written durably, and only then published as the
   * authoritative in-memory state. A failed rename or size check therefore
   * cannot leave a ghost mapping that Tool scope checks would trust.
   */
  queueWrite(mutate) {
    const task = this.queue.then(async () => {
      const committed = await this.ensureReady();
      if (this.disposed) throw stateError('E_SESSION_STATE_DISPOSED', 'Session state storage is disposed');
      const candidate = cloneState(committed);
      const result = mutate(candidate);
      await this.write(candidate);
      this.state = candidate;
      return result;
    });
    this.queue = task.catch(() => undefined);
    return task;
  }

  async write(state) {
    if (this.path === null) throw stateError('E_SESSION_CONFIG', 'Session state storage is not configured');
    await mkdir(dirname(this.path), { recursive: true });
    const serialized = JSON.stringify(state, null, 2) + '\n';
    if (Buffer.byteLength(serialized, 'utf8') > MAX_STATE_BYTES) throw stateError('E_SESSION_STATE_LIMIT', 'Session state would exceed the size limit');
    const temporary = `${this.path}.tmp-${process.pid}-${randomBytes(6).toString('hex')}`;
    try {
      await writeFile(temporary, serialized, { encoding: 'utf8', mode: 0o600 });
      await rename(temporary, this.path);
    } catch (error) {
      try {
        await rm(temporary, { force: true });
      } catch (_cleanupError) {
        /* the original failure is what the caller must see */
      }
      throw error;
    }
  }

  /** Add one session to a project and make it active when requested. */
  async addSession(projectId, sessionId, makeActive) {
    return this.queueWrite((state) => {
      if (this.allowedProjects.has(projectId) === false) throw new BridgeError('E_PROJECT_NOT_FOUND', 'Project is not registered for this Host bridge', { stage: 'project' });
      const existing = state.sessions[sessionId];
      if (existing !== undefined) {
        if (existing.projectId !== projectId) {
          throw stateError('E_SESSION_ALREADY_BOUND', 'Session already belongs to another video project');
        }
        return { sessionId, projectId, activeSessionId: state.projects[projectId] === undefined ? sessionId : state.projects[projectId].activeSessionId };
      }
      const timestamp = nowMs();
      const project = state.projects[projectId] === undefined
        ? { sessionIds: [], activeSessionId: null, createdAt: timestamp, updatedAt: timestamp }
        : state.projects[projectId];
      if (project.sessionIds.length >= MAX_SESSIONS_PER_PROJECT) {
        throw stateError('E_SESSION_STATE_LIMIT', 'This project has too many creation Sessions');
      }
      project.sessionIds.push(sessionId);
      if (makeActive === true || project.activeSessionId === null) project.activeSessionId = sessionId;
      project.updatedAt = timestamp;
      state.projects[projectId] = project;
      state.sessions[sessionId] = { projectId, createdAt: timestamp };
      return { sessionId, projectId, activeSessionId: project.activeSessionId };
    });
  }

  /** Mark one mapped session active; only project members qualify. */
  async selectSession(projectId, sessionId) {
    return this.queueWrite((state) => {
      if (this.allowedProjects.has(projectId) === false) throw new BridgeError('E_PROJECT_NOT_FOUND', 'Project is not registered for this Host bridge', { stage: 'project' });
      const project = state.projects[projectId];
      if (project === undefined || project.sessionIds.includes(sessionId) === false) {
        throw stateError('E_SESSION_NOT_BOUND', 'Session is not registered to this video project');
      }
      project.activeSessionId = sessionId;
      project.updatedAt = nowMs();
      return { sessionId, projectId, activeSessionId: sessionId };
    });
  }

  /** Read-only diagnostic summary; never includes session titles or message text. */
  diagnose() {
    const state = this.state;
    return {
      configured: this.path !== null,
      loaded: this.loaded,
      error: this.loadError === null ? null : this.loadError.code,
      version: state === null ? null : state.version,
      projects: state === null ? 0 : Object.keys(state.projects).filter((projectId) => this.allowedProjects.has(projectId)).length,
      sessions: state === null ? 0 : Object.keys(state.sessions).length,
    };
  }

  async dispose() {
    this.disposed = true;
    try {
      await this.queue;
    } catch (_ignored) {
      /* a failed write was already reported to its caller */
    }
  }
}
