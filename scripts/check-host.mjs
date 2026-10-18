#!/usr/bin/env node
/**
 * Host bridge contract tests (no DSH installation, no real worker).
 *
 * Exercises the same modules package installation uses:
 *   - trusted config validation and preflight registry/output checks;
 *   - explicit worker environment construction;
 *   - lazy single-flight startup and one teardown;
 *   - typed request validation, project allowlist, job ownership and error flags;
 *   - exact Fetch request/artifact routes and Tool dispatcher;
 *   - artifact byte validation (name, root, size, SHA-256);
 *   - P3-012 composition publish/read contract: Tool actions/schema/description,
 *     pre-worker byte/type validation, compose facts + bounded prompt context,
 *     Agent Session project scope, and project.list recency for auto-open.
 *
 * A fake WorkerClient is injected; these are contract tests, not evidence that
 * DSH activation or a real engine subprocess works. Those are staged separately.
 *
 * Run: node scripts/check-host.mjs
 */

import { createHash } from 'node:crypto';
import { access, mkdtemp, mkdir, readFile, readdir, realpath, rm, symlink, utimes, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { homedir, tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { VideoBridge } from '../host/bridge.js';
import { SessionStateStore } from '../host/session-state.js';
import { sessionEventsReferencePath as sessionLogReferencesPath } from '../host/sessions.js';
import { AssetInbox } from '../host/asset-inbox.js';
import { buildWorkerEnv } from '../host/env.js';
import { createRequestRoute, createArtifactRoute, statusForError } from '../host/routes.js';
import { createVideoTool, TOOL_NAME } from '../host/tool.js';
import { BridgeError } from '../host/errors.js';
import { MAX_COMPOSITION_BYTES, MAX_COMPOSITION_ESCAPED_BYTES, TOOL_RESULT_BYTES } from '../host/limits.js';
import { loadEngine } from '../host/engine.js';
import { digestTree, loadStagedHost, sha256 } from './lib/staged-host.mjs';
import { apply } from '../index.js';

const PROJECT = 'demo';
const REVISION = 'a'.repeat(64);
const NEXT_REVISION = 'b'.repeat(64);
const COMPOSITION_HTML = [
  '<!doctype html>',
  '<html><head><meta charset="utf-8"><title>Host contract test</title>',
  '<script src="./assets/gsap.min.js"></script></head>',
  '<body><div id="main" data-composition-id="main" data-width="1280" data-height="720" data-duration="5">',
  '<svg viewBox="0 0 1280 720"><text id="thing" x="40" y="80">Hello</text></svg>',
  '<script>const tl = gsap.timeline(); window.__timelines = { main: tl };</script>',
  '</div></body></html>',
].join('\n');
const JOB_ID = '11111111-2222-4333-8444-555555555555';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nXQAAAAASUVORK5CYII=', 'base64');
const PNG_HASH = createHash('sha256').update(PNG).digest('hex');

let passes = 0;
const failures = [];

class FakeClient {
  constructor(options, behavior) {
    this.options = options;
    this.behavior = behavior || {};
    this.state = 'new';
    this.requests = [];
    this.startCount = 0;
    this.disposeCount = 0;
    this.behavior.instances = this.behavior.instances || [];
    this.behavior.instances.push(this);
  }
  async start() {
    this.startCount += 1;
    if (this.behavior.startGate) await this.behavior.startGate;
    if (this.behavior.startError) throw this.behavior.startError;
    this.state = 'running';
    return { node: 'fake' };
  }
  async request(method, params) {
    this.requests.push({ method, params });
    if (this.behavior.requestError) throw this.behavior.requestError;
    if (typeof this.behavior.handler === 'function') {
      const result = await this.behavior.handler(method, params, this);
      if (result instanceof Error) throw result;
      return result;
    }
    return { method, params };
  }
  async dispose() {
    this.disposeCount += 1;
    this.state = 'disposed';
  }
  debug() {
    return { state: this.state, pending: 0 };
  }
}

async function run(name, fn) {
  try {
    await fn();
    passes += 1;
    console.log(`PASS  ${name}`);
  } catch (error) {
    failures.push([name, error instanceof Error ? error.message : String(error)]);
    console.error(`FAIL  ${name}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function rejects(fn) {
  try {
    await fn();
  } catch (error) {
    return error;
  }
  throw new Error('expected rejection');
}

async function makeWorkspace(overrides) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-video-host-'));
  const projectsRoot = join(root, 'projects');
  const projectDir = join(projectsRoot, PROJECT);
  const outputRoot = join(root, 'output');
  const workerCwd = join(root, 'worker-cwd');
  await mkdir(projectDir, { recursive: true });
  await mkdir(outputRoot, { recursive: true });
  await mkdir(workerCwd, { recursive: true });
  const extraProjects = (overrides && overrides.projects) || {};
  const projectMap = { [PROJECT]: projectDir };
  const extraAllowed = [];
  for (const [id, relativePath] of Object.entries(extraProjects)) {
    const directory = join(projectsRoot, relativePath || id);
    await mkdir(directory, { recursive: true });
    projectMap[id] = directory;
    extraAllowed.push(id);
  }
  const sessionDir = join(root, 'session');
  const sessionCwd = join(sessionDir, 'cwd');
  await mkdir(sessionCwd, { recursive: true });
  const sessionStatePath = join(sessionDir, 'state.json');
  const registryPath = join(root, 'registry.json');
  const registry = Object.assign(
    { root: projectsRoot, projects: projectMap, outputRoot },
    (overrides && overrides.registry) || {}
  );
  await writeFile(registryPath, JSON.stringify(registry));
  const workerEntry = join(root, 'worker.mjs');
  await writeFile(workerEntry, '// fake worker entry\n');
  const config = Object.assign(
    {
      workerNode: process.execPath,
      workerCwd,
      registryPath,
      artifactRoot: outputRoot,
      allowedProjects: [PROJECT, ...extraAllowed],
      sessionStatePath,
      sessionCwd,
      startupTimeoutMs: 1000,
      requestTimeoutMs: 1000,
      shutdownTimeoutMs: 500,
      maxArtifactBytes: 1024 * 1024,
    },
    (overrides && overrides.config) || {}
  );
  return { root, projectDir, outputRoot, workerCwd, registryPath, workerEntry, sessionDir, sessionCwd, sessionStatePath, config, registry };
}

function fakeSessionController(options) {
  const settings = options || {};
  const created = [];
  const renamed = [];
  const inspected = [];
  let counter = 0;
  return {
    created,
    renamed,
    inspected,
    async create(request) {
      counter += 1;
      const sessionId = typeof settings.mint === 'function' ? settings.mint(counter, request) : `session-${counter}`;
      created.push({ request, sessionId });
      return { sessionId };
    },
    async rename(request) {
      renamed.push(request);
      return { title: request.title, seq: 1 };
    },
    async inspect(sessionId) {
      inspected.push(sessionId);
      if (typeof settings.inspect === 'function') return settings.inspect(sessionId);
      if (Array.isArray(settings.missing) && settings.missing.includes(sessionId)) {
        const error = new Error('missing session');
        error.code = 'E_SESSION_MISSING';
        throw error;
      }
      return { meta: { id: sessionId }, events: [] };
    },
  };
}

function fakeEngine(workspace, behavior) {
  const instances = [];
  return {
    instances,
    engineLoader: async () => ({
      WorkerClient: class extends FakeClient {
        constructor(options) {
          super(options, Object.assign({ instances }, behavior || {}));
        }
      },
      workerEntry: workspace.workerEntry,
      workerVersion: '0.1.1',
      clientVersion: '0.1.1',
    }),
  };
}

function engineWithVersion(workspace, version) {
  const instances = [];
  return {
    instances,
    engineLoader: async () => ({
      WorkerClient: class extends FakeClient {
        constructor(options) {
          super(options, { instances });
        }
      },
      workerEntry: workspace.workerEntry,
      workerVersion: '0.1.1',
      clientVersion: version,
    }),
  };
}

function makeCtx(workspace, options) {
  const settings = options || {};
  const routes = [];
  const tools = [];
  const cleanups = [];
  const contextDisposers = [];
  const contexts = [];
  const sessionController = settings.sessionController || fakeSessionController(settings.controller);
  const workspaceRegistry = settings.workspaceRegistry || { archivedSessionIds: [] };
  const systemPrompt = settings.systemPrompt || {
    context(contribution) {
      contexts.push(contribution);
      return function disposeContext() {
        contextDisposers.push(contribution);
      };
    },
  };
  const agentRegistry = settings.agents || { get() { return undefined; } };
  const services = { sessionController, workspaceRegistry, systemPrompt, agents: agentRegistry };
  const ctx = {
    logger: { warn() {} },
    subprocess: {
      async resolveExecutable(command) {
        if (command === workspace.config.workerNode) return process.execPath;
        return command;
      },
    },
    connection: {
      fetch: {
        register(route) {
          routes.push(route);
          return () => {
            const index = routes.indexOf(route);
            if (index >= 0) routes.splice(index, 1);
          };
        },
      },
    },
    tools: {
      register(definition) {
        tools.push(definition);
        return () => {};
      },
    },
    effect(callback) {
      cleanups.push(callback());
      return () => {};
    },
    get(name) {
      return services[name];
    },
  };
  return { ctx, routes, tools, cleanups, services, sessionController, systemPrompt, contexts, contextDisposers };
}

/** Bind a real video project Session through the Host route and return its id. */
async function createBoundSession(bridge, projectId) {
  const created = await bridge.invoke('session.create', { projectId: projectId || PROJECT, requestId: 'test-' + Math.random().toString(36).slice(2) }, { source: 'http' });
  return created.sessionId;
}

/**
 * A worker project.compose result carrying exactly the fields the Host consumes.
 * `scenes: []` is the engine's free-form composition marker from P3-012.
 */
function composeResult(overrides) {
  const bytes = Buffer.byteLength(COMPOSITION_HTML, 'utf8');
  return Object.assign({
    projectId: PROJECT,
    revision: NEXT_REVISION,
    publishedRevision: NEXT_REVISION,
    written: true,
    unchanged: false,
    entry: 'index.html',
    width: 1280,
    height: 720,
    duration: 5,
    bytes,
    assets: ['assets/gsap.min.js'],
    elements: [{ stableId: 'main', capabilities: ['text', 'timing', 'layout', 'style'] }],
    files: [{ path: 'index.html', bytes, sha256: NEXT_REVISION }],
    preview: { mode: 'snapshot', status: 'ready', checked: 'composition+snapshot', revision: NEXT_REVISION },
    scenes: [],
  }, overrides || {});
}

/** The current systemPrompt contribution text for one bound Agent Session. */
function contextTextFor(bag, sessionId) {
  const contribution = bag.contexts[bag.contexts.length - 1];
  if (contribution === undefined) return null;
  return contribution.text({ agent: { session: { id: sessionId } } });
}

function makeBridge(workspace, behavior, ctx) {
  const engine = fakeEngine(workspace, behavior);
  const bridge = new VideoBridge({
    ctx: ctx || makeCtx(workspace).ctx,
    rawConfig: workspace.config,
    engineLoader: engine.engineLoader,
  });
  return { bridge, engine };
}

/** Build a bridge with trusted config overrides (e.g. an asset inbox root). */
function makeBridgeWithConfig(workspace, configOverrides, behavior, ctx) {
  const engine = fakeEngine(workspace, behavior);
  const bridge = new VideoBridge({
    ctx: ctx || makeCtx(workspace).ctx,
    rawConfig: Object.assign({}, workspace.config, configOverrides),
    engineLoader: engine.engineLoader,
  });
  return { bridge, engine };
}

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch (_error) {
    return false;
  }
}

async function listIfPresent(directory) {
  try {
    return await readdir(directory);
  } catch (_error) {
    return [];
  }
}

async function uploadPng(bridge, projectId, name, bytes) {
  const request = new Request('http://127.0.0.1/api/dsh-video/asset-upload', {
    method: 'POST',
    headers: { 'content-type': 'image/png', 'x-dsh-project-id': projectId, 'x-dsh-file-name': name || 'pixel.png' },
    body: bytes || PNG,
  });
  const response = await bridge.uploadAsset(request);
  let body = null;
  try {
    body = await response.json();
  } catch (_error) {
    body = null;
  }
  return { response, body };
}

/** Direct inbox upload used for lifecycle tests (no bridge allowlist in the way). */
function inboxUpload(inbox, projectId, name, bytes, mediaType) {
  return inbox.handle(new Request('http://127.0.0.1/api/dsh-video/asset-upload', {
    method: 'POST',
    headers: {
      'content-type': mediaType || 'image/png',
      'x-dsh-project-id': projectId,
      'x-dsh-file-name': name,
    },
    body: bytes === undefined ? PNG : bytes,
  }));
}

function jobResponse(method, params, state) {
  return {
    jobId: JOB_ID,
    projectId: params.projectId,
    revision: params.revision,
    kind: method,
    state: state || 'queued',
    stage: 'snapshot',
    progress: 0,
  };
}

function artifactFor(name, bytes, hash) {
  return {
    projectId: PROJECT,
    revision: REVISION,
    jobId: JOB_ID,
    name,
    hash: hash || PNG_HASH,
    bytes: bytes === undefined ? PNG.length : bytes.length,
    metadata: { width: 1280, height: 720 },
    tools: { node: 'fake' },
  };
}

async function main() {
  await run('environment allowlist removes Electron/Node/IPC variables without mutating source', async () => {
    const source = {
      PATH: '/bin',
      HOME: '/home/u',
      LANG: 'zh_CN.UTF-8',
      ELECTRON_RUN_AS_NODE: '1',
      NODE_OPTIONS: '--inspect',
      NODE_CHANNEL_FD: '3',
      DSH_PROFILE: 'desktop',
      npm_config_cache: '/tmp/x',
    };
    const env = buildWorkerEnv(source);
    assert(env.PATH === '/bin' && env.HOME === '/home/u' && env.LANG === 'zh_CN.UTF-8', 'allowed values missing');
    for (const key of ['ELECTRON_RUN_AS_NODE', 'NODE_OPTIONS', 'NODE_CHANNEL_FD', 'DSH_PROFILE', 'npm_config_cache']) {
      assert(key in env === false, `${key} leaked into worker environment`);
    }
    assert(source.ELECTRON_RUN_AS_NODE === '1', 'source environment was mutated');
  });

  await run('missing or malformed trusted config returns E_CONFIGURATION without throwing apply', async () => {
    const ctx = makeCtx({ config: {} });
    const bridge = new VideoBridge({ ctx: ctx.ctx, rawConfig: undefined });
    const error = await rejects(() => bridge.invoke('doctor', {}));
    assert(error instanceof BridgeError && error.code === 'E_CONFIGURATION', `unexpected ${error && error.code}`);
    const bad = new VideoBridge({ ctx: ctx.ctx, rawConfig: { allowedProjects: [] } });
    const badError = await rejects(() => bad.invoke('doctor', {}));
    assert(badError.code === 'E_CONFIGURATION', 'malformed config accepted');
  });

  await run('config paths must be absolute and the registry allowlist preflight is enforced', async () => {
    const workspace = await makeWorkspace();
    const engine = fakeEngine(workspace, {});
    const relative = new VideoBridge({
      ctx: makeCtx(workspace).ctx,
      rawConfig: Object.assign({}, workspace.config, { registryPath: 'registry.json' }),
      engineLoader: engine.engineLoader,
    });
    let error = await rejects(() => relative.invoke('doctor', {}));
    assert(error.code === 'E_CONFIGURATION', 'relative registryPath accepted');

    const mismatched = new VideoBridge({
      ctx: makeCtx(workspace).ctx,
      rawConfig: Object.assign({}, workspace.config, { artifactRoot: workspace.workerCwd }),
      engineLoader: engine.engineLoader,
    });
    error = await rejects(() => mismatched.invoke('doctor', {}));
    assert(error.code === 'E_CONFIGURATION', 'registry.outputRoot/artifactRoot mismatch accepted');
  });

  await run('unknown project, path-like project and extra parameters are rejected before worker start', async () => {
    const workspace = await makeWorkspace();
    const { bridge, engine } = makeBridge(workspace, {});
    for (const params of [
      { projectId: 'other' },
      { projectId: '../demo' },
      { projectId: '/tmp/demo' },
      { projectId: 'https://example.test/demo' },
      { projectId: PROJECT, path: '/tmp/x' },
    ]) {
      const error = await rejects(() => bridge.invoke('open', params));
      assert(error instanceof BridgeError, 'not a BridgeError');
      assert(['E_PROJECT_NOT_FOUND', 'E_PARAMS'].includes(error.code), `unexpected code ${error.code}`);
    }
    assert(engine.instances.length === 0, 'worker started for a rejected request');
  });

  await run('typed edit parameters mirror the worker contract', async () => {
    const workspace = await makeWorkspace();
    const { bridge, engine } = makeBridge(workspace, { handler: (method, params) => (method === 'edit' ? { projectId: PROJECT, revision: REVISION, operationId: params.operationId } : {}) });
    const good = await bridge.invoke('edit', {
      projectId: PROJECT,
      expectedRevision: REVISION,
      operationId: 'edit-1',
      ops: [{ type: 'text', target: 'hf-title', text: 'hello' }, { type: 'timing', target: 'hf-title', start: 1 }],
    });
    assert(good.revision === REVISION, 'edit result missing');
    for (const ops of [
      [],
      [{ type: 'text', target: 'hf-title', text: 'x'.repeat(2049) }],
      [{ type: 'text', target: 'hf-title', text: 'x', path: '/tmp/a' }],
      [{ type: 'timing', target: 'hf-title' }],
      [{ type: 'unknown', target: 'hf-title' }],
    ]) {
      const error = await rejects(() => bridge.invoke('edit', { projectId: PROJECT, expectedRevision: REVISION, operationId: 'edit-2', ops }));
      assert(error.code === 'E_PARAMS', `unexpected code for bad ops: ${error.code}`);
    }
    assert(engine.instances[0].requests.length === 1, 'invalid edit reached the worker');
  });

  await run('concurrent first requests share one lazy start', async () => {
    let release;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    const workspace = await makeWorkspace();
    const engine = fakeEngine(workspace, { startGate: gate, handler: () => ({ ok: true }) });
    const bridge = new VideoBridge({ ctx: makeCtx(workspace).ctx, rawConfig: workspace.config, engineLoader: engine.engineLoader });
    const first = bridge.invoke('doctor', {});
    const second = bridge.invoke('doctor', {});
    release();
    await Promise.all([first, second]);
    assert(engine.instances.length === 1, `created ${engine.instances.length} clients`);
    assert(engine.instances[0].startCount === 1, `started ${engine.instances[0].startCount} times`);
  });

  await run('job ownership is fenced and job-shaped responses are validated', async () => {
    const workspace = await makeWorkspace();
    const { bridge, engine } = makeBridge(workspace, {
      handler: (method, params) => {
        if (method === 'frame') return jobResponse(method, params);
        if (method === 'status') return Object.assign(jobResponse('frame', { projectId: PROJECT, revision: REVISION }), { state: 'queued' });
        return {};
      },
    });
    const unknownStatus = await rejects(() => bridge.invoke('status', { jobId: JOB_ID }));
    assert(unknownStatus.code === 'E_JOB_NOT_FOUND', 'unknown job status accepted before registration');
    const frame = await bridge.invoke('frame', { projectId: PROJECT, revision: REVISION, time: 2.5 });
    assert(frame.jobId === JOB_ID, 'frame job id missing');
    const status = await bridge.invoke('status', { jobId: JOB_ID });
    assert(status.projectId === PROJECT, 'status lost project');
    assert(engine.instances[0].requests.some((entry) => entry.method === 'status'), 'status was not forwarded');

    const badWorkspace = await makeWorkspace();
    const broken = makeBridge(badWorkspace, {
      handler: (method, params) => (method === 'frame' ? Object.assign(jobResponse(method, params), { projectId: 'other' }) : {}),
    });
    const error = await rejects(() => broken.bridge.invoke('frame', { projectId: PROJECT, revision: REVISION, time: 1 }));
    assert(error.code === 'E_WORKER_RESPONSE', `mismatched job accepted: ${error.code}`);
  });

  await run('artifact bytes are re-validated against the worker record', async () => {
    const workspace = await makeWorkspace();
    await writeFile(join(workspace.outputRoot, `${JOB_ID}.png`), PNG);
    const { bridge } = makeBridge(workspace, {
      handler: (method, params) => {
        if (method === 'frame') return jobResponse(method, params);
        if (method === 'status') {
          return Object.assign(jobResponse('frame', { projectId: PROJECT, revision: REVISION }), {
            state: 'succeeded',
            artifact: artifactFor(`${JOB_ID}.png`, PNG, PNG_HASH),
          });
        }
        return {};
      },
    });
    await bridge.invoke('frame', { projectId: PROJECT, revision: REVISION, time: 2.5 });
    const artifact = await bridge.readArtifact(JOB_ID);
    assert(artifact.mediaType === 'image/png', 'wrong media type');
    assert(artifact.size === PNG.length, 'wrong size');
    assert(artifact.hash === PNG_HASH, 'wrong hash');
    assert(Buffer.compare(Buffer.from(artifact.bytes), PNG) === 0, 'wrong bytes');

    const unknown = await rejects(() => bridge.readArtifact('22222222-2222-4333-8444-555555555555'));
    assert(unknown.code === 'E_JOB_NOT_FOUND', 'unknown artifact job accepted');
  });

  await run('artifact rejects wrong hash, traversal names, unresolved jobs and oversized files', async () => {
    const workspace = await makeWorkspace();
    await writeFile(join(workspace.outputRoot, `${JOB_ID}.png`), PNG);
    let artifactMode = 'bad-hash';
    const { bridge } = makeBridge(workspace, {
      handler: (method, params) => {
        if (method === 'frame') return jobResponse(method, params);
        if (method === 'status') {
          let artifact = artifactFor(`${JOB_ID}.png`, PNG, artifactMode === 'bad-hash' ? 'b'.repeat(64) : PNG_HASH);
          if (artifactMode === 'traversal') artifact = artifactFor(`../${JOB_ID}.png`, PNG, PNG_HASH);
          if (artifactMode === 'not-ready') {
            return Object.assign(jobResponse('frame', { projectId: PROJECT, revision: REVISION }), { state: 'running' });
          }
          return Object.assign(jobResponse('frame', { projectId: PROJECT, revision: REVISION }), { state: 'succeeded', artifact });
        }
        return {};
      },
    });
    await bridge.invoke('frame', { projectId: PROJECT, revision: REVISION, time: 2.5 });
    for (const [mode, code] of [['bad-hash', 'E_ARTIFACT_INTEGRITY'], ['traversal', 'E_ARTIFACT_INTEGRITY'], ['not-ready', 'E_ARTIFACT_NOT_READY']]) {
      artifactMode = mode;
      const error = await rejects(() => bridge.readArtifact(JOB_ID));
      assert(error.code === code, `${mode}: ${error.code}`);
    }

    const limitedWorkspace = await makeWorkspace({ config: { maxArtifactBytes: 1024 } });
    const oversized = Buffer.alloc(2048, 7);
    const oversizedHash = createHash('sha256').update(oversized).digest('hex');
    await writeFile(join(limitedWorkspace.outputRoot, `${JOB_ID}.png`), oversized);
    const limited = makeBridge(limitedWorkspace, {
      handler: (method, params) => {
        if (method === 'frame') return jobResponse(method, params);
        if (method === 'status') return Object.assign(jobResponse('frame', { projectId: PROJECT, revision: REVISION }), { state: 'succeeded', artifact: artifactFor(`${JOB_ID}.png`, oversized, oversizedHash) });
        return {};
      },
    });
    await limited.bridge.invoke('frame', { projectId: PROJECT, revision: REVISION, time: 1 });
    const limitError = await rejects(() => limited.bridge.readArtifact(JOB_ID));
    assert(limitError.code === 'E_ARTIFACT_LIMIT', `oversize artifact: ${limitError.code}`);
  });

  await run('request route enforces JSON/body/typed dispatch and maps errors', async () => {
    const workspace = await makeWorkspace();
    const { bridge } = makeBridge(workspace, {
      handler: (method, params) => (method === 'open' ? { projectId: PROJECT, revision: REVISION, width: 1280, height: 720, duration: 5, elements: [] } : {}),
    });
    const route = createRequestRoute(bridge);
    assert(route.path === '/api/dsh-video/request' && route.methods.join(',') === 'POST', 'route shape');

    const headers = { 'content-type': 'application/json' };
    const ok = await route.fetch(new Request('http://localhost/api/dsh-video/request', { method: 'POST', headers, body: JSON.stringify({ method: 'open', params: { projectId: PROJECT } }) }));
    assert(ok.status === 200, `success status ${ok.status}`);
    const okBody = await ok.json();
    assert(okBody.ok === true && okBody.result.width === 1280, 'success body');

    const unknown = await route.fetch(new Request('http://localhost/api/dsh-video/request', { method: 'POST', headers, body: JSON.stringify({ method: 'status', params: { jobId: JOB_ID } }) }));
    assert(unknown.status === 404, `unknown job status ${unknown.status}`);

    const badJson = await route.fetch(new Request('http://localhost/api/dsh-video/request', { method: 'POST', headers, body: '{' }));
    assert(badJson.status === 400, `bad JSON status ${badJson.status}`);
    const extra = await route.fetch(new Request('http://localhost/api/dsh-video/request', { method: 'POST', headers, body: JSON.stringify({ method: 'open', params: { projectId: PROJECT }, path: '/tmp/x' }) }));
    assert(extra.status === 400, `extra body field status ${extra.status}`);
    const noType = await route.fetch(new Request('http://localhost/api/dsh-video/request', { method: 'POST', body: JSON.stringify({ method: 'doctor', params: {} }) }));
    assert(noType.status === 415, `content type status ${noType.status}`);
    assert(statusForError(new BridgeError('E_ARTIFACT_INTEGRITY', 'x', { stage: 'artifact' })) === 500, 'integrity status mapping');
  });

  await run('artifact route serves only known succeeded bytes and supports HEAD', async () => {
    const workspace = await makeWorkspace();
    await writeFile(join(workspace.outputRoot, `${JOB_ID}.png`), PNG);
    const { bridge } = makeBridge(workspace, {
      handler: (method, params) => {
        if (method === 'frame') return jobResponse(method, params);
        if (method === 'status') return Object.assign(jobResponse('frame', { projectId: PROJECT, revision: REVISION }), { state: 'succeeded', artifact: artifactFor(`${JOB_ID}.png`, PNG, PNG_HASH) });
        return {};
      },
    });
    await bridge.invoke('frame', { projectId: PROJECT, revision: REVISION, time: 1 });
    const route = createArtifactRoute(bridge);
    assert(route.methods.join(',') === 'GET,HEAD', 'artifact methods');
    const get = await route.fetch(new Request(`http://localhost/api/dsh-video/artifact?jobId=${JOB_ID}`));
    assert(get.status === 200, `artifact status ${get.status}`);
    assert(get.headers.get('content-type') === 'image/png', 'artifact content type');
    assert(get.headers.get('cache-control') === 'no-store', 'artifact cache header');
    assert(Buffer.compare(Buffer.from(await get.arrayBuffer()), PNG) === 0, 'artifact bytes');
    const head = await route.fetch(new Request(`http://localhost/api/dsh-video/artifact?jobId=${JOB_ID}`, { method: 'HEAD' }));
    assert(head.status === 200 && head.body === null, 'HEAD body/status');
    const extra = await route.fetch(new Request(`http://localhost/api/dsh-video/artifact?jobId=${JOB_ID}&name=x`));
    assert(extra.status === 400, `extra artifact query accepted: ${extra.status}`);
  });

  await run('dispose refuses new work, awaits accepted requests and tears down once', async () => {
    let release;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    const workspace = await makeWorkspace();
    const { bridge, engine } = makeBridge(workspace, {
      handler: async () => {
        await gate;
        return {};
      },
    });
    const running = bridge.invoke('doctor', {});
    await new Promise((resolve) => setImmediate(resolve));
    const disposing = bridge.dispose();
    const refused = await rejects(() => bridge.invoke('doctor', {}));
    assert(refused.code === 'E_WORKER_DISPOSED', `dispose did not refuse: ${refused.code}`);
    release();
    await running;
    await disposing;
    assert(engine.instances[0].disposeCount === 1, `disposed ${engine.instances[0].disposeCount} times`);
    await bridge.dispose();
    assert(engine.instances[0].disposeCount === 1, 'dispose is not idempotent');
  });

  await run('startup failure is bounded and retryable by a later explicit request', async () => {
    const workspace = await makeWorkspace();
    let attempts = 0;
    const engineLoader = async () => ({
      WorkerClient: class extends FakeClient {
        constructor(options) {
          super(options, {
            startGate: undefined,
            startError: attempts++ === 0 ? new BridgeError('E_WORKER_START', 'boom', { stage: 'start' }) : undefined,
          });
        }
      },
      workerEntry: workspace.workerEntry,
      workerVersion: '0.1.1',
      clientVersion: '0.1.1',
    });
    const bridge = new VideoBridge({ ctx: makeCtx(workspace).ctx, rawConfig: workspace.config, engineLoader });
    const first = await rejects(() => bridge.invoke('doctor', {}));
    assert(first.code === 'E_WORKER_START', `unexpected first error ${first.code}`);
    await bridge.invoke('doctor', {});
    assert(attempts === 2, `expected two explicit start attempts, got ${attempts}`);
  });

  await run('Tool uses the same dispatcher and preserves error structure', async () => {
    const workspace = await makeWorkspace();
    let openCalls = 0;
    const bag = makeCtx(workspace);
    const { bridge, engine } = makeBridge(workspace, {
      handler: (method, params) => {
        if (method === 'open') {
          openCalls += 1;
          if (openCalls === 1) return { projectId: params.projectId, revision: REVISION };
          const error = new Error('conflict');
          error.code = 'E_REVISION_CONFLICT';
          error.stage = 'edit';
          error.uncertain = true;
          return error;
        }
        return { projectId: params.projectId, revision: REVISION };
      },
    }, bag.ctx);
    const sessionId = await createBoundSession(bridge);
    const exec = { agent: { session: { id: sessionId } } };
    const tool = createVideoTool(bridge);
    assert(tool.name === TOOL_NAME, 'tool name');
    assert(tool.parameters.additionalProperties === false, 'tool must reject extra params');
    const doctor = await tool.execute({ action: 'doctor' }, {});
    assert(doctor.action === 'doctor', 'doctor must stay available without a binding');
    const first = await tool.execute({ action: 'open', projectId: PROJECT }, exec);
    assert(first.result.revision === REVISION, 'tool result');
    assert(engine.instances[0].requests.some((request) => request.method === 'open'), 'tool did not use the dispatcher');
    const error = await rejects(() => tool.execute({ action: 'open', projectId: PROJECT }, exec));
    assert(error.message.includes('E_REVISION_CONFLICT') && error.message.includes('uncertain=true'), 'tool error lost structure');
    const bad = await rejects(() => tool.execute({ action: 'open', projectId: PROJECT, path: '/tmp/x' }, exec));
    assert(bad.message.includes('E_PARAMS'), 'tool accepted an extra path parameter');
    const anonymous = await rejects(() => tool.execute({ action: 'open', projectId: PROJECT }, {}));
    assert(anonymous.message.includes('E_AGENT_REQUIRED'), 'unbound Tool execution was not refused');
    const mismatched = await rejects(() => tool.execute({ action: 'open', projectId: PROJECT }, { agent: { id: 'session-other', session: { id: sessionId } } }));
    assert(mismatched.message.includes('E_AGENT_IDENTITY'), 'inconsistent Agent identity was not refused');
  });

  await run('engine loader resolves the reviewed worker/client entries from the installed bundle context', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-video-engine-resolve-'));
    const bundle = join(root, 'bundle');
    const client = join(root, 'engine-client');
    const worker = join(root, 'engine-worker');
    await mkdir(join(bundle, 'node_modules'), { recursive: true });
    await mkdir(join(client), { recursive: true });
    await mkdir(join(worker), { recursive: true });
    await writeFile(join(bundle, 'index.js'), '// staged bundle entry\n');
    await writeFile(join(client, 'package.json'), JSON.stringify({ name: 'dsh-video-engine-client', version: '0.1.1', private: true, type: 'module', exports: { '.': './index.js', './package.json': './package.json' } }));
    await writeFile(join(client, 'index.js'), 'export class WorkerClient { constructor(options) { this.options = options; } async start() {} async request() {} async dispose() {} debug() { return { state: "new" }; } }\n');
    await writeFile(join(worker, 'package.json'), JSON.stringify({ name: 'dsh-video-engine-worker', version: '0.1.1', private: true, type: 'module', exports: { './worker': './src/worker.mjs', './package.json': './package.json' } }));
    await mkdir(join(worker, 'src'), { recursive: true });
    await writeFile(join(worker, 'src', 'worker.mjs'), '// worker entry\n');
    await symlink(join('..', '..', 'engine-client'), join(bundle, 'node_modules', 'dsh-video-engine-client'), 'dir');
    await symlink(join('..', '..', 'engine-worker'), join(bundle, 'node_modules', 'dsh-video-engine-worker'), 'dir');
    const engine = await loadEngine({ baseUrl: pathToFileURL(join(bundle, 'index.js')).href });
    assert(typeof engine.WorkerClient === 'function', 'loader did not load WorkerClient');
    assert(engine.workerVersion === '0.1.1' && engine.clientVersion === '0.1.1', 'loader lost package versions');
    assert(engine.workerEntry.endsWith(join('src', 'worker.mjs')), `loader returned worker entry ${engine.workerEntry}`);
    await rm(root, { recursive: true, force: true });
  });

  await run('R4: strict client version gate rejects 0.1.0/invalid and accepts 0.1.1', async () => {
    const workspace = await makeWorkspace();
    for (const version of ['0.1.0', '0.1', '0.1.1.0', 'unknown', undefined, null]) {
      const engine = engineWithVersion(workspace, version);
      const bridge = new VideoBridge({ ctx: makeCtx(workspace).ctx, rawConfig: workspace.config, engineLoader: engine.engineLoader });
      const error = await rejects(() => bridge.invoke('doctor', {}));
      assert(error instanceof BridgeError && error.code === 'E_CONFIGURATION', `version ${String(version)} was not rejected with E_CONFIGURATION: ${error && error.code}`);
      assert(engine.instances.length === 0 || engine.instances[0].startCount === 0, `version ${String(version)} started the worker before rejection`);
    }
    const acceptedEngine = engineWithVersion(workspace, '0.1.1');
    const accepted = new VideoBridge({ ctx: makeCtx(workspace).ctx, rawConfig: workspace.config, engineLoader: acceptedEngine.engineLoader });
    await accepted.invoke('doctor', {});
    assert(acceptedEngine.instances.length === 1 && acceptedEngine.instances[0].startCount === 1, '0.1.1 was not accepted');
    const newerEngine = engineWithVersion(workspace, '0.2.0');
    const newer = new VideoBridge({ ctx: makeCtx(workspace).ctx, rawConfig: workspace.config, engineLoader: newerEngine.engineLoader });
    await newer.invoke('doctor', {});
    assert(newerEngine.instances.length === 1, 'later valid versions were not accepted');
  });

  await run('R2: Tool execute and render share one raw UTF-8 byte budget without truncation', async () => {
    const fakeBridge = { invoke: async () => ({ text: 'x'.repeat(9000) }) };
    const tool = createVideoTool(fakeBridge);
    const value = await tool.execute({ action: 'open', projectId: PROJECT }, {});
    const rendered = tool.output.render({}, value);
    assert(Array.isArray(rendered) && rendered.length === 1 && rendered[0].type === 'text', 'render output shape changed');
    const parsed = JSON.parse(rendered[0].text);
    assert(parsed.result.text.length === 9000, `render truncated to ${parsed.result.text.length} chars`);
    assert(rendered[0].text.length > 9000, 'render lost the complete result');
    const bytes = Buffer.byteLength(rendered[0].text, 'utf8');
    assert(bytes <= TOOL_RESULT_BYTES, `rendered text exceeds budget: ${bytes}`);

    const multilingual = { invoke: async () => ({ text: '中😀'.repeat(3000) }) };
    const multilingualTool = createVideoTool(multilingual);
    const multilingualValue = await multilingualTool.execute({ action: 'open', projectId: PROJECT }, {});
    const multilingualText = multilingualTool.output.render({}, multilingualValue)[0].text;
    const multilingualParsed = JSON.parse(multilingualText);
    assert(multilingualParsed.result.text === '中😀'.repeat(3000), 'multibyte result was altered');
    assert(Buffer.byteLength(multilingualText, 'utf8') <= TOOL_RESULT_BYTES, 'multibyte result exceeds budget');

    const over = { invoke: async () => ({ text: 'x'.repeat(TOOL_RESULT_BYTES + 100) }) };
    const overTool = createVideoTool(over);
    const error = await rejects(() => overTool.execute({ action: 'open', projectId: PROJECT }, {}));
    assert(error.message.includes('E_RESULT_LIMIT'), `over-limit execute was not explicit: ${error.message}`);
  });

  await run('R2: Bridge rejects an over-budget Tool result before a wrapper can shorten it', async () => {
    const workspace = await makeWorkspace();
    const bag = makeCtx(workspace);
    const { bridge } = makeBridge(workspace, {
      handler: (method) => (method === 'open' ? { text: 'x'.repeat(70000) } : {}),
    }, bag.ctx);
    const sessionId = await createBoundSession(bridge);
    const error = await rejects(() => bridge.invoke('open', { projectId: PROJECT }, { source: 'tool', agentSessionId: sessionId }));
    assert(error.code === 'E_RESULT_LIMIT', `unexpected bridge limit error ${error.code}`);
  });

  await run('sessions: create persists the returned id with trusted cwd and dedupes requests', async () => {
    const workspace = await makeWorkspace();
    const bag = makeCtx(workspace);
    const { bridge } = makeBridge(workspace, { handler: () => ({}) }, bag.ctx);
    const first = await bridge.invoke('session.create', { projectId: PROJECT, requestId: 'req-create-1' }, { source: 'http' });
    const repeated = await bridge.invoke('session.create', { projectId: PROJECT, requestId: 'req-create-1' }, { source: 'http' });
    assert(first.sessionId === repeated.sessionId, 'requestId did not dedupe');
    assert(bag.sessionController.created.length === 1, 'a duplicate create reached the controller');
    const [left, right] = await Promise.all([
      bridge.invoke('session.create', { projectId: PROJECT }, { source: 'http' }),
      bridge.invoke('session.create', { projectId: PROJECT }, { source: 'http' }),
    ]);
    assert(left.sessionId === right.sessionId, 'concurrent creates did not share one single-flight operation');
    assert(bag.sessionController.created.length === 2, `expected two controller creates, got ${bag.sessionController.created.length}`);
    const trustedCwd = await realpath(workspace.sessionCwd);
    // New Sessions start in the trusted per-project Session root so their files
    // are attributable to exactly this project, not the shared root.
    const projectCwd = await realpath(join(trustedCwd, PROJECT));
    assert(bag.sessionController.created[0].request.cwd === projectCwd, 'creation did not use the trusted per-project Session root');
    assert(projectCwd.startsWith(trustedCwd + '/'), 'per-project Session root is not inside sessionCwd');
    const stored = JSON.parse(await readFile(workspace.sessionStatePath, 'utf8'));
    assert(stored.version === 1 && stored.projects[PROJECT].sessionIds.includes(first.sessionId), 'mapping did not persist the returned id');
    assert(stored.sessions[first.sessionId].projectId === PROJECT, 'reverse mapping missing');
    const list = await bridge.invoke('session.list', { projectId: PROJECT }, { source: 'http' });
    assert(list.enabled === true && list.activeSessionId === right.sessionId, 'active session was not persisted');
    assert(list.sessions.length === 2 && list.sessions.every((item) => item.status === 'available'), 'session status list is wrong');
    const selected = await bridge.invoke('session.select', { projectId: PROJECT, sessionId: first.sessionId }, { source: 'http' });
    assert(selected.activeSessionId === first.sessionId, 'select did not update the active session');
    const badRequest = await rejects(() => bridge.invoke('session.create', { projectId: PROJECT, requestId: 'bad id!' }, { source: 'http' }));
    assert(badRequest.code === 'E_PARAMS', 'invalid requestId was accepted');
  });

  await run('sessions: mapping survives reload; unregistered ids and corrupt state are rejected without data loss', async () => {
    const workspace = await makeWorkspace();
    const firstBag = makeCtx(workspace);
    const first = makeBridge(workspace, { handler: () => ({}) }, firstBag.ctx).bridge;
    const created = await first.invoke('session.create', { projectId: PROJECT, requestId: 'reload-1' }, { source: 'http' });
    await first.dispose();
    const secondBag = makeCtx(workspace);
    const second = makeBridge(workspace, { handler: () => ({}) }, secondBag.ctx).bridge;
    const list = await second.invoke('session.list', { projectId: PROJECT }, { source: 'http' });
    assert(list.activeSessionId === created.sessionId && list.sessions[0].status === 'available', 'mapping did not survive a reload');
    const cross = await rejects(() => second.invoke('session.select', { projectId: PROJECT, sessionId: 'session-unregistered' }, { source: 'http' }));
    assert(cross.code === 'E_SESSION_NOT_BOUND', `unregistered session select was not rejected: ${cross.code}`);
    await second.dispose();

    const corruptLiteral = '{not json';
    await writeFile(workspace.sessionStatePath, corruptLiteral);
    const thirdBag = makeCtx(workspace);
    const third = makeBridge(workspace, { handler: () => ({}) }, thirdBag.ctx).bridge;
    const corrupt = await rejects(() => third.invoke('session.list', { projectId: PROJECT }, { source: 'http' }));
    assert(corrupt.code === 'E_SESSION_STATE_CORRUPT', `corrupt state was not typed: ${corrupt.code}`);
    assert((await readFile(workspace.sessionStatePath, 'utf8')) === corruptLiteral, 'corrupt state file was rewritten');
    await third.dispose();

    await writeFile(workspace.sessionStatePath, JSON.stringify({ version: 99, projects: {}, sessions: {} }));
    const fourthBag = makeCtx(workspace);
    const fourth = makeBridge(workspace, { handler: () => ({}) }, fourthBag.ctx).bridge;
    const versionError = await rejects(() => fourth.invoke('session.list', { projectId: PROJECT }, { source: 'http' }));
    assert(versionError.code === 'E_SESSION_STATE_VERSION', `unknown version was not typed: ${versionError.code}`);
    await fourth.dispose();
  });

  await run('sessions: missing session configuration disables only the session features', async () => {
    const workspace = await makeWorkspace({ config: { sessionStatePath: undefined, sessionCwd: undefined } });
    const bag = makeCtx(workspace);
    const { bridge } = makeBridge(workspace, { handler: () => ({}) }, bag.ctx);
    const disabled = await rejects(() => bridge.invoke('session.list', { projectId: PROJECT }, { source: 'http' }));
    assert(disabled.code === 'E_SESSION_CONFIG', `unconfigured session feature did not report E_SESSION_CONFIG: ${disabled.code}`);
    const doctor = await bridge.invoke('doctor', {}, { source: 'http' });
    assert(doctor !== null && typeof doctor === 'object', 'preview/doctor path must keep working without session config');
  });


  await run('P3-006-C: preview reads only this project\'s owned roots without starting the worker', async () => {
    const workspace = await makeWorkspace();
    const inboxRoot = join(workspace.root, 'asset-inbox');
    const bag = makeCtx(workspace);
    const { bridge, engine } = makeBridgeWithConfig(workspace, { assetInboxRoot: inboxRoot }, { handler: () => ({}) }, bag.ctx);
    const sessionId = await createBoundSession(bridge);

    // 1. This project's trusted managed content directory.
    const projectFile = join(workspace.projectDir, 'assets', 'own.png');
    await mkdir(join(workspace.projectDir, 'assets'), { recursive: true });
    await writeFile(projectFile, PNG);
    const projectPreview = await bridge.invoke('preview', { projectId: PROJECT, sessionId, path: projectFile }, { source: 'http' });
    assert(projectPreview.mediaType === 'image/png' && projectPreview.sha256 === PNG_HASH, 'own project file preview was denied');
    // Markdown local image links reach the Host as a file:// address.
    const fileUrlPreview = await bridge.invoke('preview', { projectId: PROJECT, sessionId, path: pathToFileURL(projectFile).href }, { source: 'http' });
    assert(fileUrlPreview.sha256 === PNG_HASH, 'file:// local-link preview of an own project file was denied');

    // 2. This project's recorded job artifact is attributed through the job registry.
    bridge.jobs.set(JOB_ID, { projectId: PROJECT, revision: REVISION, kind: 'frame' });
    const artifactFile = join(workspace.outputRoot, `${JOB_ID}.png`);
    await writeFile(artifactFile, PNG);
    const artifactPreview = await bridge.invoke('preview', { projectId: PROJECT, sessionId, path: artifactFile }, { source: 'http' });
    assert(artifactPreview.fileName === `${JOB_ID}.png` && artifactPreview.sha256 === PNG_HASH, 'own job artifact preview was denied');
    assert(artifactPreview.dataUrl.includes(artifactFile) === false, 'preview leaked an absolute Host path into the data URL');

    // 3. A Host-issued upload receipt target is owned by the project it was issued to.
    const upload = await uploadPng(bridge, PROJECT, 'receipt.png');
    assert(upload.response.status === 200 && typeof upload.body.receiptId === 'string', `receipt upload failed: ${JSON.stringify(upload.body)}`);
    const receiptName = (await readdir(inboxRoot)).find((name) => name.endsWith('receipt.png'));
    assert(typeof receiptName === 'string', 'uploaded receipt file is missing');
    const receiptTarget = join(inboxRoot, receiptName);
    const receiptPreview = await bridge.invoke('preview', { projectId: PROJECT, sessionId, path: receiptTarget }, { source: 'http' });
    assert(receiptPreview.sha256 === PNG_HASH, 'Host-issued upload receipt file was not previewable');

    // 4. This project's own per-project Session working directory, absolute and relative.
    const projectSessionRoot = await realpath(join(workspace.sessionCwd, PROJECT));
    await writeFile(join(projectSessionRoot, 'manual.png'), PNG);
    const sessionPreview = await bridge.invoke('preview', { projectId: PROJECT, sessionId, path: join(projectSessionRoot, 'manual.png') }, { source: 'http' });
    assert(sessionPreview.sha256 === PNG_HASH, 'own Session file preview was denied');
    const relativePreview = await bridge.invoke('preview', { projectId: PROJECT, sessionId, path: 'manual.png' }, { source: 'http' });
    assert(relativePreview.fileName === 'manual.png' && relativePreview.sha256 === PNG_HASH, 'relative Session preview did not resolve under the per-project Session root');

    assert(engine.instances.length === 0, 'preview started the video worker');
  });

  await run('P3-006-C: preview denies escapes, unsupported/mismatched files and over-limit bytes', async () => {
    const workspace = await makeWorkspace({ config: { maxPreviewBytes: 1024 } });
    const bag = makeCtx(workspace);
    const { bridge } = makeBridge(workspace, { handler: () => ({}) }, bag.ctx);
    const sessionId = await createBoundSession(bridge);

    const outside = join(workspace.root, 'secret.png');
    await writeFile(outside, PNG);
    const denied = await rejects(() => bridge.invoke('preview', { projectId: PROJECT, sessionId, path: outside }, { source: 'http' }));
    assert(denied.code === 'E_PREVIEW_DENIED', `outside root was not denied: ${denied.code}`);
    // A missing path outside the owned roots is denied too, not reported as
    // "not found": preview must not become a filesystem existence oracle.
    const ghost = await rejects(() => bridge.invoke('preview', { projectId: PROJECT, sessionId, path: join(workspace.root, 'ghost.png') }, { source: 'http' }));
    assert(ghost.code === 'E_PREVIEW_DENIED', `missing outside path leaked an existence signal: ${ghost.code}`);
    // A missing path inside an owned root keeps the honest "not found" code.
    const missingInside = await rejects(() => bridge.invoke('preview', { projectId: PROJECT, sessionId, path: join(workspace.projectDir, 'missing.png') }, { source: 'http' }));
    assert(missingInside.code === 'E_PREVIEW_NOT_FOUND', `missing owned path was not typed as not found: ${missingInside.code}`);
    // "../../../" from <sessionCwd>/<project>/ resolves to the workspace root.
    const escape = await rejects(() => bridge.invoke('preview', { projectId: PROJECT, sessionId, path: '../../../secret.png' }, { source: 'http' }));
    assert(escape.code === 'E_PREVIEW_DENIED', `relative traversal was not denied: ${escape.code}`);

    // A symlink inside an owned root may not smuggle an outside file in.
    await symlink(outside, join(workspace.projectDir, 'link.png'));
    const linked = await rejects(() => bridge.invoke('preview', { projectId: PROJECT, sessionId, path: join(workspace.projectDir, 'link.png') }, { source: 'http' }));
    assert(linked.code === 'E_PREVIEW_DENIED', `symlink escape was not denied: ${linked.code}`);

    const textFile = join(workspace.projectDir, 'notes.txt');
    await writeFile(textFile, 'not an image');
    const unsupported = await rejects(() => bridge.invoke('preview', { projectId: PROJECT, sessionId, path: textFile }, { source: 'http' }));
    assert(unsupported.code === 'E_PREVIEW_UNSUPPORTED', `text preview was not unsupported: ${unsupported.code}`);

    const fakeImage = join(workspace.projectDir, 'fake.png');
    await writeFile(fakeImage, '<!doctype html><script>alert(1)</script>');
    const mismatched = await rejects(() => bridge.invoke('preview', { projectId: PROJECT, sessionId, path: fakeImage }, { source: 'http' }));
    assert(mismatched.code === 'E_PREVIEW_UNSUPPORTED', `renamed non-image was not rejected: ${mismatched.code}`);

    const large = join(workspace.projectDir, 'large.png');
    await writeFile(large, Buffer.concat([PNG, Buffer.alloc(2048)]));
    const limit = await rejects(() => bridge.invoke('preview', { projectId: PROJECT, sessionId, path: large }, { source: 'http' }));
    assert(limit.code === 'E_PREVIEW_LIMIT', `over-limit preview was not typed: ${limit.code}`);
  });

  await run('P3-006-C: preview is Session-scoped and is not a model tool action', async () => {
    const OTHER = 'other';
    const workspace = await makeWorkspace({ projects: { [OTHER]: 'projects-other/other' } });
    const bag = makeCtx(workspace);
    const { bridge } = makeBridge(workspace, { handler: () => ({}) }, bag.ctx);
    const sessionId = await createBoundSession(bridge);
    const otherSession = await createBoundSession(bridge, OTHER);
    const file = join(workspace.projectDir, 'frame.png');
    await writeFile(file, PNG);
    const otherFile = join(workspace.registry.projects[OTHER], 'own.png');
    await writeFile(otherFile, PNG);

    const unregistered = await rejects(() => bridge.invoke('preview', { projectId: PROJECT, sessionId: 'session-unregistered', path: file }, { source: 'http' }));
    assert(unregistered.code === 'E_SESSION_NOT_BOUND', `unregistered Session preview was not rejected: ${unregistered.code}`);
    const crossProject = await rejects(() => bridge.invoke('preview', { projectId: OTHER, sessionId: sessionId, path: file }, { source: 'http' }));
    assert(crossProject.code === 'E_PROJECT_SCOPE', `cross-project preview was not rejected: ${crossProject.code}`);
    const toolPreview = await rejects(() => bridge.invoke('preview', { projectId: PROJECT, sessionId, path: file }, { source: 'tool', agentSessionId: sessionId }));
    assert(toolPreview.code === 'E_METHOD', `tool preview was not rejected: ${toolPreview.code}`);
    const invalid = await rejects(() => bridge.invoke('preview', { projectId: PROJECT, sessionId, path: 5 }, { source: 'http' }));
    assert(invalid.code === 'E_PARAMS', 'invalid preview path was not rejected');
    const otherPreview = await bridge.invoke('preview', { projectId: OTHER, sessionId: otherSession, path: otherFile }, { source: 'http' });
    assert(otherPreview.sha256 === PNG_HASH, 'other project preview did not read its own project file');
  });

  await run('R3: preview denies same-root cross-project artifacts, project files and receipts', async () => {
    const OTHER = 'other';
    const OTHER_JOB = '99999999-2222-4333-8444-555555555555';
    const workspace = await makeWorkspace({ projects: { [OTHER]: 'projects-other/other' } });
    const inboxRoot = join(workspace.root, 'asset-inbox');
    const bag = makeCtx(workspace);
    const { bridge } = makeBridgeWithConfig(workspace, { assetInboxRoot: inboxRoot }, { handler: () => ({}) }, bag.ctx);
    const sessionId = await createBoundSession(bridge);
    const otherSession = await createBoundSession(bridge, OTHER);

    // Same artifact root, other project's job output: attribution comes from the
    // job registry, never from "inside artifactRoot".
    bridge.jobs.set(OTHER_JOB, { projectId: OTHER, revision: REVISION, kind: 'frame' });
    const otherArtifact = join(workspace.outputRoot, `${OTHER_JOB}.png`);
    await writeFile(otherArtifact, PNG);
    const artifactDenied = await rejects(() => bridge.invoke('preview', { projectId: PROJECT, sessionId, path: otherArtifact }, { source: 'http' }));
    assert(artifactDenied.code === 'E_PREVIEW_DENIED', `cross-project artifact was served: ${artifactDenied.code}`);
    const ownArtifactPreview = await bridge.invoke('preview', { projectId: OTHER, sessionId: otherSession, path: otherArtifact }, { source: 'http' });
    assert(ownArtifactPreview.sha256 === PNG_HASH, 'owning project could not preview its own artifact');

    // Same projectsRoot, other project's content directory.
    const otherDir = workspace.registry.projects[OTHER];
    await writeFile(join(otherDir, 'secret.png'), PNG);
    const projectDenied = await rejects(() => bridge.invoke('preview', { projectId: PROJECT, sessionId, path: join(otherDir, 'secret.png') }, { source: 'http' }));
    assert(projectDenied.code === 'E_PREVIEW_DENIED', `cross-project project file was served: ${projectDenied.code}`);

    // An upload receipt issued to another project stays in that project.
    const otherUpload = await uploadPng(bridge, OTHER, 'other.png');
    assert(otherUpload.response.status === 200, `other-project upload failed: ${JSON.stringify(otherUpload.body)}`);
    const otherReceiptName = (await readdir(inboxRoot)).find((name) => name.endsWith('other.png'));
    const otherReceiptTarget = join(inboxRoot, otherReceiptName);
    const receiptDenied = await rejects(() => bridge.invoke('preview', { projectId: PROJECT, sessionId, path: otherReceiptTarget }, { source: 'http' }));
    assert(receiptDenied.code === 'E_PREVIEW_DENIED', `cross-project receipt file was served: ${receiptDenied.code}`);
    const receiptOwned = await bridge.invoke('preview', { projectId: OTHER, sessionId: otherSession, path: otherReceiptTarget }, { source: 'http' });
    assert(receiptOwned.sha256 === PNG_HASH, 'owning project could not preview its own receipt file');
  });

  await run('R3: legacy shared-root previews require this Session\'s exact event reference', async () => {
    const OTHER = 'other';
    const workspace = await makeWorkspace({ projects: { [OTHER]: 'projects-other/other' } });
    const legacyFile = join(workspace.sessionCwd, 'legacy.png');
    await writeFile(legacyFile, PNG);
    const otherLegacyFile = join(workspace.sessionCwd, OTHER, 'other-legacy.png');
    await mkdir(join(workspace.sessionCwd, OTHER), { recursive: true });
    await writeFile(otherLegacyFile, PNG);
    let events = [];
    const bag = makeCtx(workspace, { controller: { inspect: async () => ({ meta: { id: 'session-1' }, events }) } });
    const { bridge } = makeBridge(workspace, { handler: () => ({}) }, bag.ctx);
    const sessionId = await createBoundSession(bridge);

    // No reference at all: belonging to the old shared root is not permission.
    let error = await rejects(() => bridge.invoke('preview', { projectId: PROJECT, sessionId, path: legacyFile }, { source: 'http' }));
    assert(error.code === 'E_PREVIEW_DENIED', `unreferenced legacy file was served: ${error.code}`);

    // A longer path token is not an exact reference.
    events = [{ type: 'user/message', seq: 1, time: 1, data: { content: [{ type: 'text', text: `${legacyFile}.bak` }] } }];
    error = await rejects(() => bridge.invoke('preview', { projectId: PROJECT, sessionId, path: legacyFile }, { source: 'http' }));
    assert(error.code === 'E_PREVIEW_DENIED', `prefix-only legacy reference was accepted: ${error.code}`);

    // The bound Session's own log names the exact absolute path.
    events = [{ type: 'user/message', seq: 2, time: 2, data: { content: [{ type: 'text', text: `见附件 ${legacyFile}` }] } }];
    const allowed = await bridge.invoke('preview', { projectId: PROJECT, sessionId, path: legacyFile }, { source: 'http' });
    assert(allowed.sha256 === PNG_HASH, 'exactly-referenced legacy file was denied');

    // A file:// form of the same absolute path counts, and tool results are events too.
    events = [{ type: 'tool/result', seq: 3, time: 3, data: { message: { role: 'tool', content: [{ type: 'text', text: `saved ${pathToFileURL(legacyFile).href}` }] } } }];
    const fileUrlAllowed = await bridge.invoke('preview', { projectId: PROJECT, sessionId, path: legacyFile }, { source: 'http' });
    assert(fileUrlAllowed.sha256 === PNG_HASH, 'file URL legacy reference was denied');

    // Another project's private Session root never becomes "legacy shared root".
    events = [{ type: 'user/message', seq: 4, time: 4, data: { content: [{ type: 'text', text: otherLegacyFile }] } }];
    error = await rejects(() => bridge.invoke('preview', { projectId: PROJECT, sessionId, path: otherLegacyFile }, { source: 'http' }));
    assert(error.code === 'E_PREVIEW_DENIED', `cross-project Session file was served through a legacy reference: ${error.code}`);

    // Unavailable controller/inspection denies instead of falling back to the root.
    const noInspectBag = makeCtx(workspace);
    noInspectBag.sessionController.inspect = undefined;
    const noInspectBridge = makeBridge(workspace, { handler: () => ({}) }, noInspectBag.ctx).bridge;
    const noInspectSession = await createBoundSession(noInspectBridge);
    events = [{ type: 'user/message', seq: 5, time: 5, data: { content: [{ type: 'text', text: legacyFile }] } }];
    error = await rejects(() => noInspectBridge.invoke('preview', { projectId: PROJECT, sessionId: noInspectSession, path: legacyFile }, { source: 'http' }));
    assert(error.code === 'E_PREVIEW_DENIED', `missing controller inspection was not denied: ${error.code}`);
    await noInspectBridge.dispose();

    // Pure bounded scan boundary: exact token only, never a longer path.
    assert(sessionLogReferencesPath([{ data: { text: '/a/b.png' } }], '/a/b.png') === true, 'exact event path did not match');
    assert(sessionLogReferencesPath([{ data: { text: '/x/a/b.png' } }], '/a/b.png') === false, 'path suffix matched');
    assert(sessionLogReferencesPath([{ data: { text: '/a/b.png.bak' } }], '/a/b.png') === false, 'path prefix matched');
    assert(sessionLogReferencesPath([{ data: { text: '"/a/b.png",' } }], '/a/b.png') === true, 'quoted event path did not match');
    assert(sessionLogReferencesPath([{ data: { text: 'no path' } }], '/a/b.png') === false, 'unrelated event matched');
    // The scan is newest-first and bounded: an old reference behind more than the
    // byte budget of newer events is denied instead of reading a whole huge log.
    const filler = Array.from({ length: 600 }, (_, index) => ({ type: 'user/message', seq: index + 1, time: index, data: { content: [{ type: 'text', text: 'x'.repeat(500) }] } }));
    assert(sessionLogReferencesPath(filler, '/a/b.png') === false, 'filler events matched');
    const newestReference = filler.slice();
    newestReference[599] = { type: 'user/message', seq: 600, time: 600, data: { content: [{ type: 'text', text: '/a/b.png' }] } };
    assert(sessionLogReferencesPath(newestReference, '/a/b.png') === true, 'newest exact reference was not found');
    const oldestReference = filler.slice();
    oldestReference[0] = { type: 'user/message', seq: 1, time: 0, data: { content: [{ type: 'text', text: '/a/b.png' }] } };
    assert(sessionLogReferencesPath(oldestReference, '/a/b.png') === false, 'the scan read past its bounded byte budget');
  });


  await run('P3-008: layout/style edit ops are validated and scoped like the worker contract', async () => {
    const workspace = await makeWorkspace();
    const bag = makeCtx(workspace);
    const { bridge } = makeBridge(workspace, { handler: () => ({}) }, bag.ctx);
    const normalized = bridge.validate('edit', {
      projectId: PROJECT,
      expectedRevision: REVISION,
      operationId: 'layout-style-1',
      ops: [
        { type: 'layout', target: 'scene-1-title', unit: 'composition-px', box: { left: 120, top: 240 } },
        { type: 'style', target: 'scene-1-title', styles: { color: '#FFD400', fontSize: 48 } },
      ],
    });
    assert(normalized.ops.length === 2 && normalized.ops[0].type === 'layout' && normalized.ops[1].styles.color === '#ffd400', 'layout/style ops were not normalized');
    const badLayout = await rejects(async () => bridge.validate('edit', { projectId: PROJECT, expectedRevision: REVISION, operationId: 'bad-layout', ops: [{ type: 'layout', target: 'x', unit: 'px', box: { left: 1 } }] }));
    assert(badLayout.code === 'E_PARAMS', 'invalid layout unit was accepted');
    const badStyle = await rejects(async () => bridge.validate('edit', { projectId: PROJECT, expectedRevision: REVISION, operationId: 'bad-style', ops: [{ type: 'style', target: 'x', styles: { color: 'red' } }] }));
    assert(badStyle.code === 'E_PARAMS', 'invalid style color was accepted');
  });

  await run('R1: Host scene template text limits match the frozen engine 0.3.2 contract', async () => {
    const workspace = await makeWorkspace();
    const bag = makeCtx(workspace);
    const { bridge, engine } = makeBridge(workspace, { handler: () => ({}) }, bag.ctx);
    const sceneUpdate = (template) => bridge.validate('scene.update', { projectId: PROJECT, expectedRevision: REVISION, operationId: 'scene-limit', sceneId: 'scene-1', template });
    const sceneCreate = (template) => bridge.validate('scene.create', { projectId: PROJECT, expectedRevision: REVISION, operationId: 'scene-limit', template });
    const revise = (template) => bridge.validate('project.revise', { projectId: PROJECT, baseRevision: REVISION, expectedRevision: REVISION, operationId: 'revise-limit', sceneId: 'scene-1', template });
    const base = { title: 'T', duration: 5 };

    // Lengths that the old 200/300/48 Host limits rejected are legal frozen copy.
    const formerlyRejected = sceneUpdate({ title: 'x'.repeat(201), duration: 5, subtitle: 'y'.repeat(301), badge: 'z'.repeat(49) });
    assert(formerlyRejected.template.title.length === 201 && formerlyRejected.template.subtitle.length === 301 && formerlyRejected.template.badge.length === 49, 'formerly rejected long template text was not accepted unchanged');

    // Exactly 2048 is the inclusive upper bound for all three text fields.
    const atLimit = sceneUpdate({ title: '长'.repeat(2048), duration: 5, subtitle: '文'.repeat(2048), badge: 'b'.repeat(2048) });
    assert(atLimit.template.title.length === 2048 && atLimit.template.subtitle.length === 2048 && atLimit.template.badge.length === 2048, 'the exact 2048 boundary was rejected or altered');

    // Empty subtitle/badge are legal "present" values; an empty or absent title is not.
    const emptyOptional = sceneUpdate({ title: 'T', duration: 5, subtitle: '', badge: '' });
    assert(emptyOptional.template.subtitle === '' && emptyOptional.template.badge === '', 'empty optional template text was rejected');
    for (const template of [{ title: '', duration: 5 }, { duration: 5 }]) {
      const error = await rejects(async () => sceneUpdate(template));
      assert(error.code === 'E_PARAMS', `empty/absent title was accepted: ${error.code}`);
    }

    // 2049 is rejected for every text field on all three template-taking methods.
    for (const overrides of [{ title: 'x'.repeat(2049) }, { subtitle: 'x'.repeat(2049) }, { badge: 'x'.repeat(2049) }]) {
      const template = Object.assign({}, base, overrides);
      for (const [name, run] of [['scene.update', () => sceneUpdate(template)], ['scene.create', () => sceneCreate(template)], ['project.revise', () => revise(template)]]) {
        const error = await rejects(async () => run());
        assert(error.code === 'E_PARAMS' && error.stage === 'params', `${name} did not reject over-limit template text as E_PARAMS: ${error.code}`);
      }
    }
    assert(sceneCreate({ title: 'x'.repeat(2048), duration: 5 }).template.title.length === 2048, 'scene.create rejected the 2048 title');
    assert(revise({ title: 'x'.repeat(2048), duration: 5, subtitle: 'y'.repeat(2048), badge: 'z'.repeat(2048) }).template.badge.length === 2048, 'project.revise rejected the 2048 badge');

    // Other frozen template validations are unchanged.
    const invalid = [
      { title: 'T', duration: 0.4 },
      { title: 'T', duration: 60.1 },
      { title: 'T', duration: '5' },
      { title: 7, duration: 5 },
      { title: 'T', duration: 5, subtitle: 7 },
      { title: 'T', duration: 5, badge: null },
      { title: 'T', duration: 5, color: 'red' },
      { title: 'T', duration: 5, accent: '#12345' },
      { title: 'T', duration: 5, logo: '../logo.png' },
      { title: 'T', duration: 5, shot: 'assets/logo.svg' },
      { title: 'T', duration: 5, extra: 'nope' },
      { title: 'T', duration: 5, sceneId: 'scene-1' },
    ];
    for (const template of invalid) {
      const error = await rejects(async () => sceneUpdate(template));
      assert(error.code === 'E_PARAMS', `invalid scene template was accepted: ${JSON.stringify(template).slice(0, 80)}`);
    }
    const normalized = sceneCreate({ title: 'T', duration: 5, color: '#FFD400', logo: 'assets/logo.png', sceneId: 'scene-2' });
    assert(normalized.template.color === '#ffd400' && normalized.template.logo === 'assets/logo.png' && normalized.template.sceneId === 'scene-2', 'scene.create template normalization changed');
    // Validation is pure: none of the above started the worker.
    assert(engine.instances.length === 0, 'scene template validation started the worker');
  });

  await run('R1: long scene template copy reaches the worker untruncated; invalid lengths never start it', async () => {
    const workspace = await makeWorkspace();
    const bag = makeCtx(workspace);
    const { bridge, engine } = makeBridge(workspace, { handler: () => ({ projectId: PROJECT, revision: REVISION, written: true }) }, bag.ctx);
    const longTitle = '长'.repeat(2048);
    const longSubtitle = 'x'.repeat(2048);
    const longBadge = 'b'.repeat(201);
    const template = { title: longTitle, duration: 5, subtitle: longSubtitle, badge: longBadge, color: '#FFD400', logo: 'assets/logo.png' };
    const overlimit = { title: 'x'.repeat(2049), duration: 5 };
    const reviseOverlimit = { title: 'T', duration: 5, subtitle: 'x'.repeat(2049) };

    // Over-limit requests are typed before the worker is started or called.
    for (const params of [
      ['scene.update', { projectId: PROJECT, expectedRevision: REVISION, operationId: 'long-invalid', sceneId: 'scene-1', template: overlimit }],
      ['scene.create', { projectId: PROJECT, expectedRevision: REVISION, operationId: 'long-invalid', template: overlimit }],
      ['project.revise', { projectId: PROJECT, baseRevision: REVISION, expectedRevision: REVISION, operationId: 'long-invalid', sceneId: 'scene-1', template: reviseOverlimit }],
    ]) {
      const error = await rejects(() => bridge.invoke(params[0], params[1], { source: 'http' }));
      assert(error.code === 'E_PARAMS', `over-limit ${params[0]} was forwarded: ${error.code}`);
    }
    assert(engine.instances.length === 0, 'invalid template lengths started the worker');

    const updated = await bridge.invoke('scene.update', { projectId: PROJECT, expectedRevision: REVISION, operationId: 'long-update', sceneId: 'scene-1', template }, { source: 'http' });
    assert(updated.written === true, 'long scene.update did not reach the worker');
    const reviseTemplate = { title: '长'.repeat(1000), duration: 5, subtitle: 'y'.repeat(2048), badge: 'z'.repeat(2048), shot: 'assets/canvas-test.png' };
    const revised = await bridge.invoke('project.revise', { projectId: PROJECT, baseRevision: REVISION, expectedRevision: REVISION, operationId: 'long-revise', sceneId: 'scene-1', template: reviseTemplate }, { source: 'http' });
    assert(revised.written === true, 'long project.revise did not reach the worker');

    const requests = engine.instances[0].requests;
    const sceneUpdateRequest = requests.find((entry) => entry.method === 'scene.update');
    assert(sceneUpdateRequest !== undefined, 'the worker never received scene.update');
    assert(
      sceneUpdateRequest.params.template.title === longTitle &&
      sceneUpdateRequest.params.template.subtitle === longSubtitle &&
      sceneUpdateRequest.params.template.badge === longBadge,
      'the worker received truncated or altered long scene.update text'
    );
    assert(sceneUpdateRequest.params.template.title.length === 2048, 'the worker did not receive the full 2048-character title');
    const reviseRequest = requests.find((entry) => entry.method === 'project.revise');
    assert(reviseRequest !== undefined, 'the worker never received project.revise');
    assert(
      reviseRequest.params.template.subtitle === reviseTemplate.subtitle &&
      reviseRequest.params.template.badge === reviseTemplate.badge,
      'the worker received truncated project.revise text'
    );
    assert(reviseRequest.params.template.shot === 'assets/canvas-test.png', 'project.revise lost the shot while carrying long text');
  });

  await run('P3-008: UI-only managed methods are refused from the model Tool source', async () => {
    const workspace = await makeWorkspace();
    const bag = makeCtx(workspace);
    const { bridge } = makeBridge(workspace, { handler: () => ({}) }, bag.ctx);
    for (const [method, params] of [
      ['project.create', { templateId: 'product-launch-v1' }],
      ['project.list', {}],
      ['preview.snapshot', { projectId: PROJECT, revision: REVISION }],
      ['asset.import', { projectId: PROJECT, expectedRevision: REVISION, operationId: 'asset-x', receiptId: '00000000-0000-4000-8000-000000000000' }],
    ]) {
      const error = await rejects(() => bridge.invoke(method, params, { source: 'tool', agentSessionId: 'session-unbound' }));
      assert(error.code === 'E_METHOD', `${method} was not refused from Tool source: ${error.code}`);
    }
  });

  await run('P3-008: preview snapshots are verified, routed with CSP/runtime and released', async () => {
    const workspace = await makeWorkspace();
    const snapshotId = 'a'.repeat(32);
    const snapshotDir = join(workspace.outputRoot, 'previews', snapshotId);
    await mkdir(snapshotDir, { recursive: true });
    const entry = Buffer.from('<!doctype html><html><body><main data-composition-id="x"></main><script>window.__timelines={};</script></body></html>');
    const asset = Buffer.from('export const x = 1;');
    await writeFile(join(snapshotDir, 'index.html'), entry);
    await mkdir(join(snapshotDir, 'assets'), { recursive: true });
    await writeFile(join(snapshotDir, 'assets', 'gsap.min.js'), asset);
    const manifest = {
      snapshotId,
      projectId: PROJECT,
      revision: REVISION,
      entry: 'index.html',
      files: [
        { path: 'index.html', bytes: entry.length, sha256: createHash('sha256').update(entry).digest('hex') },
        { path: 'assets/gsap.min.js', bytes: asset.length, sha256: createHash('sha256').update(asset).digest('hex') },
      ],
      expiresAt: new Date(Date.now() + 60000).toISOString(),
    };
    const bag = makeCtx(workspace);
    const { bridge } = makeBridge(workspace, {
      handler: (method) => {
        if (method === 'preview.snapshot') return manifest;
        if (method === 'preview.release') return { snapshotId, released: true };
        return {};
      },
    }, bag.ctx);
    const result = await bridge.invoke('preview.snapshot', { projectId: PROJECT, revision: REVISION }, { source: 'http' });
    assert(result.snapshotId === snapshotId && result.entryUrl === `/api/dsh-video/preview/${snapshotId}/index.html`, 'snapshot registration did not return the route');
    const entryRoute = bag.routes.find((route) => route.path === result.entryUrl);
    assert(entryRoute !== undefined, 'snapshot entry route was not registered');
    const response = await entryRoute.fetch(new Request(`http://127.0.0.1${result.entryUrl}?instance=browserinstance&nonce=${'b'.repeat(32)}`));
    assert(response.status === 200, `snapshot entry status ${response.status}`);
    const html = await response.text();
    assert(html.includes('/api/dsh-video/canvas-runtime.js'), 'runtime was not injected into the entry');
    assert((response.headers.get('content-security-policy') || '').includes("connect-src 'none'"), 'snapshot CSP is missing');
    const assetRoute = bag.routes.find((route) => route.path.endsWith('/assets/gsap.min.js'));
    const assetResponse = await assetRoute.fetch(new Request(`http://127.0.0.1${assetRoute.path}`));
    assert(assetResponse.status === 200 && Buffer.compare(Buffer.from(await assetResponse.arrayBuffer()), asset) === 0, 'snapshot asset bytes do not match');
    await bridge.invoke('preview.release', { snapshotId }, { source: 'http' });
    assert(bag.routes.every((route) => route.path !== result.entryUrl), 'released snapshot route is still registered');
  });

  await run('P3-008: asset inbox validates bytes/receipts and feeds asset.import without a Host path', async () => {
    const workspace = await makeWorkspace();
    const inbox = join(workspace.root, 'asset-inbox');
    await mkdir(inbox, { recursive: true });
    const bag = makeCtx(workspace);
    const { bridge } = makeBridge(workspace, {
      handler: (method, params) => {
        if (method === 'asset.import') {
          bag.receivedAssetImport = params;
          return { projectId: PROJECT, revision: REVISION, asset: { path: 'assets/canvas-test.png', name: 'canvas-test.png', bytes: PNG.length, sha256: PNG_HASH, mediaType: 'image/png' }, assets: [], historyCursor: 2 };
        }
        return {};
      },
    }, bag.ctx);
    bag.ctx.get('__noop');
    // Rebuild with an inbox root because makeWorkspace has no asset root by default.
    const inboxBridge = new VideoBridge({
      ctx: bag.ctx,
      rawConfig: Object.assign({}, workspace.config, { assetInboxRoot: inbox }),
      engineLoader: async () => ({
        WorkerClient: class extends FakeClient {
          constructor(options) {
            super(options, {
              handler: (method, params) => {
                if (method === 'asset.import') {
                  bag.receivedAssetImport = params;
                  return { projectId: PROJECT, revision: REVISION, asset: { path: 'assets/canvas-test.png', name: 'canvas-test.png', bytes: PNG.length, sha256: PNG_HASH, mediaType: 'image/png' }, assets: [], historyCursor: 2 };
                }
                return {};
              },
            });
          }
        },
        workerEntry: workspace.workerEntry,
        workerVersion: '0.3.0',
        clientVersion: '0.3.0',
      }),
    });
    const upload = await inboxBridge.uploadAsset(new Request('http://127.0.0.1/api/dsh-video/asset-upload', {
      method: 'POST',
      headers: { 'content-type': 'image/png', 'x-dsh-project-id': PROJECT, 'x-dsh-file-name': 'canvas-test.png' },
      body: PNG,
    }));
    const receipt = await upload.json();
    assert(upload.ok && receipt.receiptId, `inbox upload failed: ${JSON.stringify(receipt)}`);
    const imported = await inboxBridge.invoke('asset.import', { projectId: PROJECT, expectedRevision: REVISION, operationId: 'asset-test-1', receiptId: receipt.receiptId }, { source: 'http' });
    assert(imported.asset.path === 'assets/canvas-test.png', 'asset.import result was not returned');
    assert(bag.receivedAssetImport && bag.receivedAssetImport.sourceName && bag.receivedAssetImport.sourceName.includes('canvas-test.png'), 'worker did not receive the controlled inbox basename');
    assert(!JSON.stringify(bag.receivedAssetImport).includes(workspace.root), 'worker asset.import received an absolute project path');
    assert((await listIfPresent(inbox)).length === 0, 'the imported inbox copy was not cleaned up after handoff');
    const unknownProject = await inboxBridge.uploadAsset(new Request('http://127.0.0.1/api/dsh-video/asset-upload', {
      method: 'POST',
      headers: { 'content-type': 'image/png', 'x-dsh-project-id': 'unregistered', 'x-dsh-file-name': 'unknown.png' },
      body: PNG,
    }));
    const unknownBody = await unknownProject.json();
    assert(unknownProject.status === 404 && unknownBody.error.code === 'E_PROJECT_NOT_FOUND', `bridge-level unknown project upload was not rejected: ${unknownProject.status}/${JSON.stringify(unknownBody)}`);
    assert((await listIfPresent(inbox)).length === 0, 'unknown-project upload wrote a file');
    const badUpload = await inboxBridge.uploadAsset(new Request('http://127.0.0.1/api/dsh-video/asset-upload', {
      method: 'POST',
      headers: { 'content-type': 'image/png', 'x-dsh-project-id': PROJECT, 'x-dsh-file-name': 'fake.png' },
      body: Buffer.from('<!doctype html><script>1</script>'),
    }));
    assert(badUpload.ok === false, 'non-image upload was accepted');
    await inboxBridge.dispose();
  });

  await run('tool scope: cross-project actions and foreign jobs are refused from the trusted mapping', async () => {
    const OTHER = 'other';
    const workspace = await makeWorkspace({ projects: { [OTHER]: 'projects-other/other' } });
    const bag = makeCtx(workspace);
    let jobCounter = 0;
    const foreignJobId = '11111111-2222-4333-8444-999999999999';
    const { bridge } = makeBridge(workspace, {
      handler: (method, params) => {
        if (method === 'open' || method === 'inspect') {
          return { projectId: params.projectId, revision: REVISION, duration: 5, width: 1280, height: 720, elements: [] };
        }
        if (method === 'frame') {
          jobCounter += 1;
          const jobId = params.projectId === OTHER ? foreignJobId : `11111111-2222-4333-8444-${String(jobCounter).padStart(12, '0')}`;
          return { jobId, projectId: params.projectId, revision: params.revision, kind: 'frame', state: 'queued', stage: 'snapshot', progress: 0 };
        }
        return {};
      },
    }, bag.ctx);
    const sessionId = await createBoundSession(bridge);
    const tool = createVideoTool(bridge);
    const exec = { agent: { session: { id: sessionId } } };
    const foreignOpen = await rejects(() => tool.execute({ action: 'open', projectId: OTHER }, exec));
    assert(foreignOpen.message.includes('E_PROJECT_SCOPE'), `cross-project tool open was not refused: ${foreignOpen.message}`);
    await bridge.invoke('open', { projectId: OTHER }, { source: 'http' });
    await bridge.invoke('frame', { projectId: OTHER, revision: REVISION, time: 1 }, { source: 'http' });
    const foreignJob = await rejects(() => tool.execute({ action: 'status', jobId: foreignJobId }, exec));
    assert(foreignJob.message.includes('E_PROJECT_SCOPE'), `foreign job status was not refused: ${foreignJob.message}`);
    const own = await tool.execute({ action: 'open', projectId: PROJECT }, { agent: { id: sessionId } });
    assert(own.action === 'open' && own.result.projectId === PROJECT, 'the id-only Agent shape was not accepted for a bound project');
  });

  await run('prompt context: bound project facts are contributed and released with the bridge', async () => {
    const workspace = await makeWorkspace();
    const bag = makeCtx(workspace);
    const { bridge } = makeBridge(workspace, {
      handler: (method, params) => {
        if (method === 'open' || method === 'inspect') {
          return { projectId: params.projectId, revision: REVISION, duration: 5, width: 1280, height: 720, elements: [{ stableId: 'hf-title', capabilities: ['text', 'timing'] }] };
        }
        return { projectId: params.projectId, revision: REVISION };
      },
    }, bag.ctx);
    const sessionId = await createBoundSession(bridge);
    await bridge.invoke('inspect', { projectId: PROJECT }, { source: 'http' });
    assert(bag.contexts.length === 1, `expected one prompt context, got ${bag.contexts.length}`);
    const contribution = bag.contexts[0];
    assert(contribution.name === 'dsh-video:project' && contribution.order === 4500, 'prompt context identity/order changed');
    const text = contribution.text({ agent: { session: { id: sessionId } } });
    assert(typeof text === 'string' && text.includes(PROJECT) && text.includes(REVISION) && text.includes('hf-title'), 'bound project facts missing from the prompt context');
    assert(contribution.text({ agent: { session: { id: 'session-unbound' } } }) === '', 'unbound Agent received project context');
    const diagnose = await bridge.invoke('session.diagnose', {}, { source: 'http' });
    assert(diagnose.enabled === true && diagnose.controller === true && diagnose.store.version === 1, 'session diagnosis is incomplete');
    assert(typeof diagnose.bundleVersion === 'string' && diagnose.bundleVersion.startsWith('0.3.'), 'diagnosis lost the bundle version');
    assert(!JSON.stringify(diagnose).includes('message'), 'diagnosis must not include message text');
    await bridge.dispose();
    assert(bag.contextDisposers.length === 1, 'prompt context was not disposed with the bridge');
  });

  await run('P3-012: Tool exposes project.compose/source with exact fields and workflow description', async () => {
    const calls = [];
    const fakeBridge = {
      async invoke(method, params) {
        calls.push({ method, params });
        return { projectId: params.projectId, revision: NEXT_REVISION };
      },
    };
    const tool = createVideoTool(fakeBridge);
    const actions = tool.parameters.properties.action.enum;
    assert(Array.isArray(actions) && actions.includes('project.compose') && actions.includes('project.source'), 'the Tool action enum is missing the composition actions');
    const htmlSchema = tool.parameters.properties.html;
    assert(htmlSchema !== undefined && htmlSchema.type === 'string', 'the Tool html parameter schema is missing');
    assert(String(htmlSchema.description).includes('48 KiB') && String(htmlSchema.description).includes('window.__timelines'), 'the Tool html schema does not state the composition contract');
    assert(tool.parameters.additionalProperties === false, 'the Tool must reject extra parameters');
    const description = String(tool.description);
    for (const fragment of ['project.compose', 'project.source', 'expectedRevision', 'preview follows', 'Never write project files']) {
      assert(description.includes(fragment), `the Tool description is missing "${fragment}"`);
    }

    await tool.execute({ action: 'project.source', projectId: PROJECT }, {});
    await tool.execute({ action: 'project.compose', projectId: PROJECT, expectedRevision: REVISION, operationId: 'tool-compose-1', html: COMPOSITION_HTML }, {});
    assert(calls.length === 2, `unexpected Tool bridge calls: ${calls.length}`);
    assert(calls[0].method === 'project.source', 'project.source was not dispatched through the bridge');
    assert(JSON.stringify(calls[0].params) === JSON.stringify({ projectId: PROJECT }), 'project.source forwarded fields outside its contract');
    assert(calls[1].method === 'project.compose', 'project.compose was not dispatched through the bridge');
    assert(
      JSON.stringify(calls[1].params) === JSON.stringify({ projectId: PROJECT, expectedRevision: REVISION, operationId: 'tool-compose-1', html: COMPOSITION_HTML }),
      'project.compose parameters were not forwarded exactly'
    );

    // Unknown fields are refused by the Tool before the bridge sees them.
    for (const args of [
      { action: 'project.source', projectId: PROJECT, expectedRevision: REVISION },
      { action: 'project.compose', projectId: PROJECT, expectedRevision: REVISION, operationId: 'tool-compose-2', html: COMPOSITION_HTML, path: '/tmp/x' },
    ]) {
      const error = await rejects(() => tool.execute(args, {}));
      assert(error.message.includes('E_PARAMS'), `an out-of-contract Tool field was accepted: ${error.message}`);
    }
    assert(calls.length === 2, 'invalid Tool arguments reached the bridge');
  });

  await run('P3-012: compose/source are byte-bounded and typed before the worker starts', async () => {
    const workspace = await makeWorkspace();
    const bag = makeCtx(workspace);
    const { bridge, engine } = makeBridge(workspace, {
      handler: (method, params) => {
        if (method === 'project.compose') return composeResult({ bytes: Buffer.byteLength(params.html, 'utf8') });
        if (method === 'project.source') {
          return { projectId: params.projectId, revision: NEXT_REVISION, entry: 'index.html', bytes: Buffer.byteLength(COMPOSITION_HTML, 'utf8'), assets: ['assets/gsap.min.js'], html: COMPOSITION_HTML };
        }
        return {};
      },
    }, bag.ctx);
    const compose = (overrides) => Object.assign({ projectId: PROJECT, expectedRevision: REVISION, operationId: 'bridge-compose-1', html: COMPOSITION_HTML }, overrides || {});
    const invalid = [
      ['uppercase revision', compose({ expectedRevision: 'A'.repeat(64) }), 'E_PARAMS'],
      ['short revision', compose({ expectedRevision: 'a'.repeat(63) }), 'E_PARAMS'],
      ['invalid operation id', compose({ operationId: 'bad id!' }), 'E_PARAMS'],
      ['empty html', compose({ html: '' }), 'E_PARAMS'],
      ['non-string html', compose({ html: 7 }), 'E_PARAMS'],
      ['NUL html', compose({ html: 'x\0y' }), 'E_PARAMS'],
      ['oversize ascii html', compose({ html: 'x'.repeat(MAX_COMPOSITION_BYTES + 1) }), 'E_PARAMS'],
      ['oversize multibyte html', compose({ html: '中'.repeat(Math.floor(MAX_COMPOSITION_BYTES / 3) + 1) }), 'E_PARAMS'],
      ['unknown extra parameter', compose({ path: '/tmp/x' }), 'E_PARAMS'],
      ['unknown project', compose({ projectId: 'other' }), 'E_PROJECT_NOT_FOUND'],
    ];
    for (const [label, params, code] of invalid) {
      const error = await rejects(() => bridge.invoke('project.compose', params, { source: 'http' }));
      assert(error.code === code, `${label}: unexpected compose error ${error.code}`);
    }
    const oversize = await rejects(() => bridge.invoke('project.compose', compose({ html: 'x'.repeat(MAX_COMPOSITION_BYTES + 1) }), { source: 'http' }));
    assert(oversize.message.includes('48 KiB'), `the oversize error is not actionable: ${oversize.message}`);
    // The bound is raw UTF-8 bytes, not characters: this document is under the
    // character count but over the 48 KiB byte ceiling.
    const multibyte = '中'.repeat(16385);
    assert(multibyte.length <= MAX_COMPOSITION_BYTES && Buffer.byteLength(multibyte, 'utf8') > MAX_COMPOSITION_BYTES, 'the multibyte fixture does not isolate byte bounding');
    for (const params of [{ projectId: PROJECT, html: COMPOSITION_HTML }, { projectId: '../demo' }]) {
      const error = await rejects(() => bridge.invoke('project.source', params, { source: 'http' }));
      assert(['E_PARAMS', 'E_PROJECT_NOT_FOUND'].includes(error.code), `project.source accepted invalid params: ${error.code}`);
    }
    assert(engine.instances.length === 0, 'an invalid compose/source request started the worker');

    const published = await bridge.invoke('project.compose', compose(), { source: 'http' });
    assert(published.revision === NEXT_REVISION && published.publishedRevision === NEXT_REVISION, 'the valid compose result was not returned');
    const source = await bridge.invoke('project.source', { projectId: PROJECT }, { source: 'http' });
    assert(source.html === COMPOSITION_HTML && source.revision === NEXT_REVISION, 'the valid source result was not returned');
    assert(engine.instances.length === 1, `expected one worker start, saw ${engine.instances.length}`);
    const requests = engine.instances[0].requests;
    const composeRequest = requests.find((entry) => entry.method === 'project.compose');
    assert(composeRequest !== undefined, 'project.compose never reached the worker');
    assert(
      composeRequest.params.projectId === PROJECT &&
        composeRequest.params.expectedRevision === REVISION &&
        composeRequest.params.operationId === 'bridge-compose-1' &&
        composeRequest.params.html === COMPOSITION_HTML,
      'project.compose parameters were altered before the worker'
    );
    const sourceRequest = requests.find((entry) => entry.method === 'project.source');
    assert(sourceRequest !== undefined && JSON.stringify(sourceRequest.params) === JSON.stringify({ projectId: PROJECT }), 'project.source parameters were not forwarded exactly');
  });

  await run('P3-012: quote-heavy html is rejected by the escaped frame budget before the worker starts', async () => {
    const workspace = await makeWorkspace();
    const bag = makeCtx(workspace);
    let composeCalls = 0;
    const { bridge, engine } = makeBridge(workspace, {
      handler: (method) => {
        if (method === 'project.compose') {
          composeCalls += 1;
          return composeResult();
        }
        return {};
      },
    }, bag.ctx);

    // The verifier's availability failure shape: raw-valid (< 48 KiB) but every
    // character is a quote, so the JSON-escaped request frame would be ~96 KiB
    // and the worker would die on its uncorrelatable E_LINE_LIMIT reply.
    const quoteHeavy = '"'.repeat(MAX_COMPOSITION_BYTES - 1);
    const rawBytes = Buffer.byteLength(quoteHeavy, 'utf8');
    const escapedBytes = Buffer.byteLength(JSON.stringify(quoteHeavy), 'utf8');
    assert(rawBytes <= MAX_COMPOSITION_BYTES, 'the quote-heavy fixture must stay within the raw 48 KiB bound');
    assert(escapedBytes > MAX_COMPOSITION_ESCAPED_BYTES, 'the quote-heavy fixture must exceed the escaped frame bound');
    const error = await rejects(() =>
      bridge.invoke('project.compose', { projectId: PROJECT, expectedRevision: REVISION, operationId: 'escape-heavy-1', html: quoteHeavy }, { source: 'http' })
    );
    assert(error.code === 'E_PARAMS' && error.stage === 'params', `the quote-heavy document was not rejected as E_PARAMS/params: ${error.code}/${error.stage}`);
    const message = String(error.message);
    assert(message.includes(String(rawBytes)), 'the escaped-budget error does not name the raw byte count');
    assert(message.includes(String(escapedBytes)), 'the escaped-budget error does not name the escaped byte count');
    assert(message.includes(String(MAX_COMPOSITION_ESCAPED_BYTES)), 'the escaped-budget error does not name the escaped limit');
    assert(/quotes|backslashes/i.test(message) && /shorten/i.test(message), `the escaped-budget error is not actionable: ${message}`);
    assert(engine.instances.length === 0 && composeCalls === 0, 'the escaped-budget rejection reached or started the worker');

    // The bound is inclusive: an escaped document at exactly 61440 bytes is
    // accepted and still leaves the complete JSONL request frame under 64 KiB.
    const atLimit = '"'.repeat((MAX_COMPOSITION_ESCAPED_BYTES - 2) / 2);
    assert(Buffer.byteLength(JSON.stringify(atLimit), 'utf8') === MAX_COMPOSITION_ESCAPED_BYTES, 'the escaped boundary fixture is not exact');
    const normalized = bridge.validate('project.compose', { projectId: PROJECT, expectedRevision: REVISION, operationId: 'escape-boundary', html: atLimit });
    assert(normalized.html === atLimit, 'a document at the escaped boundary was rejected');
    const frameBytes = Buffer.byteLength(JSON.stringify({
      v: 1,
      id: '00000000-0000-4000-8000-000000000000',
      method: 'project.compose',
      params: { projectId: PROJECT, expectedRevision: REVISION, operationId: 'escape-boundary', html: atLimit },
    }), 'utf8');
    assert(frameBytes <= 65536, `the escaped boundary still overflows the 64 KiB JSONL request frame: ${frameBytes}`);
    const overBoundary = await rejects(async () =>
      bridge.validate('project.compose', { projectId: PROJECT, expectedRevision: REVISION, operationId: 'escape-over', html: atLimit + '"' })
    );
    assert(overBoundary.code === 'E_PARAMS', `the escaped bound is not exclusive above the limit: ${overBoundary.code}`);

    // A normal composition still passes and reaches the worker exactly once.
    const accepted = await bridge.invoke('project.compose', { projectId: PROJECT, expectedRevision: REVISION, operationId: 'escape-normal-1', html: COMPOSITION_HTML }, { source: 'http' });
    assert(accepted.publishedRevision === NEXT_REVISION && composeCalls === 1, 'a normal composition was rejected or not forwarded');
    assert(engine.instances.length === 1, `a normal composition did not start the worker once: ${engine.instances.length}`);
  });

  await run('P3-012: a composition publish updates prompt facts and the next context', async () => {
    const SCENES_PROJECT = 'scenes';
    const workspace = await makeWorkspace({ projects: { [SCENES_PROJECT]: 'projects-scenes/scenes' } });
    const bag = makeCtx(workspace);
    const INSPECTED_REVISION = 'c'.repeat(64);
    const { bridge } = makeBridge(workspace, {
      handler: (method, params) => {
        if (method === 'project.compose') return composeResult({ bytes: Buffer.byteLength(params.html, 'utf8') });
        if (method === 'inspect') {
          if (params.projectId === PROJECT) {
            return { projectId: PROJECT, revision: INSPECTED_REVISION, scenes: [], elements: [], width: 1280, height: 720, duration: 5 };
          }
          return {
            projectId: params.projectId,
            revision: 'd'.repeat(64),
            scenes: [{ sceneId: 'scene-1', title: 'Scene 1', start: 0, duration: 5 }],
            elements: [{ stableId: 'scene-1-title', capabilities: ['text'] }],
            width: 1280,
            height: 720,
            duration: 5,
          };
        }
        return {};
      },
    }, bag.ctx);
    const sessionId = await createBoundSession(bridge);
    const published = await bridge.invoke('project.compose', { projectId: PROJECT, expectedRevision: REVISION, operationId: 'facts-compose-1', html: COMPOSITION_HTML }, { source: 'http' });
    assert(published.publishedRevision === NEXT_REVISION, 'the compose result lost its publish marker');
    const facts = bridge.projectFacts(PROJECT);
    assert(facts !== null, 'project.compose did not record prompt facts');
    assert(facts.revision === NEXT_REVISION, `prompt facts kept the old revision: ${facts.revision}`);
    assert(facts.width === 1280 && facts.height === 720 && facts.duration === 5, 'project.compose facts lost geometry/duration');
    assert(facts.mode === 'composition', `project.compose facts did not record composition mode: ${facts.mode}`);
    let text = contextTextFor(bag, sessionId);
    assert(typeof text === 'string' && text.includes(NEXT_REVISION), 'the next prompt context does not carry the published revision');
    assert(text.includes('free-form composition'), 'the next prompt context lost the free-form composition edit path');

    // A later inspect of the same free-form project refreshes revision + mode.
    await bridge.invoke('inspect', { projectId: PROJECT }, { source: 'http' });
    const inspectedFacts = bridge.projectFacts(PROJECT);
    assert(inspectedFacts.revision === INSPECTED_REVISION && inspectedFacts.mode === 'composition', 'inspect of a free-form project did not record composition mode');

    // A legacy scene project keeps the scene path and never claims free-form.
    const scenesSession = await createBoundSession(bridge, SCENES_PROJECT);
    await bridge.invoke('inspect', { projectId: SCENES_PROJECT }, { source: 'http' });
    const sceneFacts = bridge.projectFacts(SCENES_PROJECT);
    assert(sceneFacts.mode === 'scenes', `a scene project was misclassified: ${sceneFacts.mode}`);
    text = contextTextFor(bag, scenesSession);
    assert(text.includes('Scenes: scene-1') && !text.includes('free-form composition'), 'the scene project context was misclassified as free-form');
    await bridge.dispose();
  });

  await run('P3-012: prompt context carries the workflow/contract/skeleton and no Host paths', async () => {
    const workspace = await makeWorkspace();
    const bag = makeCtx(workspace);
    const { bridge } = makeBridge(workspace, { handler: () => ({}) }, bag.ctx);
    const sessionId = await createBoundSession(bridge);
    const text = contextTextFor(bag, sessionId);
    assert(typeof text === 'string' && text.length > 0, 'a bound Session received no project context');
    const required = [
      `"${PROJECT}"`,
      'video_engine',
      'project.compose',
      'project.source',
      'expectedRevision',
      'publishedRevision',
      'E_REVISION_CONFLICT',
      '49152',
      'data-composition-id',
      'window.__timelines',
      'GSAP',
      'never retry with the stale revision',
      'Never write project files',
      'never search the plugin source repository',
    ];
    for (const fragment of required) {
      assert(text.includes(fragment), `the prompt context is missing "${fragment}"`);
    }
    assert(text.includes('reliable base'), 'the prompt context does not describe project.source as the reliable base');
    assert(text.includes('data-fps="30"') && text.includes('tl.seek(0)'), 'the prompt context lost the composition skeleton markers');
    assert(text.length <= 4000, `the prompt context exceeds its bounded budget: ${text.length}`);
    assert(!text.includes(workspace.root) && !text.includes(workspace.projectDir), 'the prompt context leaked an absolute Host path');
    assert(!text.includes(tmpdir()), 'the prompt context leaked an OS temp path');
    assert(!text.includes(homedir()), 'the prompt context leaked the home directory or username');
    assert(!/\/(?:Users|home|private|var)\//.test(text), 'the prompt context contains an absolute filesystem path');
    assert(!text.includes('file://'), 'the prompt context contains a file URL');
    await bridge.dispose();
  });

  await run('P3-012: compose/source obey the trusted Agent Session project scope', async () => {
    const OTHER = 'other';
    const workspace = await makeWorkspace({ projects: { [OTHER]: 'projects-other/other' } });
    const bag = makeCtx(workspace);
    const { bridge } = makeBridge(workspace, {
      handler: (method, params) => {
        if (method === 'project.compose') return composeResult();
        if (method === 'project.source') {
          return { projectId: params.projectId, revision: NEXT_REVISION, entry: 'index.html', bytes: Buffer.byteLength(COMPOSITION_HTML, 'utf8'), assets: ['assets/gsap.min.js'], html: COMPOSITION_HTML };
        }
        return {};
      },
    }, bag.ctx);
    const sessionId = await createBoundSession(bridge);
    const tool = createVideoTool(bridge);
    const exec = { agent: { session: { id: sessionId } } };
    const anonymous = await rejects(() => tool.execute({ action: 'project.source', projectId: PROJECT }, {}));
    assert(anonymous.message.includes('E_AGENT_REQUIRED'), `an anonymous source call was not refused: ${anonymous.message}`);
    const unbound = await rejects(() => tool.execute({ action: 'project.source', projectId: PROJECT }, { agent: { session: { id: 'session-unbound' } } }));
    assert(unbound.message.includes('E_SESSION_NOT_BOUND'), `an unbound source call was not refused: ${unbound.message}`);
    const foreign = await rejects(() => tool.execute({ action: 'project.source', projectId: OTHER }, exec));
    assert(foreign.message.includes('E_PROJECT_SCOPE'), `a foreign source call was not refused: ${foreign.message}`);
    const foreignCompose = await rejects(() => tool.execute({ action: 'project.compose', projectId: OTHER, expectedRevision: REVISION, operationId: 'scope-compose-1', html: COMPOSITION_HTML }, exec));
    assert(foreignCompose.message.includes('E_PROJECT_SCOPE'), `a foreign compose call was not refused: ${foreignCompose.message}`);
    const ownSource = await tool.execute({ action: 'project.source', projectId: PROJECT }, exec);
    assert(ownSource.action === 'project.source' && ownSource.result.html === COMPOSITION_HTML, 'own project.source did not reach the worker');
    const ownCompose = await tool.execute({ action: 'project.compose', projectId: PROJECT, expectedRevision: REVISION, operationId: 'scope-compose-2', html: COMPOSITION_HTML }, exec);
    assert(ownCompose.result.publishedRevision === NEXT_REVISION, 'own project.compose did not reach the worker');
    const text = contextTextFor(bag, sessionId);
    assert(text.includes(NEXT_REVISION), 'a Tool compose did not refresh the prompt facts with the published revision');
    await bridge.dispose();
  });

  await run('P3-012: project.list reports recency, a default project and tolerates stat failures', async () => {
    const OTHER = 'other';
    const workspace = await makeWorkspace({ projects: { [OTHER]: 'projects-other/other' } });
    // A registry project outside the trusted allowlist must never be listed.
    const hiddenDir = join(workspace.root, 'projects', 'hidden');
    await mkdir(hiddenDir, { recursive: true });
    const registry = JSON.parse(await readFile(workspace.registryPath, 'utf8'));
    registry.projects.hidden = hiddenDir;
    await writeFile(workspace.registryPath, JSON.stringify(registry));
    const demoEntry = join(workspace.projectDir, 'index.html');
    const otherEntry = join(workspace.registry.projects[OTHER], 'index.html');
    await writeFile(demoEntry, '<!doctype html>');
    await writeFile(otherEntry, '<!doctype html>');
    await utimes(demoEntry, new Date(1000), new Date(1000));
    await utimes(otherEntry, new Date(2000), new Date(2000));
    const bag = makeCtx(workspace);
    const { bridge } = makeBridge(workspace, { handler: () => ({}) }, bag.ctx);
    let list = await bridge.invoke('project.list', {});
    assert(Array.isArray(list.projects), 'project.list projects is not an array');
    assert(list.projects.every((item) => typeof item.projectId === 'string' && typeof item.updatedAt === 'number' && Object.keys(item).length === 2), 'project.list item shape changed');
    assert(list.projects.map((item) => item.projectId).join(',') === `${OTHER},${PROJECT}`, `project.list recency order is wrong: ${list.projects.map((item) => item.projectId).join(',')}`);
    assert(list.defaultProjectId === OTHER, `defaultProjectId is wrong: ${list.defaultProjectId}`);
    assert(list.projects.every((item) => item.projectId !== 'hidden'), 'an untrusted registry project was listed');

    // A newer demo entry becomes the default and the sort follows it.
    await utimes(demoEntry, new Date(3000), new Date(3000));
    list = await bridge.invoke('project.list', {});
    assert(list.projects.map((item) => item.projectId).join(',') === `${PROJECT},${OTHER}`, 'project.list did not follow the new entry mtime');
    assert(list.defaultProjectId === PROJECT, 'defaultProjectId did not follow the new entry mtime');

    // A broken entry stat reports updatedAt 0 without failing the list.
    await rm(otherEntry);
    await symlink(join(workspace.root, 'missing-entry.html'), otherEntry);
    list = await bridge.invoke('project.list', {});
    const broken = list.projects.find((item) => item.projectId === OTHER);
    assert(broken !== undefined && broken.updatedAt === 0, `a stat failure was not reported as updatedAt 0: ${JSON.stringify(broken)}`);
    assert(list.defaultProjectId === PROJECT, 'defaultProjectId changed after a tolerated stat failure');

    // Project listing stays UI-only.
    const toolError = await rejects(() => bridge.invoke('project.list', {}, { source: 'tool', agentSessionId: 'session-unbound' }));
    assert(toolError.code === 'E_METHOD', `project.list was exposed to the model Tool: ${toolError.code}`);
    await bridge.dispose();
  });

  await run('R1: a failed durable write never publishes the mapping and cleans its temp file', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-video-state-fault-'));
    const statePath = join(root, 'state.json');
    const store = new SessionStateStore({ path: statePath, allowedProjects: new Set([PROJECT]) });
    await store.ready;
    await mkdir(statePath);
    let failed;
    try {
      await store.addSession(PROJECT, 'session-one', true);
    } catch (error) {
      failed = error;
    }
    assert(failed !== undefined, 'a failed durable write was reported as success');
    assert((await store.projectForSession('session-one')) === null, 'a failed write published an in-memory mapping');
    const project = await store.project(PROJECT);
    assert(project.sessionIds.length === 0, 'a failed write changed the committed project');
    const leftovers = (await readdir(root)).filter((name) => name.startsWith('state.json.tmp-'));
    assert(leftovers.length === 0, `a failed write leaked temporary files: ${leftovers.join(', ')}`);
    await rm(statePath, { recursive: true, force: true });
    await store.addSession(PROJECT, 'session-two', true);
    assert((await store.projectForSession('session-two')) === PROJECT, 'a later queued write did not commit after the failure');
    await store.dispose();
    await rm(root, { recursive: true, force: true });
  });

  await run('R1: readers see the committed state while a candidate write is pending', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-video-state-pending-'));
    const store = new SessionStateStore({ path: join(root, 'state.json'), allowedProjects: new Set([PROJECT]) });
    await store.ready;
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const write = store.write.bind(store);
    store.write = async (candidate) => {
      await gate;
      return write(candidate);
    };
    const first = store.addSession(PROJECT, 'session-a', true);
    const before = await store.project(PROJECT);
    assert(before.sessionIds.length === 0, 'a pending candidate was visible to readers');
    const second = store.addSession(PROJECT, 'session-b', true);
    release();
    await Promise.all([first, second]);
    const after = await store.project(PROJECT);
    assert(after.sessionIds.join(',') === 'session-a,session-b', `queued writes did not compose: ${after.sessionIds.join(',')}`);
    await store.dispose();
    await rm(root, { recursive: true, force: true });
  });

  await run('R2: an accepted Session create drains on dispose and persists before teardown', async () => {
    const workspace = await makeWorkspace();
    let releaseCreate;
    let enteredCreate;
    const entered = new Promise((resolve) => { enteredCreate = resolve; });
    const gate = new Promise((resolve) => { releaseCreate = resolve; });
    const controller = {
      created: 0,
      async create() {
        this.created += 1;
        enteredCreate();
        await gate;
        return { sessionId: 'session-late' };
      },
      async rename() {
        return { title: 'x', seq: 1 };
      },
      async inspect(sessionId) {
        return { meta: { id: sessionId }, events: [] };
      },
    };
    const bag = makeCtx(workspace, { sessionController: controller });
    const { bridge } = makeBridge(workspace, { handler: () => ({}) }, bag.ctx);
    const pending = bridge.invoke('session.create', { projectId: PROJECT, requestId: 'drain-create' }, { source: 'http' }).then(
      (value) => ({ ok: true, value }),
      (error) => ({ ok: false, error })
    );
    await entered;
    assert(bridge.inFlight.size === 1, `session create was not admitted to inFlight (${bridge.inFlight.size})`);
    const dispose = bridge.dispose();
    const disposeAgain = bridge.dispose();
    assert(dispose === disposeAgain, 'repeated dispose returned different promises');
    await new Promise((resolve) => setImmediate(resolve));
    assert(bridge.disposed === false, 'dispose completed before the accepted Session create settled');
    const refused = await rejects(() => bridge.invoke('doctor', {}));
    assert(refused.code === 'E_WORKER_DISPOSED', `new work was accepted while closing: ${refused.code}`);
    releaseCreate();
    const result = await pending;
    await dispose;
    assert(result.ok === true && result.value.sessionId === 'session-late', `accepted create did not settle: ${result.ok ? '' : result.error.code}`);
    const stored = JSON.parse(await readFile(workspace.sessionStatePath, 'utf8'));
    assert(stored.projects[PROJECT].sessionIds.includes('session-late'), 'accepted create was not persisted before teardown');
    assert(bridge.disposed === true, 'bridge was not disposed');
  });

  await run('R2: a delayed rename is drained and late prompt context cannot register', async () => {
    const workspace = await makeWorkspace();
    let releaseRename;
    let enteredRename;
    const entered = new Promise((resolve) => { enteredRename = resolve; });
    const gate = new Promise((resolve) => { releaseRename = resolve; });
    const controller = {
      async create() {
        return { sessionId: 'session-rename' };
      },
      async rename() {
        enteredRename();
        await gate;
        return { title: 'x', seq: 1 };
      },
      async inspect(sessionId) {
        return { meta: { id: sessionId }, events: [] };
      },
    };
    const bag = makeCtx(workspace, { sessionController: controller });
    const { bridge } = makeBridge(workspace, { handler: () => ({}) }, bag.ctx);
    await bridge.invoke('session.list', { projectId: PROJECT }, { source: 'http' });
    assert(bag.contexts.length === 1, 'prompt context was not registered by the first session operation');
    const pending = bridge.invoke('session.create', { projectId: PROJECT, requestId: 'drain-rename' }, { source: 'http' });
    await entered;
    const dispose = bridge.dispose();
    await new Promise((resolve) => setImmediate(resolve));
    assert(bridge.disposed === false, 'dispose completed before the delayed rename settled');
    releaseRename();
    await pending;
    await dispose;
    const stored = JSON.parse(await readFile(workspace.sessionStatePath, 'utf8'));
    assert(stored.projects[PROJECT].sessionIds.includes('session-rename'), 'mapping was not persisted before context cleanup');
    assert(bag.contextDisposers.length === 1, 'prompt context was not disposed exactly once');
    assert(bag.contexts.length === 1, 'a late create registered prompt context after cleanup');
  });

  await run('R3: known mapping faults are rejected before the Host creates a Session', async () => {
    const workspace = await makeWorkspace();
    const corruptLiteral = '{broken';
    await writeFile(workspace.sessionStatePath, corruptLiteral);
    let bag = makeCtx(workspace);
    let bridge = makeBridge(workspace, { handler: () => ({}) }, bag.ctx).bridge;
    const corrupt = await rejects(() => bridge.invoke('session.create', { projectId: PROJECT, requestId: 'corrupt-key' }, { source: 'http' }));
    assert(corrupt.code === 'E_SESSION_STATE_CORRUPT', `corrupt state did not block create: ${corrupt.code}`);
    assert(bag.sessionController.created.length === 0, 'a Host Session was created despite a corrupt mapping');
    assert((await readFile(workspace.sessionStatePath, 'utf8')) === corruptLiteral, 'corrupt mapping file was modified');
    await bridge.dispose();

    await writeFile(workspace.sessionStatePath, JSON.stringify({ version: 99, projects: {}, sessions: {} }));
    bag = makeCtx(workspace);
    bridge = makeBridge(workspace, { handler: () => ({}) }, bag.ctx).bridge;
    const versionError = await rejects(() => bridge.invoke('session.create', { projectId: PROJECT, requestId: 'version-key' }, { source: 'http' }));
    assert(versionError.code === 'E_SESSION_STATE_VERSION', `unknown version did not block create: ${versionError.code}`);
    assert(bag.sessionController.created.length === 0, 'a Host Session was created despite an unknown state version');
    await bridge.dispose();

    const projects = { [PROJECT]: { sessionIds: [], activeSessionId: null, createdAt: 1, updatedAt: 1 } };
    const sessions = {};
    for (let index = 0; index < 200; index += 1) {
      const sessionId = 'session-cap-' + index;
      projects[PROJECT].sessionIds.push(sessionId);
      sessions[sessionId] = { projectId: PROJECT, createdAt: 1 };
    }
    projects[PROJECT].activeSessionId = 'session-cap-0';
    await writeFile(workspace.sessionStatePath, JSON.stringify({ version: 1, projects, sessions }));
    bag = makeCtx(workspace);
    bridge = makeBridge(workspace, { handler: () => ({}) }, bag.ctx).bridge;
    const limit = await rejects(() => bridge.invoke('session.create', { projectId: PROJECT, requestId: 'limit-key' }, { source: 'http' }));
    assert(limit.code === 'E_SESSION_STATE_LIMIT', `project cap did not block create: ${limit.code}`);
    assert(bag.sessionController.created.length === 0, 'a Host Session was created despite the per-project cap');
    await bridge.dispose();
  });

  await run('R4: requestId dedupe is scoped to one project', async () => {
    const workspace = await makeWorkspace({ projects: { a: 'projects-a/a', b: 'projects-b/b' } });
    const bag = makeCtx(workspace, { controller: { mint: (counter) => 'session-' + counter } });
    const { bridge } = makeBridge(workspace, { handler: () => ({}) }, bag.ctx);
    const first = await bridge.invoke('session.create', { projectId: 'a', requestId: 'same-key' }, { source: 'http' });
    const second = await bridge.invoke('session.create', { projectId: 'b', requestId: 'same-key' }, { source: 'http' });
    assert(first.projectId === 'a' && second.projectId === 'b', 'requestId dedupe returned another project result');
    assert(first.sessionId !== second.sessionId, 'cross-project dedupe reused the other project Session');
    assert(bag.sessionController.created.length === 2, 'cross-project create did not reach the controller twice');
    const retry = await bridge.invoke('session.create', { projectId: 'a', requestId: 'same-key' }, { source: 'http' });
    assert(retry.sessionId === first.sessionId, 'same-project retry did not reuse the cached result');
    assert(bag.sessionController.created.length === 2, 'same-project retry reached the controller again');
    const [left, right] = await Promise.all([
      bridge.invoke('session.create', { projectId: 'a' }, { source: 'http' }),
      bridge.invoke('session.create', { projectId: 'a' }, { source: 'http' }),
    ]);
    assert(left.sessionId === right.sessionId, 'concurrent same-project creates were not single-flight');
    assert(bag.sessionController.created.length === 3, 'concurrent same-project creates reached the controller twice');
    await bridge.dispose();
  });

  await run('R4: every accepted bridge request is admitted synchronously into one inFlight set', async () => {
    const workspace = await makeWorkspace();
    const inboxRoot = join(workspace.root, 'asset-inbox');
    const bag = makeCtx(workspace);
    let release;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    const { bridge } = makeBridgeWithConfig(workspace, { assetInboxRoot: inboxRoot }, {
      handler: async (method, params) => {
        await gate;
        if (method === 'project.create') return { projectId: 'created-project', revision: REVISION };
        if (method === 'asset.import') return { projectId: PROJECT, revision: REVISION };
        if (method === 'preview.release') return { snapshotId: params.snapshotId, released: true };
        if (method === 'preview.snapshot') return { snapshotId: 'a'.repeat(32), projectId: PROJECT, revision: REVISION, entry: 'index.html', files: [] };
        return {};
      },
    }, bag.ctx);
    const sessionId = await createBoundSession(bridge);
    const upload = await uploadPng(bridge, PROJECT, 'admission.png');
    assert(upload.response.status === 200, `admission upload failed: ${JSON.stringify(upload.body)}`);
    const ownFile = join(workspace.projectDir, 'own.png');
    await writeFile(ownFile, PNG);
    const calls = [
      bridge.invoke('doctor', {}),
      bridge.invoke('project.list', {}),
      bridge.invoke('session.diagnose', {}, { source: 'http' }),
      bridge.invoke('session.list', { projectId: PROJECT }, { source: 'http' }),
      bridge.invoke('session.select', { projectId: PROJECT, sessionId }, { source: 'http' }),
      bridge.invoke('project.create', { templateId: 'product-launch-v1' }, { source: 'http' }),
      bridge.invoke('asset.import', { projectId: PROJECT, expectedRevision: REVISION, operationId: 'admit-1', receiptId: upload.body.receiptId }, { source: 'http' }),
      bridge.invoke('preview.snapshot', { projectId: PROJECT, revision: REVISION }, { source: 'http' }),
      bridge.invoke('preview.release', { snapshotId: 'a'.repeat(32) }, { source: 'http' }),
      bridge.invoke('preview', { projectId: PROJECT, sessionId, path: ownFile }, { source: 'http' }),
    ];
    // All ten branches were admitted before any await could settle; the early
    // return branches are no longer outside the drain set.
    assert(bridge.inFlight.size === calls.length, `expected ${calls.length} admitted requests, saw ${bridge.inFlight.size}`);
    release();
    await Promise.allSettled(calls);
    assert(bridge.state().inFlight === 0, `inFlight was not released: ${bridge.state().inFlight}`);
    await bridge.dispose();
    assert(bridge.disposed === true, 'bridge was not disposed');
  });

  await run('R4: a delayed worker snapshot is drained and never published after dispose', async () => {
    const workspace = await makeWorkspace();
    const snapshotId = 'a'.repeat(32);
    const snapshotDir = join(workspace.outputRoot, 'previews', snapshotId);
    await mkdir(snapshotDir, { recursive: true });
    const entry = Buffer.from('<html><body>late snapshot</body></html>');
    await writeFile(join(snapshotDir, 'index.html'), entry);
    const bag = makeCtx(workspace);
    let release;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    const { bridge, engine } = makeBridge(workspace, {
      handler: async (method, params) => {
        if (method === 'preview.snapshot') {
          await gate;
          return {
            snapshotId,
            projectId: PROJECT,
            revision: REVISION,
            entry: 'index.html',
            expiresAt: new Date(Date.now() + 60000).toISOString(),
            files: [{ path: 'index.html', bytes: entry.length, sha256: createHash('sha256').update(entry).digest('hex') }],
          };
        }
        if (method === 'preview.release') return { snapshotId: params.snapshotId, released: true };
        return {};
      },
    }, bag.ctx);
    const request = bridge.invoke('preview.snapshot', { projectId: PROJECT, revision: REVISION }, { source: 'http' }).then(
      (value) => ({ ok: true, value }),
      (error) => ({ ok: false, error })
    );
    assert(bridge.inFlight.size === 1, `snapshot request was not admitted: ${bridge.inFlight.size}`);
    const dispose = bridge.dispose();
    await new Promise((resolve) => setImmediate(resolve));
    assert(bridge.disposed === false, 'dispose resolved before the accepted snapshot settled');
    release();
    const result = await request;
    await dispose;
    assert(result.ok === false && result.error.code === 'E_WORKER_DISPOSED', `late snapshot was published: ${result.ok ? 'resolved' : result.error.code}`);
    assert(bridge.snapshots.records.size === 0, 'a snapshot record was published after dispose began');
    assert(bag.routes.length === 0, `a preview route was published after dispose: ${bag.routes.length}`);
    assert(bridge.state().inFlight === 0 && bridge.disposed === true, 'dispose did not drain and complete');
    const methods = engine.instances[0].requests.map((entry2) => entry2.method);
    assert(methods.includes('preview.snapshot') && methods.includes('preview.release'), `late snapshot was not released: ${methods.join(',')}`);
    assert((await exists(join(snapshotDir, 'index.html'))) === true, 'Host preview teardown deleted worker-owned snapshot files');
  });

  await run('R4: a delayed upload body cannot write a file or receipt after dispose', async () => {
    const workspace = await makeWorkspace();
    const inboxRoot = join(workspace.root, 'asset-inbox');
    const { bridge } = makeBridgeWithConfig(workspace, { assetInboxRoot: inboxRoot }, { handler: () => ({}) });
    let streamController;
    const request = new Request('http://127.0.0.1/api/dsh-video/asset-upload', {
      method: 'POST',
      headers: { 'content-type': 'image/png', 'x-dsh-project-id': PROJECT, 'x-dsh-file-name': 'late.png' },
      body: new ReadableStream({
        start(controller) {
          streamController = controller;
        },
      }),
      duplex: 'half',
    });
    const uploadTask = bridge.uploadAsset(request);
    await new Promise((resolve) => setImmediate(resolve));
    const dispose = bridge.dispose();
    try {
      streamController.enqueue(PNG);
    } catch (_error) {
      /* dispose already cancelled the reader */
    }
    try {
      streamController.close();
    } catch (_error) {
      /* dispose already cancelled the reader */
    }
    const response = await uploadTask;
    await dispose;
    assert(response.ok === false, 'a delayed upload was accepted after dispose began');
    assert(bridge.assets.receipts.size === 0, 'an upload receipt survived dispose');
    assert((await listIfPresent(inboxRoot)).length === 0, 'an upload file survived dispose');
    assert(bridge.assets.disposed === true && bridge.disposed === true, 'inbox/bridge was not disposed');
  });

  await run('R4: asset inbox enforces trusted projects, expiry, failure cleanup and idempotent dispose', async () => {
    const workspace = await makeWorkspace();
    const inboxRoot = join(workspace.root, 'asset-inbox');
    await mkdir(inboxRoot, { recursive: true });
    const inbox = new AssetInbox({ root: inboxRoot, maxReceipts: 2, isTrustedProject: (id) => id === PROJECT });

    // 1. An unknown/unregistered project is rejected before any bytes are stored.
    const unknownResponse = await inboxUpload(inbox, 'unregistered', 'u.png');
    const unknownBody = await unknownResponse.json();
    assert(unknownResponse.status === 404 && unknownBody.error.code === 'E_PROJECT_NOT_FOUND', `unknown project upload was not rejected: ${unknownResponse.status}/${JSON.stringify(unknownBody)}`);
    assert((await listIfPresent(inboxRoot)).length === 0, 'rejected upload wrote a file');
    assert(inbox.receipts.size === 0, 'rejected upload created a receipt');

    // 2. A failed content upload stores nothing; a later retry succeeds cleanly.
    const badResponse = await inboxUpload(inbox, PROJECT, 'bad.png', Buffer.from('<!doctype html><script>1</script>'));
    assert(badResponse.status === 400, `non-image upload returned ${badResponse.status}`);
    assert((await listIfPresent(inboxRoot)).length === 0, 'failed upload left a file behind');
    assert(inbox.receipts.size === 0, 'failed upload created a receipt');
    const goodResponse = await inboxUpload(inbox, PROJECT, 'ok.png');
    assert(goodResponse.status === 200, `retry after a failed upload returned ${goodResponse.status}`);
    const goodReceipt = await goodResponse.json();
    assert(inbox.receipts.size === 1, 'successful retry did not create exactly one receipt');
    assert((await listIfPresent(inboxRoot)).length === 1, 'successful retry did not create exactly one file');

    // 3. Receipt count is bounded and an over-limit upload stores nothing.
    const secondResponse = await inboxUpload(inbox, PROJECT, 'cap.png');
    assert(secondResponse.status === 200, `second upload returned ${secondResponse.status}`);
    const cappedResponse = await inboxUpload(inbox, PROJECT, 'cap2.png');
    const cappedBody = await cappedResponse.json();
    assert(cappedResponse.status === 413 && cappedBody.error.code === 'E_ASSET_LIMIT', `receipt cap was not enforced: ${cappedResponse.status}/${JSON.stringify(cappedBody)}`);
    assert(inbox.receipts.size === 2 && (await listIfPresent(inboxRoot)).length === 2, 'over-limit upload leaked a file or receipt');

    // 4. An expired receipt sweep removes its owned inbox copy.
    const okayReceipt = inbox.receipts.get(goodReceipt.receiptId);
    const expiredTarget = okayReceipt.target;
    okayReceipt.createdAt = 0;
    const removed = await inbox.sweep();
    assert(removed === 1 && inbox.receipts.size === 1, `expired receipt was not swept: ${removed}`);
    assert((await exists(expiredTarget)) === false, 'expired receipt file survived the sweep');

    // 5. Dispose removes only this inbox's outstanding copies and is idempotent.
    const projectAsset = join(workspace.projectDir, 'keep.png');
    await writeFile(projectAsset, PNG);
    const firstDispose = inbox.dispose();
    const secondDispose = inbox.dispose();
    assert(firstDispose === secondDispose, 'repeated dispose returned different promises');
    await firstDispose;
    assert((await listIfPresent(inboxRoot)).length === 0, 'dispose left inbox copies behind');
    assert((await exists(projectAsset)) === true, 'dispose deleted a project asset');
    assert(inbox.disposed === true, 'inbox was not marked disposed');
    const lateResponse = await inboxUpload(inbox, PROJECT, 'late.png');
    const lateBody = await lateResponse.json();
    assert(lateResponse.status === 503 && lateBody.error.code === 'E_ASSET_DISPOSED', `late upload was accepted after dispose: ${lateResponse.status}`);
    assert(inbox.receipts.size === 0 && (await listIfPresent(inboxRoot)).length === 0, 'late upload wrote anything after dispose');
  });

  await run('R3: verifier executes the staged Host bytes and rejects tampered snapshots', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-video-staged-'));
    const staging = join(root, 'staging');
    const bundle = join(staging, 'bundle');
    const client = join(staging, 'engine-client');
    const worker = join(staging, 'engine-worker');
    await mkdir(join(bundle, 'host'), { recursive: true });
    await mkdir(join(bundle, 'node_modules'), { recursive: true });
    await mkdir(client, { recursive: true });
    await mkdir(join(worker, 'src'), { recursive: true });
    const bridgeSource = 'export class VideoBridge { constructor(options) { this.options = options; } static stagedMarker = "staged"; }\n';
    await writeFile(join(bundle, 'host', 'bridge.js'), bridgeSource);
    await writeFile(join(bundle, 'index.js'), 'export {};\n');
    await writeFile(join(bundle, 'package.json'), JSON.stringify({ name: 'dsh-video', version: '0.2.0', private: true, type: 'module' }));
    await writeFile(join(bundle, 'cordis.patch.yml'), '- insert:\n    - id: dsh-video\n      name: dsh-video\n      config: {}\n');
    await writeFile(join(client, 'package.json'), JSON.stringify({ name: 'dsh-video-engine-client', version: '0.1.1', private: true, type: 'module', exports: { '.': './index.js', './package.json': './package.json' } }));
    await writeFile(join(client, 'index.js'), 'export class WorkerClient {}\n');
    await writeFile(join(worker, 'package.json'), JSON.stringify({ name: 'dsh-video-engine-worker', version: '0.1.1', private: true, type: 'module', exports: { './worker': './src/worker.mjs', './package.json': './package.json' } }));
    await writeFile(join(worker, 'src', 'worker.mjs'), '// fake staged worker\n');
    await symlink(join('..', '..', 'engine-client'), join(bundle, 'node_modules', 'dsh-video-engine-client'), 'dir');
    await symlink(join('..', '..', 'engine-worker'), join(bundle, 'node_modules', 'dsh-video-engine-worker'), 'dir');
    const config = { workerNode: process.execPath, workerCwd: worker, registryPath: join(staging, 'registry.json'), artifactRoot: join(staging, 'output'), allowedProjects: ['demo'] };
    await writeFile(join(staging, 'config.json'), JSON.stringify(config, null, 2) + '\n');
    const configSha = sha256(await (await import('node:fs/promises')).readFile(join(staging, 'config.json')));
    const patchSha = sha256(await (await import('node:fs/promises')).readFile(join(bundle, 'cordis.patch.yml')));
    const bundleFiles = await digestTree(bundle, (rel) => rel.startsWith('node_modules/'));
    const clientFiles = await digestTree(client);
    const workerFiles = await digestTree(worker);
    await writeFile(join(staging, 'INTEGRITY.json'), JSON.stringify({
      rootCommit: 'a'.repeat(40),
      engineCommit: 'b'.repeat(40),
      versions: { bundle: '0.2.0', client: '0.1.1', worker: '0.1.1' },
      config: { path: join(staging, 'config.json'), sha256: configSha },
      stagedBundlePatch: { path: join(bundle, 'cordis.patch.yml'), sha256: patchSha },
      files: { bundle: bundleFiles, engineClient: clientFiles, engineWorker: workerFiles },
    }, null, 2) + '\n');

    const staged = await loadStagedHost(staging);
    assert(staged.VideoBridge.stagedMarker === 'staged', 'loaded an implementation other than the staged Host bytes');
    assert(staged.evidence.integrityVerified === true, 'integrity was not marked verified');
    assert(staged.evidence.hostModule.includes(staging), `executed Host path is outside the snapshot: ${staged.evidence.hostModule}`);

    const originalBridge = bridgeSource;
    await writeFile(join(bundle, 'host', 'bridge.js'), originalBridge + '// tampered\n');
    let error = await rejects(() => loadStagedHost(staging));
    assert(/host\/bridge\.js/.test(error.message) && /mismatch/.test(error.message), `tampered Host was not rejected: ${error.message}`);

    await writeFile(join(bundle, 'host', 'bridge.js'), originalBridge);
    const tamperedConfig = Object.assign({}, config, { allowedProjects: ['other'] });
    await writeFile(join(staging, 'config.json'), JSON.stringify(tamperedConfig, null, 2) + '\n');
    error = await rejects(() => loadStagedHost(staging));
    assert(/config digest does not match/.test(error.message), `tampered config was not rejected: ${error.message}`);

    await writeFile(join(staging, 'config.json'), JSON.stringify(config, null, 2) + '\n');
    await writeFile(join(bundle, 'host', 'extra.js'), '// unrecorded source\n');
    error = await rejects(() => loadStagedHost(staging));
    assert(/unrecorded source file: host\/extra\.js/.test(error.message), `unrecorded source was not rejected: ${error.message}`);
    await rm(join(bundle, 'host', 'extra.js'));
    await writeFile(join(worker, 'src', 'worker.mjs'), '// tampered worker\n');
    error = await rejects(() => loadStagedHost(staging));
    assert(/src\/worker\.mjs/.test(error.message) && /mismatch/.test(error.message), `tampered engine source was not rejected: ${error.message}`);
    await rm(root, { recursive: true, force: true });
  });

  await run('apply registers one request route, one artifact route, one asset route and one Tool within an effect', async () => {
    const workspace = await makeWorkspace();
    const fake = makeCtx(workspace);
    apply(fake.ctx, workspace.config);
    assert(fake.routes.length === 2, `routes ${fake.routes.length}`);
    assert(fake.routes[0].path === '/api/dsh-video/request', 'request route path');
    assert(fake.routes[1].path === '/api/dsh-video/artifact', 'artifact route path');
    assert(fake.tools.length === 1 && fake.tools[0].name === TOOL_NAME, 'tool registration');
    assert(fake.cleanups.length === 1 && typeof fake.cleanups[0] === 'function', 'effect cleanup');
    await fake.cleanups[0]();
    assert(fake.routes.length === 0, 'effect cleanup left routes registered');

    // With a configured inbox the same effect installs the streaming upload route
    // and its cleanup removes it before the bridge drains accepted work.
    const withInbox = await makeWorkspace();
    const inboxRoot = join(withInbox.root, 'asset-inbox');
    const inboxCtx = makeCtx(withInbox);
    apply(inboxCtx.ctx, Object.assign({}, withInbox.config, { assetInboxRoot: inboxRoot }));
    assert(inboxCtx.routes.length === 3, `expected three routes, saw ${inboxCtx.routes.length}`);
    assert(inboxCtx.routes[2].path === '/api/dsh-video/asset-upload' && inboxCtx.routes[2].requestBody === 'streaming', 'asset upload route is not the streaming route');
    await inboxCtx.cleanups[0]();
    assert(inboxCtx.routes.length === 0, 'asset route cleanup left routes registered');
  });

  console.log(`\n${passes} passed, ${failures.length} failed`);
  if (failures.length > 0) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    // Temporary roots are left to the OS temp cleaner; each workspace is tiny.
  });
