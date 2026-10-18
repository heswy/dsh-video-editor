/**
 * Host-owned creation-Session coordination for the video panel.
 *
 * The DSH Session Controller owns Sessions, messages, model selection and
 * titles. This service owns only the plugin-private relationship the host does
 * not model: which Sessions belong to which controlled video project, which one
 * is active, and the trusted working directory new Sessions are created in.
 * It also contributes live project context to a bound Agent's prompt assembly.
 *
 * The service never accepts a path, an arbitrary Agent identity or a Session id
 * from the UI without checking the persisted mapping first.
 */

import { realpath, stat } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { createRequire } from 'node:module';
import { BridgeError, logSummary } from './errors.js';
import { MAX_SESSIONS_PER_PROJECT, SESSION_ID_PATTERN, SESSION_STATE_VERSION, SessionStateStore } from './session-state.js';

const require = createRequire(import.meta.url);
let bundleVersion = 'unknown';
try {
  bundleVersion = String(require('../package.json').version);
} catch (_error) {
  bundleVersion = 'unknown';
}

const PROMPT_CONTEXT_NAME = 'dsh-video:project';
const PROMPT_CONTEXT_ORDER = 4500;
const REQUEST_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const MAX_CREATE_DEDUPE = 32;
const MAX_LIST_ITEMS = 100;

function sessionError(code, message, details) {
  return new BridgeError(code, message, { stage: 'session', details });
}

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/**
 * Resolve the trusted Agent's Session identity for a Tool execution.
 *
 * The shipped tool pipeline passes `exec.agent.session.id` (verified in the
 * installed tool runtime's execute path); the public projected Agent type also
 * exposes `agent.id`. Accept either real
 * shape, require an exact match when both exist, and never guess from tool
 * arguments.
 *
 * @param exec - Tool execution context.
 * @returns the Session id, or null when the execution has no Agent.
 */
export function agentSessionIdFromToolExec(exec) {
  if (exec === null || typeof exec !== 'object') return null;
  const agent = exec.agent;
  if (agent === null || agent === undefined) return null;
  if (typeof agent !== 'object') throw sessionError('E_AGENT_IDENTITY', 'The tool execution Agent is not an object');
  const direct = typeof agent.id === 'string' && agent.id.length > 0 ? agent.id : undefined;
  let nested;
  if (agent.session !== null && typeof agent.session === 'object') {
    if (typeof agent.session.id === 'string' && agent.session.id.length > 0) nested = agent.session.id;
  }
  if (direct !== undefined && nested !== undefined && direct !== nested) {
    throw sessionError('E_AGENT_IDENTITY', 'The tool execution Agent identity is inconsistent');
  }
  const id = nested !== undefined ? nested : direct;
  if (id === undefined) return null;
  if (id.length > 192) throw sessionError('E_AGENT_IDENTITY', 'The tool execution Agent identity is invalid');
  return id;
}

/** One Host-owned session coordinator. */
export class SessionService {
  /**
   * @param options.ctx - Host plugin context.
   * @param options.bridge - VideoBridge for project facts and logging.
   * @param options.config - normalized trusted config, or null when invalid.
   * @param options.configError - bridge configuration error, when present.
   */
  constructor(options) {
    const settings = options || {};
    this.ctx = settings.ctx;
    this.bridge = settings.bridge;
    this.config = settings.config === undefined ? null : settings.config;
    this.configError = settings.configError === undefined ? null : settings.configError;
    this.logger = this.ctx && this.ctx.logger;
    this.store = new SessionStateStore({
      path: this.config === null ? null : this.config.sessionStatePath,
      allowedProjects: this.config === null ? [] : this.config.projectIds,
      logger: this.logger,
    });
    this.ready = this.store.ready;
    this.contextDispose = null;
    this.creating = new Map();
    this.created = new Map();
    this.cwdPromise = null;
    this.closing = false;
    this.disposed = false;
    this.disposePromise = null;
  }

  service(name) {
    try {
      if (this.ctx && typeof this.ctx.get === 'function') return this.ctx.get(name);
      if (this.ctx) return this.ctx[name];
    } catch (_error) {
      return undefined;
    }
    return undefined;
  }

  report(error, context) {
    try {
      if (this.logger && typeof this.logger.warn === 'function') this.logger.warn(`dsh-video session ${context}: ${logSummary(error)}`);
    } catch (_ignored) {
      /* diagnostics must not break a request */
    }
  }

  /** Configuration failure that disables session features without breaking preview. */
  configurationError() {
    if (this.configError !== null) return this.configError;
    if (this.config === null) return sessionError('E_SESSION_CONFIG', 'Session features need a valid Host configuration');
    if (typeof this.config.sessionStatePath !== 'string' || this.config.sessionStatePath.length === 0) {
      return sessionError('E_SESSION_CONFIG', 'Session features are disabled: "sessionStatePath" is not configured');
    }
    if (typeof this.config.sessionCwd !== 'string' || this.config.sessionCwd.length === 0) {
      return sessionError('E_SESSION_CONFIG', 'Session features are disabled: "sessionCwd" is not configured');
    }
    return null;
  }

  requireEnabled() {
    const error = this.configurationError();
    if (error !== null) throw error;
    return this.config;
  }

  /** Refuse work admitted after shutdown began; accepted work drains instead. */
  requireActive() {
    if (this.closing || this.disposed) throw sessionError('E_SESSION_STATE_DISPOSED', 'The video session service is stopping');
    return true;
  }

  controller() {
    const controller = this.service('sessionController');
    if (controller === null || typeof controller !== 'object' || typeof controller.create !== 'function') {
      throw sessionError('E_SESSION_CONFIG', 'The DSH Session Controller is unavailable');
    }
    return controller;
  }

  async sessionCwd() {
    const config = this.requireEnabled();
    if (this.cwdPromise === null) {
      this.cwdPromise = (async () => {
        if (isAbsolute(config.sessionCwd) === false) throw sessionError('E_SESSION_CONFIG', '"sessionCwd" must be absolute');
        try {
          const real = await realpath(config.sessionCwd);
          if ((await stat(real)).isDirectory() === false) throw new Error('not a directory');
          return real;
        } catch (_error) {
          throw sessionError('E_SESSION_CONFIG', '"sessionCwd" is not an existing directory');
        }
      })();
    }
    return this.cwdPromise;
  }

  /** Observe archived Sessions without activating their Agents, when available. */
  archivedSessionIds() {
    const registry = this.service('workspaceRegistry');
    if (registry !== null && typeof registry === 'object' && Array.isArray(registry.archivedSessionIds)) {
      return new Set(registry.archivedSessionIds);
    }
    return new Set();
  }

  async sessionStatus(sessionId, archived) {
    if (archived.has(sessionId)) return 'archived';
    const controller = this.service('sessionController');
    if (controller === null || typeof controller !== 'object' || typeof controller.inspect !== 'function') return 'unknown';
    try {
      const inspection = await controller.inspect(sessionId);
      return inspection === null || inspection === undefined ? 'unavailable' : 'available';
    } catch (_error) {
      return 'unavailable';
    }
  }

  mappingSync(sessionId) {
    const state = this.store.state;
    if (state === null || this.store.loadError !== null) return null;
    const record = state.sessions[sessionId];
    return record === undefined ? null : record.projectId;
  }

  /** Read-only preflight used by the panel and installation acceptance. */
  async diagnose() {
    const error = this.configurationError();
    const controller = this.service('sessionController');
    const systemPrompt = this.service('systemPrompt');
    return {
      contract: SESSION_STATE_VERSION,
      bundleVersion,
      enabled: error === null,
      error: error === null ? null : error.code,
      controller: controller !== null && typeof controller === 'object' && typeof controller.create === 'function',
      promptContext: systemPrompt !== null && typeof systemPrompt === 'object' && typeof systemPrompt.context === 'function',
      contextRegistered: this.contextDispose !== null,
      store: this.store.diagnose(),
    };
  }

  /** Register the live project-context contribution once; safe to call repeatedly. */
  ensurePromptContext() {
    if (this.contextDispose !== null || this.closing || this.disposed) return;
    const systemPrompt = this.service('systemPrompt');
    if (systemPrompt === null || typeof systemPrompt !== 'object' || typeof systemPrompt.context !== 'function') return;
    try {
      this.contextDispose = systemPrompt.context({
        name: PROMPT_CONTEXT_NAME,
        order: PROMPT_CONTEXT_ORDER,
        text: (assembly) => this.contextText(assembly),
      });
    } catch (error) {
      this.report(error, 'prompt context');
    }
  }

  /** Fresh, bounded project facts for one assembly; never paths or messages. */
  contextText(assembly) {
    try {
      const agent = assembly !== null && typeof assembly === 'object' ? assembly.agent : undefined;
      if (agent === null || agent === undefined) return '';
      let sessionId;
      try {
        sessionId = agentSessionIdFromToolExec({ agent });
      } catch (_error) {
        return '';
      }
      if (sessionId === null) return '';
      const projectId = this.mappingSync(sessionId);
      if (projectId === null) return '';
      const facts = this.bridge && typeof this.bridge.projectFacts === 'function' ? this.bridge.projectFacts(projectId) : null;
      const lines = [
        `This conversation is bound to the video project "${projectId}".`,
        'Use video_engine for project reads and writes; the Host checks this Session against the project mapping on every call.',
      ];
      if (facts !== null) {
        lines.push(`Last known project revision: ${facts.revision}.`);
        if (Number.isFinite(facts.duration)) lines.push(`Project duration: ${facts.duration}s.`);
        if (Number.isFinite(facts.width) && Number.isFinite(facts.height)) lines.push(`Frame: ${facts.width}x${facts.height}.`);
        if (Array.isArray(facts.targets) && facts.targets.length > 0) {
          const targets = facts.targets.slice(0, 12).map((target) => `${target.stableId} [${target.capabilities.join(',')}]`);
          lines.push(`Known editable targets: ${targets.join('; ')}.`);
        }
      } else {
        lines.push('Inspect the project before editing so the revision and target ids are current.');
      }
      return lines.join('\n');
    } catch (_error) {
      return '';
    }
  }

  dedupeKey(projectId, requestId) {
    return `${projectId}\u0000${requestId}`;
  }

  rememberCreated(projectId, requestId, value) {
    if (requestId === undefined) return;
    this.created.set(this.dedupeKey(projectId, requestId), { value, at: Date.now() });
    while (this.created.size > MAX_CREATE_DEDUPE) {
      const oldest = this.created.keys().next().value;
      this.created.delete(oldest);
    }
  }

  async list(projectId) {
    this.requireEnabled();
    this.requireActive();
    const project = await this.store.project(projectId);
    const archived = this.archivedSessionIds();
    const items = [];
    for (const sessionId of project.sessionIds.slice(0, MAX_LIST_ITEMS)) {
      items.push({ sessionId, status: await this.sessionStatus(sessionId, archived) });
    }
    this.ensurePromptContext();
    return {
      enabled: true,
      contract: SESSION_STATE_VERSION,
      projectId,
      activeSessionId: project.activeSessionId,
      sessions: items,
    };
  }

  async create(projectId, requestId) {
    this.requireEnabled();
    this.requireActive();
    if (requestId !== undefined && (typeof requestId !== 'string' || REQUEST_ID_PATTERN.test(requestId) === false)) {
      throw sessionError('E_PARAMS', 'Invalid session create request id');
    }
    // Every known, unrecoverable mapping fault must be rejected before the Host
    // creates anything: a corrupt file, an unknown version, an unregistered
    // project or the per-project cap cannot be repaired by an extra Session.
    const project = await this.store.project(projectId);
    if (project.sessionIds.length >= MAX_SESSIONS_PER_PROJECT) {
      throw sessionError('E_SESSION_STATE_LIMIT', 'This project has too many creation Sessions');
    }
    if (requestId !== undefined) {
      const previous = this.created.get(this.dedupeKey(projectId, requestId));
      if (previous !== undefined) {
        if (previous.value.projectId !== projectId) {
          throw sessionError('E_SESSION_ALREADY_BOUND', 'This create request id belongs to another project');
        }
        return previous.value;
      }
    }
    const existing = this.creating.get(projectId);
    if (existing !== undefined) return existing;
    const ordinal = project.sessionIds.length + 1;
    const task = (async () => {
      const cwd = await this.sessionCwd();
      const controller = this.controller();
      let created;
      try {
        created = await controller.create({ cwd });
      } catch (error) {
        this.report(error, 'create');
        throw sessionError('E_SESSION_CREATE', 'The Host could not create a creation Session');
      }
      const sessionId = created !== null && typeof created === 'object' ? created.sessionId : undefined;
      if (typeof sessionId !== 'string' || SESSION_ID_PATTERN.test(sessionId) === false) {
        throw sessionError('E_SESSION_RESPONSE', 'The Host returned an invalid Session identity');
      }
      // The mapping publish happens only after the durable write committed
      // (SessionStateStore copy-on-write). A disk failure here is reported
      // honestly; the Host Session may already exist and is not claimed rolled back.
      const mapping = await this.store.addSession(projectId, sessionId, true);
      const value = {
        enabled: true,
        contract: SESSION_STATE_VERSION,
        projectId,
        sessionId,
        activeSessionId: mapping.activeSessionId === null ? sessionId : mapping.activeSessionId,
      };
      try {
        if (typeof controller.rename === 'function') {
          const title = `${projectId} · 创作 ${ordinal}`;
          await controller.rename({ sessionId, title });
        }
      } catch (error) {
        this.report(error, 'rename');
      }
      this.rememberCreated(projectId, requestId, value);
      this.ensurePromptContext();
      return value;
    })();
    this.creating.set(projectId, task);
    try {
      return await task;
    } finally {
      this.creating.delete(projectId);
    }
  }

  async select(projectId, sessionId) {
    this.requireEnabled();
    this.requireActive();
    const mapping = await this.store.selectSession(projectId, sessionId);
    this.ensurePromptContext();
    return {
      enabled: true,
      contract: SESSION_STATE_VERSION,
      projectId,
      sessionId,
      activeSessionId: mapping.activeSessionId,
    };
  }

  /** Async project lookup used by tool scope checks. */
  async projectForSession(sessionId) {
    const error = this.configurationError();
    if (error !== null) throw error;
    return this.store.projectForSession(sessionId);
  }

  /** Route one session.* bridge method after parameter validation. */
  async handle(method, params) {
    if (method === 'session.diagnose') return this.diagnose();
    if (method === 'session.list') return this.list(params.projectId);
    if (method === 'session.create') return this.create(params.projectId, params.requestId);
    if (method === 'session.select') return this.select(params.projectId, params.sessionId);
    throw sessionError('E_METHOD', 'Unknown session action');
  }

  dispose() {
    if (this.disposePromise !== null) return this.disposePromise;
    this.closing = true;
    this.disposePromise = (async () => {
      // Accepted, non-cancellable creates (and their renames) must settle and
      // persist before the store or prompt context is torn down. Otherwise a
      // late write would fail against a disposed store and the real Host would
      // keep an unbound Session outside this plugin lifetime.
      await Promise.allSettled([...this.creating.values()]);
      try {
        await this.store.dispose();
      } catch (error) {
        this.report(error, 'state dispose');
      }
      if (this.contextDispose !== null) {
        const dispose = this.contextDispose;
        this.contextDispose = null;
        try {
          dispose();
        } catch (error) {
          this.report(error, 'prompt context cleanup');
        }
      }
      this.disposed = true;
    })();
    return this.disposePromise;
  }
}
