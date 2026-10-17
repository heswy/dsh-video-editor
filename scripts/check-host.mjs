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
 *   - artifact byte validation (name, root, size, SHA-256).
 *
 * A fake WorkerClient is injected; these are contract tests, not evidence that
 * DSH activation or a real engine subprocess works. Those are staged separately.
 *
 * Run: node scripts/check-host.mjs
 */

import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { VideoBridge } from '../host/bridge.js';
import { buildWorkerEnv } from '../host/env.js';
import { createRequestRoute, createArtifactRoute, statusForError } from '../host/routes.js';
import { createVideoTool, TOOL_NAME } from '../host/tool.js';
import { BridgeError } from '../host/errors.js';
import { TOOL_RESULT_BYTES } from '../host/limits.js';
import { loadEngine } from '../host/engine.js';
import { digestTree, loadStagedHost, sha256 } from './lib/staged-host.mjs';
import { apply } from '../index.js';

const PROJECT = 'demo';
const REVISION = 'a'.repeat(64);
const JOB_ID = '11111111-2222-4333-8444-555555555555';
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01, 0x02]);
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
  const registryPath = join(root, 'registry.json');
  const registry = Object.assign(
    { root: projectsRoot, projects: { [PROJECT]: projectDir }, outputRoot },
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
      allowedProjects: [PROJECT],
      startupTimeoutMs: 1000,
      requestTimeoutMs: 1000,
      shutdownTimeoutMs: 500,
      maxArtifactBytes: 1024 * 1024,
    },
    (overrides && overrides.config) || {}
  );
  return { root, projectDir, outputRoot, workerCwd, registryPath, workerEntry, config, registry };
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

function makeCtx(workspace) {
  const routes = [];
  const tools = [];
  const cleanups = [];
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
          return () => {};
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
  };
  return { ctx, routes, tools, cleanups };
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
    });
    const tool = createVideoTool(bridge);
    assert(tool.name === TOOL_NAME, 'tool name');
    assert(tool.parameters.additionalProperties === false, 'tool must reject extra params');
    const first = await tool.execute({ action: 'open', projectId: PROJECT }, {});
    assert(first.result.revision === REVISION, 'tool result');
    assert(engine.instances[0].requests[0].method === 'open', 'tool did not use the dispatcher');
    const error = await rejects(() => tool.execute({ action: 'open', projectId: PROJECT }, {}));
    assert(error.message.includes('E_REVISION_CONFLICT') && error.message.includes('uncertain=true'), 'tool error lost structure');
    const bad = await rejects(() => tool.execute({ action: 'open', projectId: PROJECT, path: '/tmp/x' }, {}));
    assert(bad.message.includes('E_PARAMS'), 'tool accepted an extra path parameter');
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
    const { bridge } = makeBridge(workspace, {
      handler: (method) => (method === 'open' ? { text: 'x'.repeat(70000) } : {}),
    });
    const error = await rejects(() => bridge.invoke('open', { projectId: PROJECT }, { source: 'tool' }));
    assert(error.code === 'E_RESULT_LIMIT', `unexpected bridge limit error ${error.code}`);
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
    await writeFile(join(worker, 'src', 'worker.mjs'), '// tampered worker\n');
    error = await rejects(() => loadStagedHost(staging));
    assert(/src\/worker\.mjs/.test(error.message) && /mismatch/.test(error.message), `tampered engine source was not rejected: ${error.message}`);
    await rm(root, { recursive: true, force: true });
  });

  await run('apply registers one request route, one artifact route and one Tool within an effect', async () => {
    const workspace = await makeWorkspace();
    const fake = makeCtx(workspace);
    apply(fake.ctx, workspace.config);
    assert(fake.routes.length === 2, `routes ${fake.routes.length}`);
    assert(fake.routes[0].path === '/api/dsh-video/request', 'request route path');
    assert(fake.routes[1].path === '/api/dsh-video/artifact', 'artifact route path');
    assert(fake.tools.length === 1 && fake.tools[0].name === TOOL_NAME, 'tool registration');
    assert(fake.cleanups.length === 1 && typeof fake.cleanups[0] === 'function', 'effect cleanup');
    await fake.cleanups[0]();
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
