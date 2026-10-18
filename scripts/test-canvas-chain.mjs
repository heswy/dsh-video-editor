#!/usr/bin/env node
/**
 * P3-008 real managed-engine chain through the staged Host bridge.
 *
 * Exercises the exact staged Host/worker bytes: managed project creation,
 * Session binding, scene creation/background update, direct text/layout/style
 * edit, history undo/redo, PNG asset import, preview snapshot route composition,
 * frame/render, and close/reopen persistence. It is a development integration
 * run, not a DSH installation or a real model request.
 *
 * Usage: node scripts/test-canvas-chain.mjs --staging <staging directory>
 */

import { createHash, randomUUID } from 'node:crypto';
import { access, mkdir, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { delimiter, dirname, isAbsolute, join, resolve } from 'node:path';
import { loadStagedHost, sha256 } from './lib/staged-host.mjs';

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nXQAAAAASUVORK5CYII=',
  'base64'
);
const TERMINAL = new Set(['succeeded', 'failed', 'cancelled', 'timed_out']);
const INSTANCE = 'p3008canvas01';
const NONCE = '0123456789abcdef0123456789abcdef';

function usage(message) {
  if (message) console.error(message);
  console.error('usage: node scripts/test-canvas-chain.mjs --staging <absolute staging directory>');
  process.exit(2);
}

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--staging') {
      args.staging = argv[index + 1];
      index += 1;
    } else usage(`unknown argument ${argv[index]}`);
  }
  if (!args.staging || isAbsolute(args.staging) === false) usage('--staging must be an absolute directory');
  return args;
}

function sleep(ms) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function resolveExecutable(command, env) {
  if (isAbsolute(command)) {
    await access(command, constants.X_OK);
    return command;
  }
  for (const directory of ((env && env.PATH) || process.env.PATH || '').split(delimiter)) {
    if (directory === '') continue;
    const candidate = join(directory, command);
    try {
      await access(candidate, constants.X_OK);
      return candidate;
    } catch (_error) {
      /* continue */
    }
  }
  throw new Error(`executable not found: ${command}`);
}

function fakeSessionController(runId) {
  let counter = 0;
  return {
    async create(request) {
      counter += 1;
      return { sessionId: `session-canvas-${runId}-${counter}` };
    },
    async rename(request) {
      return { title: request.title, seq: 1 };
    },
    async inspect(sessionId) {
      return { meta: { id: sessionId }, events: [] };
    },
  };
}

function fakeCtx() {
  const routes = [];
  const tools = [];
  const warnings = [];
  const sessionController = fakeSessionController(randomUUID().slice(0, 8));
  const services = {
    sessionController,
    workspaceRegistry: { archivedSessionIds: [] },
    systemPrompt: {
      context() {
        return () => {};
      },
    },
    agents: { get() { return undefined; } },
  };
  const cleanups = [];
  const ctx = {
    logger: { warn(...args) { warnings.push(args.map(String).join(' ').slice(0, 500)); }, error() {} },
    subprocess: { resolveExecutable },
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
      cleanups.push(callback);
      return () => {};
    },
    get(name) {
      return services[name];
    },
  };
  return { ctx, routes, tools, warnings, sessionController, cleanups };
}

async function waitJob(bridge, jobId, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    last = await bridge.invoke('status', { jobId });
    if (TERMINAL.has(last.state)) return last;
    await sleep(500);
  }
  throw new Error(`job ${jobId} did not settle; last state ${last && last.state}`);
}

async function invoke(bridge, method, params) {
  return bridge.invoke(method, params, { source: 'http' });
}

async function writeEvidence(directory, evidence) {
  await mkdir(directory, { recursive: true });
  const file = join(directory, `canvas-chain-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  await writeFile(file, JSON.stringify(evidence, null, 2) + '\n');
  return file;
}

function opId(prefix) {
  return `${prefix}-${randomUUID().slice(0, 8)}`;
}

function titleElement(inspected) {
  const elements = Array.isArray(inspected.elements) ? inspected.elements : [];
  const target = elements.find(
    (element) =>
      typeof element.stableId === 'string' &&
      element.stableId.endsWith('-title') &&
      Array.isArray(element.capabilities) &&
      element.capabilities.includes('text') &&
      element.capabilities.includes('layout')
  );
  assert(target !== undefined, 'new controlled project has no editable title element');
  return target;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const staging = resolve(args.staging);
  const staged = await loadStagedHost(staging);
  const config = staged.config;
  const integrity = staged.integrity;
  const host = fakeCtx();
  const bridge = new staged.VideoBridge({ ctx: host.ctx, rawConfig: config });
  const evidence = {
    kind: 'p3-008-managed-canvas-chain',
    startedAt: new Date().toISOString(),
    staging,
    engineCommit: integrity.engineCommit,
    rootCommit: integrity.rootCommit,
    versions: integrity.versions,
    executedHost: staged.evidence,
  };
  try {
    const projects = await invoke(bridge, 'project.list', {});
    evidence.projectListBefore = projects;
    assert(Array.isArray(projects.projects) && projects.projects.some((item) => item.projectId === 'demo'), 'managed demo project is missing');

    const created = await invoke(bridge, 'project.create', { templateId: 'product-launch-v1', title: 'P3-008 Canvas Chain' });
    evidence.projectCreate = { projectId: created.projectId, revision: created.revision, scenes: created.scenes.map((scene) => scene.sceneId) };
    assert(created.projectId && /^proj-/.test(created.projectId), 'project.create did not return a controlled id');
    const projectId = created.projectId;
    let inspected = await invoke(bridge, 'inspect', { projectId });
    assert(inspected.scenes.length === 1, 'created project must start with one Scene');

    const session = await invoke(bridge, 'session.create', { projectId, requestId: opId('bind') });
    evidence.sessionBinding = { sessionId: session.sessionId, activeSessionId: session.activeSessionId };
    const sessionList = await invoke(bridge, 'session.list', { projectId });
    assert(sessionList.sessions.some((item) => item.sessionId === session.sessionId), 'Session binding was not persisted for the created project');

    // Three scenes ~15s.
    while (inspected.scenes.length < 3) {
      const index = inspected.scenes.length + 1;
      await invoke(bridge, 'scene.create', {
        projectId,
        expectedRevision: inspected.revision,
        operationId: opId(`scene-create-${index}`),
        template: { title: `Scene ${index}`, duration: 5 },
      });
      inspected = await invoke(bridge, 'inspect', { projectId });
    }
    evidence.scenes = inspected.scenes.map((scene) => ({ sceneId: scene.sceneId, duration: scene.duration }));
    assert(inspected.scenes.length === 3 && inspected.duration === 15, `expected three 5s scenes/15s, got ${inspected.scenes.length}/${inspected.duration}`);

    // Scene-level background yellow.
    const firstScene = inspected.scenes[0];
    const sceneUpdate = await invoke(bridge, 'scene.update', {
      projectId,
      expectedRevision: inspected.revision,
      operationId: opId('scene-yellow'),
      sceneId: firstScene.sceneId,
      template: { title: firstScene.title, duration: firstScene.duration, color: '#ffd400', accent: '#111111' },
    });
    evidence.sceneYellow = { revision: sceneUpdate.revision, changeSummary: sceneUpdate.changeSummary };
    inspected = await invoke(bridge, 'inspect', { projectId });

    // Human text/layout/style edits on one stable object in one atomic batch.
    const target = titleElement(inspected);
    const fontBase = target.style && Number.isFinite(target.style.fontSize) ? target.style.fontSize : 64;
    const humanEdit = await invoke(bridge, 'edit', {
      projectId,
      expectedRevision: inspected.revision,
      operationId: opId('human-edit'),
      ops: [
        { type: 'text', target: target.stableId, text: '人工编辑标题' },
        { type: 'layout', target: target.stableId, unit: 'composition-px', box: { left: 120, top: 260, width: 900 } },
        { type: 'style', target: target.stableId, styles: { color: '#112233', fontSize: Math.max(8, Math.min(256, fontBase)) } },
      ],
    });
    inspected = await invoke(bridge, 'inspect', { projectId });
    const edited = inspected.elements.find((element) => element.stableId === target.stableId);
    evidence.humanEdit = { revision: humanEdit.revision, stableId: target.stableId, layout: edited.layout, style: edited.style, text: edited.text };
    assert(edited.text === '人工编辑标题' && edited.layout && edited.layout.left === 120 && edited.style && edited.style.color === '#112233', 'human text/layout/style edit did not persist');

    // Undo/redo the human edit and verify real content.
    const undo = await invoke(bridge, 'undo', { projectId, expectedRevision: inspected.revision, operationId: opId('undo') });
    const afterUndo = await invoke(bridge, 'inspect', { projectId });
    const undoTarget = afterUndo.elements.find((element) => element.stableId === target.stableId);
    assert(undoTarget.text !== '人工编辑标题', 'undo did not restore the previous text');
    const redo = await invoke(bridge, 'redo', { projectId, expectedRevision: afterUndo.revision, operationId: opId('redo') });
    const afterRedo = await invoke(bridge, 'inspect', { projectId });
    const redoTarget = afterRedo.elements.find((element) => element.stableId === target.stableId);
    assert(redoTarget.text === '人工编辑标题', 'redo did not restore the human edit');
    evidence.history = { undoRevision: undo.revision, redoRevision: redo.revision, afterUndo: undoTarget.text, afterRedo: redoTarget.text };

    // Asset upload receipt + import.
    const upload = await bridge.uploadAsset(
      new Request('http://127.0.0.1/api/dsh-video/asset-upload', {
        method: 'POST',
        headers: {
          'content-type': 'image/png',
          'x-dsh-project-id': projectId,
          'x-dsh-file-name': 'canvas-test.png',
        },
        body: PNG,
      })
    );
    const receipt = await upload.json();
    assert(upload.ok && receipt.receiptId, `asset upload failed: ${JSON.stringify(receipt)}`);
    const imported = await invoke(bridge, 'asset.import', {
      projectId,
      expectedRevision: afterRedo.revision,
      operationId: opId('asset-import'),
      receiptId: receipt.receiptId,
    });
    evidence.assetImport = { revision: imported.revision, asset: imported.asset, assets: imported.assets.map((file) => file.path) };
    assert(imported.asset && imported.asset.mediaType === 'image/png', 'PNG asset import did not return an asset');
    inspected = await invoke(bridge, 'inspect', { projectId });
    assert(inspected.files.some((file) => file.path === imported.asset.path), 'imported asset is not in the project manifest');

    // Use the imported asset in the first scene's shot.
    const sceneAfterAsset = inspected.scenes[0];
    const useAsset = await invoke(bridge, 'scene.update', {
      projectId,
      expectedRevision: inspected.revision,
      operationId: opId('scene-shot'),
      sceneId: sceneAfterAsset.sceneId,
      template: { title: sceneAfterAsset.title, duration: sceneAfterAsset.duration, color: '#ffd400', accent: '#111111', shot: imported.asset.path },
    });
    evidence.sceneShot = { revision: useAsset.revision, shot: imported.asset.path };
    inspected = await invoke(bridge, 'inspect', { projectId });

    // Snapshot registration and exact byte/CSP checks through the fake Host routes.
    const snapshot = await invoke(bridge, 'preview.snapshot', { projectId, revision: inspected.revision, ttlMs: 120000 });
    evidence.snapshot = { snapshotId: snapshot.snapshotId, revision: snapshot.revision, entry: snapshot.entry, entryUrl: snapshot.entryUrl, fileCount: snapshot.files.length };
    assert(snapshot.entryUrl && snapshot.routeBase === '/api/dsh-video/preview', 'snapshot did not expose the preview route');
    const entryRoute = host.routes.find((route) => route.path === snapshot.entryUrl);
    assert(entryRoute !== undefined, 'snapshot entry route was not registered');
    const entryResponse = await entryRoute.fetch(
      new Request(`http://127.0.0.1${snapshot.entryUrl}?instance=${INSTANCE}&nonce=${NONCE}`, { method: 'GET' })
    );
    assert(entryResponse.status === 200, `snapshot entry status ${entryResponse.status}`);
    const entryHtml = await entryResponse.text();
    assert(entryHtml.includes('/api/dsh-video/canvas-runtime.js'), 'snapshot entry did not inject the fixed runtime');
    assert((entryResponse.headers.get('content-security-policy') || '').includes("connect-src 'none'"), 'snapshot CSP is missing connect-src none');
    const assetRoute = host.routes.find((route) => route.path.endsWith('/assets/gsap.min.js'));
    assert(assetRoute !== undefined, 'snapshot asset route was not registered');
    const assetResponse = await assetRoute.fetch(new Request(`http://127.0.0.1${assetRoute.path}`, { method: 'GET' }));
    const assetBytes = await assetResponse.arrayBuffer();
    assert(assetResponse.status === 200 && assetBytes.byteLength > 0, 'snapshot asset route did not serve bytes');
    evidence.snapshotRouteCheck = { entryStatus: entryResponse.status, runtimeInjected: true, assetBytes: assetBytes.byteLength };
    await invoke(bridge, 'preview.release', { snapshotId: snapshot.snapshotId });
    assert(host.routes.every((route) => route.path !== snapshot.entryUrl), 'released snapshot route is still registered');

    // Real frame and MP4 for the final revision.
    const frameStart = await invoke(bridge, 'frame', { projectId, revision: inspected.revision, time: 1.5 });
    const frameJob = await waitJob(bridge, frameStart.jobId, 120000);
    assert(frameJob.state === 'succeeded' && frameJob.artifact, `frame did not succeed: ${frameJob.state}`);
    evidence.frame = { jobId: frameJob.jobId, state: frameJob.state, artifact: frameJob.artifact };
    // Verify the scene background is actually yellow in the rendered frame.
    const frameBytes = await bridge.readArtifact(frameStart.jobId);
    const { decodePng } = await import(join(staging, 'engine-worker', 'test', 'png-decode.mjs'));
    const image = decodePng(Buffer.from(frameBytes.bytes));
    const sample = (x, y) => {
      const offset = (y * image.width + x) * image.channels;
      return [image.data[offset], image.data[offset + 1], image.data[offset + 2]];
    };
    const background = sample(8, 8);
    evidence.frameBackground = { expected: [255, 212, 0], actual: background };
    assert(
      background[0] === 255 && background[1] === 212 && background[2] === 0,
      `scene background is not the requested yellow: ${background.join(',')}`
    );
    const renderStart = await invoke(bridge, 'render', { projectId, revision: inspected.revision });
    const renderJob = await waitJob(bridge, renderStart.jobId, 180000);
    assert(renderJob.state === 'succeeded' && renderJob.artifact, `render did not succeed: ${renderJob.state}`);
    evidence.render = { jobId: renderJob.jobId, state: renderJob.state, artifact: renderJob.artifact };

    const history = await invoke(bridge, 'history', { projectId, limit: 20 });
    evidence.historyView = { revision: history.revision, canUndo: history.canUndo, canRedo: history.canRedo, entries: history.entries.length };
    assert(history.entries.length >= 4 && history.canUndo === true, 'history did not record the managed operations');

    // Close/reopen persistence.
    await invoke(bridge, 'close', { projectId });
    const reopened = await invoke(bridge, 'open', { projectId });
    const finalInspect = await invoke(bridge, 'inspect', { projectId });
    evidence.reopen = { revision: reopened.revision, inspectedRevision: finalInspect.revision, scenes: finalInspect.scenes.length, duration: finalInspect.duration };
    assert(reopened.revision === inspected.revision && finalInspect.revision === inspected.revision, 'close/reopen changed the managed project revision');
    assert(finalInspect.scenes.length === 3 && finalInspect.files.some((file) => file.path === imported.asset.path), 'reopened project lost scenes or imported asset');
    await invoke(bridge, 'close', { projectId });
    evidence.ok = true;
    evidence.finishedAt = new Date().toISOString();
  } catch (error) {
    evidence.ok = false;
    evidence.error = { message: error instanceof Error ? error.message : String(error), stack: error instanceof Error ? error.stack : undefined };
    evidence.hostWarnings = host.warnings.slice(-20);
    throw error;
  } finally {
    try {
      await bridge.dispose();
    } catch (_error) {
      /* teardown is reported by the runner */
    }
    evidence.hostWarnings = host.warnings.slice(-20);
    evidence.evidenceFile = await writeEvidence(join(dirname(staging), 'evidence'), evidence);
    console.log(JSON.stringify({ evidence: evidence.evidenceFile, ok: evidence.ok, engineCommit: evidence.engineCommit, rootCommit: evidence.rootCommit }, null, 2));
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
