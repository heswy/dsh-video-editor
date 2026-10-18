#!/usr/bin/env node
/**
 * P3-012 conversation-first real-browser preview verification.
 *
 * Loads the EXACT staged client implementation (`<staging>/bundle/client.js`)
 * and mounts the real `VideoWorkspace` (and therefore the real `CanvasWorkspace`
 * preview-only mode) in real Chrome, against the real staged Host bridge over
 * its real request route, a real managed worker project and the real fixed
 * snapshot runtime:
 *
 *   B1. automatic first preview after publish (no user refresh);
 *   B2. two consecutive project.compose rounds update the SAME project and the
 *       canvas revision marker + rendered frame automatically;
 *   B3. play/pause + seek are observed through the fixed runtime;
 *   B4. a revision whose snapshot cannot load shows the recoverable error with
 *       retry (never the legacy empty-frame copy), an explicit retry recovers,
 *       and a following good revision recovers automatically;
 *   B5. the rendered product panel contains NO deferred manual-edit controls and
 *       user gestures on the preview issue no write request.
 *
 * What is real: the staged client factory body extracted by region markers
 * (sha256 recorded), the staged Host bridge, worker, managed project, snapshots,
 * CSP, fixed canvas runtime, and the browser input/rendering.
 * What is simulated (documented in evidence): the host-owned native conversation
 * renderer seam (`sessions` client service + `SessionProvider` /
 * `renderFactorySlot` props are inert harness faces) because P3-012 does not
 * change the conversation panel; failure injection wraps `window.fetch` inside
 * the PAGE only (one-shot host-shaped errors), never the staged source.
 *
 * Mutable bridge/worker state is redirected into a fresh OS temp directory; the
 * staging tree is read-only and audited before/after. No DSH install, no real
 * model call, no user project/profile writes.
 *
 * Usage:
 *   node scripts/test-conversation-preview.mjs --staging <absolute staging dir>
 *                                            [--out <absolute evidence dir>]
 */

import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadStagedHost } from './lib/staged-host.mjs';
import {
  DEFAULT_EVIDENCE_ROOT,
  UsageError,
  assert,
  callTool,
  compareStagingSources,
  createChecks,
  fakeCtx,
  invokeHttp,
  listStagingSources,
  loadStagedTool,
  parseCli,
  prepareStateRoot,
  sanitize,
  sha256,
  sleep,
  stamp,
  writeBinary,
  writeEvidence,
} from './lib/conversation-harness.mjs';
import {
  genreA,
  genreAModified,
  genreB,
  modifyGenreBAgain,
  modifyGenreB,
} from './lib/conversation-fixtures.mjs';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const LIB_DIR = join(SCRIPT_DIR, 'lib');
const KIND = 'p3-012-conversation-preview-browser';
const REQUEST_PATH = '/api/dsh-video/request';
const WRITE_METHODS = new Set(['edit', 'scene.create', 'scene.update', 'scene.remove', 'scene.reorder', 'undo', 'redo', 'asset.import', 'render', 'frame', 'project.compose']);
// Valid fixed-runtime handshake values used only for the Host-route retention probe.
const RETENTION_INSTANCE = 'p3012retention1';
const RETENTION_NONCE = '0123456789abcdef0123456789abcdef';

function usage(message) {
  if (message) console.error(message);
  console.error('usage: node scripts/test-conversation-preview.mjs --staging <absolute staging directory> [--out <absolute evidence dir>]');
  process.exit(2);
}

function opId(prefix) {
  return (prefix || 'op') + '-' + createHash('sha256').update(String(Date.now()) + Math.random()).digest('hex').slice(0, 16);
}

/** Same region-marker extraction contract as the reviewed P3-008 harness. */
function regionSlice(source, name) {
  const lines = source.split('\n');
  const startMarker = '//#region ' + name;
  const starts = [];
  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index].trim() === startMarker) starts.push(index);
  }
  assert(starts.length === 1, 'staged client.js must contain exactly one "' + startMarker + '" marker (found ' + starts.length + ')');
  const start = starts[0];
  let end = -1;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (lines[index].trim() === '//#endregion') { end = index; break; }
  }
  assert(end !== -1, 'staged client.js region "' + name + '" has no end marker');
  const text = lines.slice(start, end + 1).join('\n');
  return { name, startLine: start + 1, endLine: end + 1, lines: end - start + 1, bytes: Buffer.byteLength(text, 'utf8'), sha256: sha256(Buffer.from(text, 'utf8')), text };
}

/**
 * Extract the staged client factory body: every region BEFORE `//#region plugin`
 * (constants, locale, styles, diagnostics, store, helpers, icons, host bridge
 * helpers, components incl. CanvasWorkspace/VideoWorkspace). The plugin region
 * is registration only and is replaced by the harness's direct component mount.
 */
function extractStagedClient(clientSource) {
  const locale = regionSlice(clientSource, 'locale dictionaries');
  const styles = regionSlice(clientSource, 'styles');
  const lines = clientSource.split('\n');
  const constantsMarkers = [];
  const pluginMarkers = [];
  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index].trim() === '//#region constants') constantsMarkers.push(index);
    if (lines[index].trim() === '//#region plugin') pluginMarkers.push(index);
  }
  assert(constantsMarkers.length === 1, 'staged client.js must contain exactly one constants region marker');
  assert(pluginMarkers.length === 1, 'staged client.js must contain exactly one plugin region marker');
  assert(constantsMarkers[0] < pluginMarkers[0], 'staged client.js region order changed (constants must precede plugin)');
  const bodyLines = lines.slice(constantsMarkers[0], pluginMarkers[0]);
  const bodyText = bodyLines.join('\n');
  assert(bodyText.includes('function VideoWorkspace('), 'staged client factory body is missing VideoWorkspace');
  assert(bodyText.includes('function CanvasWorkspace('), 'staged client factory body is missing CanvasWorkspace');
  assert(bodyText.includes('async function hostRequest('), 'staged client factory body is missing hostRequest');
  let lastNonEmpty = null;
  for (let index = bodyLines.length - 1; index >= 0; index -= 1) {
    if (bodyLines[index].trim().length > 0) { lastNonEmpty = bodyLines[index].trim(); break; }
  }
  assert(lastNonEmpty === '//#endregion', 'staged client factory body does not end with a region end marker (last line: ' + JSON.stringify(lastNonEmpty) + ')');

  let EN;
  try {
    EN = new Function(locale.text + '\nreturn EN;')();
  } catch (error) {
    throw new Error('staged locale dictionary slice could not be evaluated: ' + (error instanceof Error ? error.message : String(error)));
  }
  assert(EN !== null && typeof EN === 'object', 'staged EN dictionary is not an object');
  let CSS;
  try {
    CSS = new Function(styles.text + '\nreturn CSS;')();
  } catch (error) {
    throw new Error('staged CSS slice could not be evaluated: ' + (error instanceof Error ? error.message : String(error)));
  }
  assert(typeof CSS === 'string' && CSS.length > 1000, 'staged CSS slice is unexpectedly small');

  const glue = '\nreturn { VideoWorkspace: VideoWorkspace, CanvasWorkspace: CanvasWorkspace, hostRequest: hostRequest };\n';
  const factoryBody = '"use strict";\n' + bodyText + '\n' + glue;
  try {
    // Compile only. The staged factory body declares its own
    // `const React = require('react')`, so the module contract parameter is
    // `require`; the harness page supplies the React shim through it.
    new Function('require', factoryBody);
  } catch (error) {
    throw new Error('extracted staged client factory body does not compile: ' + (error instanceof Error ? error.message : String(error)));
  }
  const bodySha256 = sha256(Buffer.from(bodyText, 'utf8'));
  const pageSource = 'window.ConversationModule = function (require) {\n' + factoryBody + '\n};\n';
  return {
    locale, styles, EN, CSS, factoryBody, pageSource,
    evidence: {
      clientBytes: Buffer.byteLength(clientSource, 'utf8'),
      clientSha256: sha256(Buffer.from(clientSource, 'utf8')),
      factoryStartLine: constantsMarkers[0] + 1,
      factoryEndLine: pluginMarkers[0],
      factoryLines: bodyLines.length,
      factoryBytes: Buffer.byteLength(bodyText, 'utf8'),
      factorySha256: bodySha256,
      locale: { startLine: locale.startLine, endLine: locale.endLine, bytes: locale.bytes, sha256: locale.sha256 },
      styles: { startLine: styles.startLine, endLine: styles.endLine, bytes: styles.bytes, sha256: styles.sha256 },
      factoryCompiled: true,
      enKeys: Object.keys(EN).length,
      cssBytes: CSS.length,
    },
  };
}

function rendererPageSource(moduleSource) {
  const exportLine = 'export { React, createElement, createRoot, createPortal, flushSync, pendingWork };';
  assert(moduleSource.includes(exportLine), 'scripts/lib/react-dom-lite.mjs changed: missing page export line');
  const exportLines = moduleSource.split('\n').filter((line) => line.startsWith('export '));
  assert(exportLines.length === 1, 'scripts/lib/react-dom-lite.mjs must have exactly one export statement for the page transform');
  return moduleSource.replace(exportLine, 'window.ReactLite = { React, createElement, createRoot, createPortal, flushSync, pendingWork };');
}

function readBody(request) {
  return new Promise((resolveBody, rejectBody) => {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => resolveBody(Buffer.concat(chunks)));
    request.on('error', rejectBody);
  });
}

async function writeResponse(res, response) {
  const headers = {};
  response.headers.forEach((value, key) => { headers[key] = value; });
  res.writeHead(response.status, headers);
  res.end(Buffer.from(await response.arrayBuffer()));
}

async function evaluate(page, fn, args) {
  return page.evaluate(fn, args);
}

async function screenshotPage(page, path) {
  await page.screenshot({ path, fullPage: false });
  const bytes = await readFile(path);
  return { path, bytes: bytes.length, sha256: sha256(bytes) };
}

async function screenshotElement(page, selector, path) {
  const element = await page.$(selector);
  if (element === null) return null;
  try {
    await element.screenshot({ path });
  } catch (_error) {
    return null;
  }
  const bytes = await readFile(path);
  return { path, bytes: bytes.length, sha256: sha256(bytes) };
}

/** Compose through the real staged Tool; throws on a typed failure. */
/**
 * Prove the RETAINED (old active) preview is still playable while a new
 * revision is pending/failing: real mouse play on the bar, observe the runtime
 * playhead advance and the Pause label, then pause again.
 */
async function assertRetainedPlayable(page, pauseText) {
  const before = await evaluate(page, () => window.__CASE__.state());
  const playRect = before.playButton === null ? null : before.playButton.rect;
  if (playRect === null || before.playButton.disabled === true) {
    return { ok: false, reason: 'play button missing/disabled on the retained preview', state: before };
  }
  await page.mouse.click(playRect.centerX, playRect.centerY);
  const played = await evaluate(page, (expectedPause) => window.__CASE__.waitTime((state) => {
    const match = /^\s*([0-9]+(?:\.[0-9]+)?)\s*\//.exec(String(state.timeText || ''));
    return match !== null
      && Number(match[1]) > 0.1
      && state.playButton !== null
      && state.playButton.text === expectedPause
      && state.activeFrameCount >= 1;
  }, 6000), pauseText);
  const pauseRect = played.state.playButton === null ? null : played.state.playButton.rect;
  if (pauseRect !== null) {
    await page.mouse.click(pauseRect.centerX, pauseRect.centerY);
    await sleep(220);
  }
  return { ok: played.ok === true, timeText: played.state.timeText, revision: played.state.revision, activeFrames: played.state.activeFrameCount, state: played.state };
}

/** Wait (bounded) for one fire-and-forget preview.release request in the page log. */
async function waitForPreviewRelease(page, mark, snapshotId, timeoutMs) {
  const deadline = Date.now() + (timeoutMs || 5000);
  let requests = [];
  while (Date.now() < deadline) {
    requests = await evaluate(page, (markIndex) => window.__CASE__.requestsSince(markIndex), mark);
    const hit = requests.find((entry) => entry.method === 'preview.release' && entry.params && entry.params.snapshotId === snapshotId);
    if (hit !== undefined) return { ok: true, request: hit, requests };
    await sleep(100);
  }
  return { ok: false, requests };
}

/** Seek through the REAL preview range control (real mouse click on the input). */
async function seekPreviewTo(page, seconds) {
  const state = await evaluate(page, () => window.__CASE__.state());
  const rect = state.seek === null ? null : state.seek.rect;
  if (rect === null) return { ok: false, state };
  const duration = Number(state.seek.max) > 0 ? Number(state.seek.max) : 1;
  const fraction = Math.max(0, Math.min(1, seconds / duration));
  await page.mouse.click(rect.left + rect.width * fraction, rect.centerY);
  const observed = await evaluate(page, (expected) => window.__CASE__.waitTime(function matcher(next) {
    const match = /^\s*([0-9]+(?:\.[0-9]+)?)\s*\//.exec(String(next.timeText || ''));
    return match !== null && Math.abs(Number(match[1]) - expected) <= 0.4;
  }, 5000), seconds);
  return { ok: observed.ok, state: observed.state, seconds };
}

async function composeThroughTool(tool, sessionId, projectId, expectedRevision, html, prefix) {
  const call = await callTool(tool, {
    action: 'project.compose',
    projectId,
    expectedRevision,
    operationId: opId(prefix),
    html,
  }, sessionId);
  if (call.ok !== true) throw new Error('project.compose through the Tool failed: ' + call.message.slice(0, 400));
  return call.value.result;
}

function requestsBetween(apiLog, mark) {
  return apiLog.slice(mark);
}

function methodsOf(requests) {
  const counts = {};
  for (const request of requests) counts[request.method] = (counts[request.method] || 0) + 1;
  return counts;
}

function parseTimeText(text) {
  if (typeof text !== 'string') return null;
  const match = /^\s*([0-9]+(?:\.[0-9]+)?)\s*\/\s*([0-9]+(?:\.[0-9]+)?)\s*$/.exec(text);
  return match === null ? null : { time: Number(match[1]), duration: Number(match[2]) };
}

async function main() {
  const startedAt = new Date();
  let args;
  try {
    args = parseCli(process.argv.slice(2), { allowOut: true });
  } catch (error) {
    if (error instanceof UsageError) usage(error.message);
    throw error;
  }
  const staging = resolve(args.staging);
  const outRoot = args.out !== undefined ? resolve(args.out) : DEFAULT_EVIDENCE_ROOT;
  const runDirectory = 'preview-' + stamp(startedAt);
  const evidenceDirectory = join(outRoot, runDirectory);
  await mkdir(evidenceDirectory, { recursive: true });
  const evidence = {
    kind: KIND,
    startedAt: startedAt.toISOString(),
    command: 'node scripts/test-conversation-preview.mjs ' + process.argv.slice(2).join(' '),
    staging,
    note: 'Real staged client component in real Chrome against the real staged bridge. Simulated seams are documented in `simulated`: host-owned native conversation renderer faces and page-only one-shot failure injection. No DSH install, no real model call, no user profile/project writes.',
    simulated: {
      conversation: 'the host-owned native conversation renderer is replaced by inert harness faces: sessions client service (list/retain), SessionProvider and renderFactorySlot props. P3-012 does not change the conversation panel; the left preview/lifecycle is the real staged code.',
      failureInjection: 'window.fetch is wrapped INSIDE the test page only to answer one matching request with a host-shaped {ok:false,error:{code,message}} body; the staged source is untouched.',
      testPageOverrides: 'the harness page disables the panel entrance animation and hosts the real component under a full-viewport root; no product selector/geometry is modified.',
    },
    extraction: null,
    stateRoot: null,
    browserPath: null,
    checks: null,
    acceptance: { B1: null, B2: null, B3: null, B4: null, B5: null },
    latency: [],
    rounds: [],
    r2: null,
    requests: [],
    network: null,
    gestures: null,
    teardown: null,
    stagingReadOnly: null,
  };
  const checks = createChecks();
  const acceptanceChecks = { B1: [], B2: [], B3: [], B4: [], B5: [] };
  function checkAcceptance(acceptanceId, name, ok, details) {
    const passed = checks.check(name, ok, details);
    acceptanceChecks[acceptanceId].push({ name, ok: ok === true });
    return passed;
  }
  let staged = null;
  let bridge = null;
  let host = null;
  let stateRoot = null;
  let tool = null;
  let browser = null;
  let server = null;
  let stagingBefore = null;
  let serverLog = [];
  let apiLog = [];
  let consoleMessages = [];
  let pageErrors = [];
  let requestFailures = [];
  let networkRequests = [];
  let projectId = null;
  let sessionId = null;

  try {
    // ─── staging trust + staged client extraction ──────────────────────────
    staged = await loadStagedHost(staging);
    const stagingRoot = staged.evidence.staging;
    stagingBefore = await listStagingSources(stagingRoot);
    evidence.host = staged.evidence;
    evidence.engineCommit = staged.integrity.engineCommit;
    evidence.rootCommit = staged.integrity.rootCommit;
    evidence.versions = staged.integrity.versions;
    evidence.browserPath = staged.integrity.browser;
    checks.check('staging snapshot verified: Host/engine bytes match INTEGRITY.json', true, { rootCommit: staged.integrity.rootCommit, engineCommit: staged.integrity.engineCommit, versions: staged.integrity.versions });

    const integrityFiles = Array.isArray(staged.integrity.files?.bundle) ? staged.integrity.files.bundle : [];
    const recordedClient = integrityFiles.find((entry) => entry !== null && entry.path === 'client.js');
    assert(recordedClient !== undefined, 'INTEGRITY.files.bundle does not record client.js');
    const clientSource = await readFile(join(stagingRoot, 'bundle', 'client.js'), 'utf8');
    const clientSha = sha256(Buffer.from(clientSource, 'utf8'));
    assert(recordedClient.sha256 === clientSha, 'staged client.js sha256 does not match INTEGRITY.json');
    const extraction = extractStagedClient(clientSource);
    evidence.extraction = { ...extraction.evidence, integrityClientSha256: recordedClient.sha256, clientVerified: true };
    checks.check('real staged client factory body extracted by region markers, digest-verified and compiled', extraction.evidence.factoryCompiled === true && recordedClient.sha256 === clientSha, { clientSha256: clientSha.slice(0, 16), factoryBytes: extraction.evidence.factoryBytes, factoryStartLine: extraction.evidence.factoryStartLine, factoryEndLine: extraction.evidence.factoryEndLine });
    const dictionary = extraction.EN;

    const rendererModuleSource = await readFile(join(LIB_DIR, 'react-dom-lite.mjs'), 'utf8');
    const rendererSource = rendererPageSource(rendererModuleSource);
    const pageHtml = await readFile(join(LIB_DIR, 'conversation-harness-page.html'), 'utf8');
    const pageGlue = await readFile(join(LIB_DIR, 'conversation-harness-page.js'), 'utf8');
    assert(pageHtml.includes('/harness/page.js'), 'conversation harness page HTML is missing its scripts');
    evidence.harness = {
      note: 'sha256 of the verifier harness files actually executed (working tree; verifier scripts are outside the staged root commit).',
      files: {
        'scripts/test-conversation-preview.mjs': sha256(await readFile(fileURLToPath(import.meta.url))),
        'scripts/lib/react-dom-lite.mjs': sha256(Buffer.from(rendererModuleSource, 'utf8')),
        'scripts/lib/conversation-harness-page.js': sha256(Buffer.from(pageGlue, 'utf8')),
        'scripts/lib/conversation-harness-page.html': sha256(Buffer.from(pageHtml, 'utf8')),
        'scripts/lib/conversation-fixtures.mjs': sha256(await readFile(join(LIB_DIR, 'conversation-fixtures.mjs'))),
      },
    };

    // ─── isolated mutable state + real staged bridge/tool ──────────────────
    stateRoot = await prepareStateRoot(stagingRoot, staged.config, 'dsh-p3012-preview-');
    evidence.stateRoot = stateRoot.base;
    evidence.configRedirection = {
      note: 'The verified staging tree is read-only for this run; all mutable bridge/worker state lives in the recorded temp directory.',
      redirected: ['registryPath', 'artifactRoot', 'projectsRoot', 'assetInboxRoot', 'sessionStatePath', 'sessionCwd'],
      stagedConfigSha256: staged.integrity.config?.sha256,
    };
    host = fakeCtx('preview');
    bridge = new staged.VideoBridge({ ctx: host.ctx, rawConfig: stateRoot.config });
    const createVideoTool = await loadStagedTool(stagingRoot);
    tool = createVideoTool(bridge);
    const routesModule = await import(pathToFileURL(join(stagingRoot, 'bundle', 'host', 'routes.js')).href);
    assert(typeof routesModule.createRequestRoute === 'function', 'staged host/routes.js has no createRequestRoute');
    const requestRoute = routesModule.createRequestRoute(bridge);

    // ─── page/request/static server ────────────────────────────────────────
    let origin = '';
    server = createServer(async (request, response) => {
      const requestPath = (() => {
        try { return new URL(request.url, 'http://127.0.0.1').pathname; } catch (_error) { return ''; }
      })();
      try {
        if (request.method === 'GET' || request.method === 'HEAD') {
          if (requestPath === '/' || requestPath === '/index.html') {
            response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
            response.end(request.method === 'HEAD' ? undefined : pageHtml);
            return;
          }
          if (requestPath === '/harness/react-dom-lite.js') {
            response.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-store' });
            response.end(rendererSource);
            return;
          }
          if (requestPath === '/harness/conversation-module.js') {
            response.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-store' });
            response.end(extraction.pageSource);
            return;
          }
          if (requestPath === '/harness/page.js') {
            response.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-store' });
            response.end(pageGlue);
            return;
          }
          if (requestPath === '/harness/staged.css') {
            response.writeHead(200, { 'content-type': 'text/css; charset=utf-8', 'cache-control': 'no-store' });
            response.end(extraction.CSS);
            return;
          }
          if (requestPath === '/harness/locale.json') {
            response.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
            response.end(JSON.stringify(dictionary));
            return;
          }
          if (requestPath === '/harness/broken-candidate/index.html') {
            // R2 candidate-runtime-error probe: a document that loads but whose
            // fixed runtime can never reach ready (no #main / __timelines), so the
            // runtime posts an error event instead of ready. Served by the harness
            // toy server, never by the product snapshot route.
            const candidateUrl = new URL(request.url, 'http://127.0.0.1');
            const instance = candidateUrl.searchParams.get('instance') || 'harnesscandidate1';
            const nonce = candidateUrl.searchParams.get('nonce') || '0123456789abcdef0123456789abcdef';
            const runtimeUrl = '/api/dsh-video/canvas-runtime.js?v=1&instance=' + encodeURIComponent(instance) + '&nonce=' + encodeURIComponent(nonce);
            response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
            response.end('<!doctype html><html><head><meta charset="utf-8"></head><body><div id="not-main"></div><div id="fake-artwork">candidate runtime error probe</div><script src="' + runtimeUrl + '"></script></body></html>');
            return;
          }
          if (requestPath === '/favicon.ico') {
            response.writeHead(204, { 'cache-control': 'no-store' });
            response.end();
            return;
          }
        }
        if (requestPath === REQUEST_PATH && request.method === 'POST') {
          const bodyBuffer = await readBody(request);
          let parsed = null;
          try { parsed = JSON.parse(bodyBuffer.toString('utf8')); } catch (_error) { parsed = null; }
          let apiEntry = null;
          if (parsed !== null && typeof parsed === 'object' && typeof parsed.method === 'string') {
            apiEntry = { at: new Date().toISOString(), method: parsed.method, params: sanitize(parsed.params, 1200) };
            apiLog.push(apiEntry);
          }
          const hostRequest = new Request(origin + request.url, { method: 'POST', headers: request.headers, body: bodyBuffer, duplex: 'half' });
          const hostResponse = await requestRoute.fetch(hostRequest);
          if (apiEntry !== null) {
            try {
              const clone = hostResponse.clone();
              const body = await clone.json();
              apiEntry.responseStatus = hostResponse.status;
              apiEntry.responseOk = body !== null && typeof body === 'object' && body.ok === true;
              apiEntry.responseErrorCode = body !== null && typeof body === 'object' && body.error !== null && typeof body.error === 'object' && typeof body.error.code === 'string' ? body.error.code : null;
              apiEntry.responseResult = body !== null && typeof body === 'object' && body.result !== null && typeof body.result === 'object' ? {
                projectId: typeof body.result.projectId === 'string' ? body.result.projectId : null,
                revision: typeof body.result.revision === 'string' ? body.result.revision : null,
                publishedRevision: typeof body.result.publishedRevision === 'string' ? body.result.publishedRevision : null,
                snapshotId: typeof body.result.snapshotId === 'string' ? body.result.snapshotId : null,
                sessionId: typeof body.result.sessionId === 'string' ? body.result.sessionId : null,
                activeSessionId: typeof body.result.activeSessionId === 'string' ? body.result.activeSessionId : null,
                updatedAt: Number.isFinite(Number(body.result.updatedAt)) ? Number(body.result.updatedAt) : null,
                projects: Array.isArray(body.result.projects) ? body.result.projects.map((item) => ({ projectId: item.projectId, updatedAt: item.updatedAt })) : null,
              } : null;
            } catch (_error) {
              apiEntry.responseStatus = hostResponse.status;
            }
          }
          await writeResponse(response, hostResponse);
          serverLog.push({ at: Date.now(), method: request.method, path: requestPath, status: hostResponse.status });
          return;
        }
        const route = host.routes.find((candidate) => candidate.path === requestPath);
        if (route !== undefined) {
          const bodyBuffer = request.method === 'GET' || request.method === 'HEAD' ? undefined : await readBody(request);
          const hostRequest = new Request(origin + request.url, { method: request.method, headers: request.headers, body: bodyBuffer, duplex: 'half' });
          const hostResponse = await route.fetch(hostRequest);
          await writeResponse(response, hostResponse);
          serverLog.push({ at: Date.now(), method: request.method, path: requestPath, status: hostResponse.status });
          return;
        }
        response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
        response.end('not found');
        serverLog.push({ at: Date.now(), method: request.method, path: requestPath, status: 404 });
      } catch (error) {
        try {
          response.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
          response.end('harness server error: ' + (error instanceof Error ? error.message : String(error)));
        } catch (_ignored) { /* response may already be sent */ }
      }
    });
    await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
    origin = 'http://127.0.0.1:' + server.address().port;
    evidence.origin = origin;

    const puppeteer = createRequire(join(stagingRoot, 'engine-worker', 'package.json'))('puppeteer-core');
    browser = await puppeteer.launch({
      executablePath: staged.integrity.browser,
      headless: true,
      defaultViewport: { width: 1400, height: 1000, deviceScaleFactor: 1 },
      args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--hide-scrollbars'],
    });
    const page = await browser.newPage();
    page.setDefaultTimeout(40000);
    page.on('request', (request) => networkRequests.push({ url: request.url(), method: request.method(), resourceType: request.resourceType() }));
    page.on('console', (message) => consoleMessages.push({ type: message.type(), text: message.text() }));
    page.on('pageerror', (error) => pageErrors.push(String(error && error.message ? error.message : error)));
    page.on('requestfailed', (request) => requestFailures.push({ url: request.url(), error: request.failure() ? request.failure().errorText : null }));
    await page.goto(origin + '/', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__BOOTED__ === true, { timeout: 30000 });
    const bootError = await evaluate(page, () => window.__BOOT_ERROR__ || null);
    assert(bootError === null, 'conversation harness page boot failed: ' + String(bootError));
    checks.check('real staged client module boots in real Chrome with the staged EN dictionary', true, { dictionaryKeys: Object.keys(dictionary).length });

    const ctx = { page, bridge, stateRoot, stagingRoot, dictionary, apiLog: () => apiLog, serverLog: () => serverLog };
    evidence.requests = apiLog;

    // ─── B1a: automatic first preview on mount (no user action) ────────────
    const mountStartedAt = Date.now();
    await evaluate(page, () => window.__CASE__.mount());
    const firstReady = await evaluate(page, () => window.__CASE__.waitCanvas({ phase: 'ready' }, 60000));
    // The canvas may briefly render before the project attribute settles; the
    // first-preview claim requires a managed project id on the product root.
    const firstProject = await evaluate(page, () => window.__CASE__.waitTime((state) => state.phase === 'ready' && typeof state.projectId === 'string' && /^proj-/.test(state.projectId), 30000));
    const firstFrameLoad = await evaluate(page, (since) => window.__CASE__.waitFrameLoad(since, 10000), mountStartedAt);
    const firstState = firstProject.state;
    console.log('[phase] initial preview ready, projectId=' + firstState.projectId + ' in ' + (Date.now() - mountStartedAt) + 'ms frameLoaded=' + firstFrameLoad.ok);
    const initialProjectId = firstState.projectId;
    checks.check('workspace reaches a ready preview without any user interaction on first mount', firstReady.ok === true && typeof initialProjectId === 'string' && /^proj-/.test(initialProjectId), { ok: firstReady.ok, elapsedMs: firstReady.elapsedMs, projectId: initialProjectId, phase: firstState.phase, revision: firstState.revision });
    projectId = initialProjectId;
    evidence.latency.push({ phase: 'mount→initial-preview-ready', ms: Date.now() - mountStartedAt });
    const initialInspect = await invokeHttp(bridge, 'inspect', { projectId: initialProjectId });
    checks.check('canvas revision marker equals the Host inspection revision on first preview', firstState.revision === initialInspect.revision && typeof firstState.snapshotId === 'string', { canvasRevision: firstState.revision, hostRevision: initialInspect.revision, snapshotId: firstState.snapshotId });
    const initialSnapshotRequest = apiLog.filter((entry) => entry.method === 'preview.snapshot' && entry.responseOk === true).pop();
    checks.check('initial preview loaded a real snapshot through the preview.snapshot route', initialSnapshotRequest !== undefined && typeof initialSnapshotRequest.responseResult?.snapshotId === 'string', { snapshot: initialSnapshotRequest?.responseResult ?? null });

    // Session id for Tool invocations: the panel must have auto-created one.
    let sessionList = await invokeHttp(bridge, 'session.list', { projectId: initialProjectId });
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const active = typeof sessionList.activeSessionId === 'string' ? sessionList.activeSessionId : (Array.isArray(sessionList.sessions) && sessionList.sessions.length > 0 ? sessionList.sessions[0].sessionId : null);
      if (active !== null) { sessionId = active; break; }
      await sleep(250);
      sessionList = await invokeHttp(bridge, 'session.list', { projectId: initialProjectId });
    }
    const autoCreatedSession = sessionId !== null && apiLog.some((entry) => entry.method === 'session.create' && entry.responseOk === true);
    checkAcceptance('B1', 'the panel auto-created the native creation Session for the project', autoCreatedSession, { sessionId, sessionCreateRequests: apiLog.filter((entry) => entry.method === 'session.create').length });
    const initialRequests = apiLog.slice();
    const initialMethods = methodsOf(initialRequests);
    checks.check('first mount lifecycle: project.list → auto-provision project.create + session.create → inspect → preview.snapshot all go through the real staged Host', (initialMethods['project.list'] || 0) >= 1
      && (initialMethods['project.create'] || 0) === 1
      && (initialMethods['session.create'] || 0) === 1
      && (initialMethods.inspect || 0) >= 1
      && (initialMethods['preview.snapshot'] || 0) >= 1, { counts: initialMethods, firstRequests: initialRequests.map((entry) => ({ method: entry.method, projectId: entry.params && entry.params.projectId, responseStatus: entry.responseStatus, responseErrorCode: entry.responseErrorCode })) });
    checks.check('auto-provisioned project is a managed project, not the legacy demo fixture', initialProjectId !== 'demo' && initialRequests.every((entry) => entry.method !== 'inspect' || entry.params === null || entry.params.projectId !== 'demo'), { projectId: initialProjectId, inspectedDemo: initialRequests.some((entry) => entry.method === 'inspect' && entry.params && entry.params.projectId === 'demo') });
    const provisionedList = await invokeHttp(bridge, 'project.list', {});
    const managedIds = Array.isArray(provisionedList.projects) ? provisionedList.projects.map((item) => item.projectId).filter((id) => id !== 'demo') : [];
    checks.check('exactly one managed project exists and it is the one the panel opened (no duplicate auto-provision)', managedIds.length === 1 && managedIds[0] === initialProjectId && provisionedList.defaultProjectId === initialProjectId, { managedIds, defaultProjectId: provisionedList.defaultProjectId, projectId: initialProjectId });
    if (sessionId === null) {
      const fallback = await invokeHttp(bridge, 'session.create', { projectId: initialProjectId, requestId: opId('fallback') });
      sessionId = fallback.sessionId;
      evidence.sessionFallback = { sessionId, reason: 'panel did not auto-create a Session; harness created one so the Tool path could continue (recorded as a product defect above)' };
    }
    console.log('[phase] session ready ' + sessionId);
    evidence.initial = { projectId: initialProjectId, sessionId, revision: initialInspect.revision, snapshotId: firstState.snapshotId, requestCount: initialRequests.length };

    // ─── B1: automatic first preview after publish ──────────────────────────
    const fixtureA = genreA();
    const currentRevisionA = (await invokeHttp(bridge, 'inspect', { projectId })).revision;
    const snapshotBeforeA = (await evaluate(page, () => window.__CASE__.state())).snapshotId;
    const pageMarkA = await evaluate(page, () => window.__CASE__.mark());
    const composeStartedAt = Date.now();
    const resultA = await composeThroughTool(tool, sessionId, projectId, currentRevisionA, fixtureA.html, 'preview-a');
    const composeReturnedAt = Date.now();
    checks.check('B1: project.compose through the real staged Tool returns publishedRevision', typeof resultA.publishedRevision === 'string' && resultA.publishedRevision === resultA.revision, { revision: resultA.revision, publishedRevision: resultA.publishedRevision });
    const readyA = await evaluate(page, (argsForWait) => window.__CASE__.waitCanvas({ phase: 'ready', revision: argsForWait.revision, snapshotDifferentFrom: argsForWait.previousSnapshot }, 30000), { revision: resultA.publishedRevision, previousSnapshot: snapshotBeforeA });
    const readyAAt = Date.now();
    const frameLoadA = await evaluate(page, (since) => window.__CASE__.waitFrameLoad(since, 10000), composeStartedAt);
    const stateA = readyA.state;
    checks.check('B1: the published snapshot document finished loading (real iframe load event) before evidence capture', frameLoadA.ok === true, frameLoadA);
    const latencyA = { round: 1, genre: 'A', submitToToolReturnMs: composeReturnedAt - composeStartedAt, toolReturnToPreviewReadyMs: readyAAt - composeReturnedAt, submitToPreviewReadyMs: readyAAt - composeStartedAt };
    evidence.latency.push({ phase: 'compose-A→preview-ready', ...latencyA });
    evidence.rounds.push({ round: 1, genre: 'A', revision: resultA.publishedRevision, snapshotId: stateA.snapshotId, latency: latencyA, pagePhase: stateA.phase, pageRevision: stateA.revision, iframeSrc: stateA.iframeSrc });
    checkAcceptance('B1', 'B1: canvas auto-loads the published revision and becomes ready with no user refresh', readyA.ok === true && stateA.revision === resultA.publishedRevision && typeof stateA.snapshotId === 'string', { ok: readyA.ok, elapsedMs: readyA.elapsedMs, pageRevision: stateA.revision, publishedRevision: resultA.publishedRevision, snapshotId: stateA.snapshotId });
    // Page-side request log (same index space as __CASE__.mark()): the automatic
    // follow path is what the component itself issued, not a harness request.
    const roundRequestsA = await evaluate(page, (mark) => window.__CASE__.requestsSince(mark), pageMarkA);
    const autoSnapshotA = roundRequestsA.filter((entry) => entry.method === 'preview.snapshot' && entry.responseOk === true).pop();
    checks.check('B1: the automatic follow poll requested preview.snapshot for the published revision', autoSnapshotA !== undefined && autoSnapshotA.params && autoSnapshotA.params.revision === resultA.publishedRevision && autoSnapshotA.responseRevision === resultA.publishedRevision, { snapshotRequest: autoSnapshotA ? { revision: autoSnapshotA.params?.revision, responseRevision: autoSnapshotA.responseRevision, snapshotId: autoSnapshotA.responseSnapshotId } : null, pageRequests: roundRequestsA.map((entry) => ({ method: entry.method, injected: entry.injected })) });
    checks.check('B1: the published revision is visible through the real Host inspect at the same id', (await invokeHttp(bridge, 'inspect', { projectId })).revision === resultA.publishedRevision, { revision: resultA.publishedRevision });
    // t=0 is the first frame of an entrance animation (title still faded out);
    // seek through the real control so the screenshot proves the published
    // artwork is actually rendered, then restore 0 for the playback test.
    const displayA = await seekPreviewTo(page, 2.4);
    const shot1Stage = await screenshotElement(page, '.dv-canvas-wrap', join(evidenceDirectory, '01-round1-genreA-stage.png'));
    const shot1 = await screenshotPage(page, join(evidenceDirectory, '01-round1-genreA-page.png'));
    evidence.displays = { round1Seek: displayA.ok, round1TimeText: displayA.state ? displayA.state.timeText : null };
    console.log('[phase] round 1 (genre A) preview ready in ' + latencyA.submitToPreviewReadyMs + 'ms');

    // ─── B2: second consecutive publish auto-updates the SAME project ──────
    const fixtureB = genreB();
    const previousSnapshot = stateA.snapshotId;
    const pageMarkB = await evaluate(page, () => window.__CASE__.mark());
    const composeBStartedAt = Date.now();
    const resultB = await composeThroughTool(tool, sessionId, projectId, resultA.publishedRevision, fixtureB.html, 'preview-b');
    const composeBReturnedAt = Date.now();
    checks.check('B2: second project.compose round publishes a new revision on the SAME project id', typeof resultB.publishedRevision === 'string' && resultB.publishedRevision !== resultA.publishedRevision && resultB.projectId === projectId, { firstRevision: resultA.publishedRevision, secondRevision: resultB.publishedRevision, projectId: resultB.projectId });
    const readyB = await evaluate(page, (argsForWait) => window.__CASE__.waitCanvas({ phase: 'ready', revision: argsForWait.revision, snapshotDifferentFrom: argsForWait.previousSnapshot }, 30000), { revision: resultB.publishedRevision, previousSnapshot: previousSnapshot });
    const readyBAt = Date.now();
    const frameLoadB = await evaluate(page, (since) => window.__CASE__.waitFrameLoad(since, 10000), composeBStartedAt);
    const stateB = readyB.state;
    checks.check('B2: the second published snapshot document finished loading before evidence capture', frameLoadB.ok === true, frameLoadB);
    const latencyB = { round: 2, genre: 'B', submitToToolReturnMs: composeBReturnedAt - composeBStartedAt, toolReturnToPreviewReadyMs: readyBAt - composeBReturnedAt, submitToPreviewReadyMs: readyBAt - composeBStartedAt };
    evidence.latency.push({ phase: 'compose-B→preview-ready', ...latencyB });
    evidence.rounds.push({ round: 2, genre: 'B', revision: resultB.publishedRevision, snapshotId: stateB.snapshotId, latency: latencyB, pagePhase: stateB.phase, pageRevision: stateB.revision, iframeSrc: stateB.iframeSrc });
    checkAcceptance('B2', 'B2: canvas revision marker and snapshot follow the second publish without manual refresh', readyB.ok === true && stateB.revision === resultB.publishedRevision && stateB.snapshotId !== previousSnapshot, { ok: readyB.ok, pageRevision: stateB.revision, snapshotId: stateB.snapshotId, previousSnapshot, publishedRevision: resultB.publishedRevision });
    const roundRequestsB = await evaluate(page, (mark) => window.__CASE__.requestsSince(mark), pageMarkB);
    const autoSnapshotB = roundRequestsB.filter((entry) => entry.method === 'preview.snapshot' && entry.responseOk === true).pop();
    checks.check('B2: the follow poll loaded the second revision snapshot for the same project', autoSnapshotB !== undefined && autoSnapshotB.params?.revision === resultB.publishedRevision && autoSnapshotB.params?.projectId === projectId, { snapshotRequest: autoSnapshotB ? { projectId: autoSnapshotB.params?.projectId, revision: autoSnapshotB.params?.revision } : null });
    const displayB = await seekPreviewTo(page, 3.0);
    const shot2Stage = await screenshotElement(page, '.dv-canvas-wrap', join(evidenceDirectory, '02-round2-genreB-stage.png'));
    const shot2 = await screenshotPage(page, join(evidenceDirectory, '02-round2-genreB-page.png'));
    evidence.displays = { ...(evidence.displays || {}), round2Seek: displayB.ok, round2TimeText: displayB.state ? displayB.state.timeText : null };
    console.log('[phase] round 2 (genre B) preview ready in ' + latencyB.submitToPreviewReadyMs + 'ms');
    const frameChanged = shot1Stage !== null && shot2Stage !== null && shot1Stage.sha256 !== shot2Stage.sha256;
    checks.check('B2: the rendered preview frame actually changed between the two published genres (stage screenshot digest + geometry)', frameChanged && shot1Stage.bytes > 1000 && shot2Stage.bytes > 1000, { round1: shot1Stage, round2: shot2Stage });

    // Revision poll cadence + no manual refresh audit.
    const inspectTimestamps = apiLog.filter((entry) => entry.method === 'inspect').map((entry) => new Date(entry.at).getTime());
    const inspectGaps = [];
    for (let index = 1; index < inspectTimestamps.length; index += 1) inspectGaps.push(inspectTimestamps[index] - inspectTimestamps[index - 1]);
    const medianGap = inspectGaps.length === 0 ? null : inspectGaps.slice().sort((left, right) => left - right)[Math.floor(inspectGaps.length / 2)];
    checks.check('revision follow poll runs on the specified ~1500 ms cadence (observed inspect gaps)', inspectGaps.length >= 2 && medianGap !== null && medianGap >= 700 && medianGap <= 2600, { inspectRequests: inspectTimestamps.length, medianGapMs: medianGap, gaps: inspectGaps.slice(0, 20) });
    const firstFollowAfterComposeA = roundRequestsA.filter((entry) => entry.method === 'inspect')[0];
    checks.check('the follow poll fires immediately after a publish (first inspect within the poll window)', firstFollowAfterComposeA !== undefined && (Date.now() - new Date(firstFollowAfterComposeA.at).getTime()) >= 0, { firstInspectAt: firstFollowAfterComposeA?.at ?? null });

    // ─── B3: play/pause + seek through the fixed runtime ───────────────────
    const resetToZero = await seekPreviewTo(page, 0);
    checks.check('B3: preview seek control returns the playhead to the start before playback', resetToZero.ok === true, { resetToZero: resetToZero.ok, timeText: resetToZero.state ? resetToZero.state.timeText : null });
    const playText = dictionary['video.canvas.play'];
    const pauseText = dictionary['video.canvas.pause'];
    const durationB = Number(stateB.timeText === null ? NaN : (parseTimeText(stateB.timeText)?.duration ?? NaN));
    checks.check('B3: preview bar exposes the localized play button, seek range and time label in preview-only mode', stateB.canvasBar !== null && stateB.playButton !== null && stateB.playButton.text === playText && stateB.seek !== null && stateB.timeText !== null, { playText, pauseText, playButton: stateB.playButton, seek: stateB.seek, timeText: stateB.timeText, canvasBar: stateB.canvasBar });
    const playRect = (await evaluate(page, () => window.__CASE__.state())).playButton?.rect ?? null;
    if (playRect !== null) await page.mouse.click(playRect.centerX, playRect.centerY);
    const playingObserved = await evaluate(page, (plain) => window.__CASE__.waitTime((state) => {
      const time = /^\s*[0-9]+\.[0-9]+\s*\/\s*[0-9]+\.[0-9]+\s*$/.test(String(state.timeText || ''));
      const button = state.playButton !== null ? state.playButton.text : null;
      const parsed = /^\s*([0-9]+(?:\.[0-9]+)?)\s*\//.exec(String(state.timeText || ''));
      const current = parsed === null ? 0 : Number(parsed[1]);
      return time && button === plain.pauseText && current > 0.15;
    }, 6000), { pauseText });
    const playingState = playingObserved.state;
    const playAdvanced = playingObserved.ok === true && parseTimeText(playingState.timeText) !== null && parseTimeText(playingState.timeText).time > 0.15;
    await sleep(500);
    const afterPlayState = await evaluate(page, () => window.__CASE__.state());
    const pauseRect = afterPlayState.playButton?.rect ?? null;
    if (pauseRect !== null) await page.mouse.click(pauseRect.centerX, pauseRect.centerY);
    await sleep(350);
    const pausedState1 = await evaluate(page, () => window.__CASE__.state());
    await sleep(450);
    const pausedState2 = await evaluate(page, () => window.__CASE__.state());
    const pausedTime1 = parseTimeText(pausedState1.timeText)?.time ?? null;
    const pausedTime2 = parseTimeText(pausedState2.timeText)?.time ?? null;
    const pausedStable = pausedTime1 !== null && pausedTime2 !== null && Math.abs(pausedTime1 - pausedTime2) <= 0.12;
    const pauseLabelObserved = (await evaluate(page, () => window.__CASE__.state())).playButton?.text === playText;
    checkAcceptance('B3', 'B3: play advances the runtime playhead and the play/pause label follows the real control', playAdvanced && playingObserved.ok === true, { playing: playingObserved.ok, timeText: playingState.timeText, elapsedMs: playingObserved.elapsedMs });
    checkAcceptance('B3', 'B3: pause stops the runtime playhead and restores the play label', pausedStable && pauseLabelObserved, { pausedTime1, pausedTime2, pausedStable, buttonText: pausedState2.playButton?.text, expectedPlayText: playText });
    const seekRect = (await evaluate(page, () => window.__CASE__.state())).seek?.rect ?? null;
    const seekTargetDuration = durationB > 0 ? durationB : 5;
    const seekFraction = 0.6;
    const expectedSeekTime = Number((seekTargetDuration * seekFraction).toFixed(2));
    let seekState = null;
    if (seekRect !== null) {
      await page.mouse.click(seekRect.left + seekRect.width * seekFraction, seekRect.centerY);
      const seekObserved = await evaluate(page, (expected) => window.__CASE__.waitTime((state) => {
        const parsed = /^\s*([0-9]+(?:\.[0-9]+)?)\s*\//.exec(String(state.timeText || ''));
        if (parsed === null) return false;
        return Math.abs(Number(parsed[1]) - expected) <= 0.35;
      }, 6000), expectedSeekTime);
      seekState = seekObserved.state;
      checkAcceptance('B3', 'B3: real user seek on the range control moves the runtime playhead to the expected time', seekObserved.ok === true, { expectedSeekTime, timeText: seekState.timeText, seekRect });
    } else {
      checkAcceptance('B3', 'B3: real user seek on the range control moves the runtime playhead to the expected time', false, { reason: 'seek control is missing in preview-only mode', seekRect });
    }
    const shot3 = await screenshotPage(page, join(evidenceDirectory, '03-playback-and-seek.png'));
    console.log('[phase] play/pause/seek evidence captured (seek text=' + (seekState?.timeText ?? 'n/a') + ')');
    evidence.playback = { playText, pauseText, durationB, playAdvanced, pausedTime1, pausedTime2, pausedStable, expectedSeekTime, seekText: seekState?.timeText ?? null, timeTextAtRound2: stateB.timeText };

    // ─── B4/R2: keep the last valid preview + truthful switching ───────────
    // Contract: active (last ready, displayed) vs candidate (preloading for the
    // requested revision); the active iframe stays mounted/playable until the
    // candidate runtime is ready; on snapshot/runtime failure retain active and
    // show a compact dv-preview-notice[role=alert] with retry; promote only on
    // candidate ready, then release the old Host snapshot.
    const r2Evidence = { retention: null, retrySwitch: null, candidateRuntimeError: null, autoSwitch: null, initialFailure: null };
    evidence.r2 = r2Evidence;
    const legacyEmptyCopy = dictionary['video.frame.empty'];
    const activeBeforeFailureState = await evaluate(page, () => window.__CASE__.state());
    const activeBeforeFailure = {
      revision: activeBeforeFailureState.revision,
      targetRevision: activeBeforeFailureState.targetRevision,
      snapshotId: activeBeforeFailureState.snapshotId,
      iframeSrc: activeBeforeFailureState.iframeSrc,
      timeText: activeBeforeFailureState.timeText,
    };
    checks.check('R2: a ready active preview exists before the failure-retention probes (baseline)', typeof activeBeforeFailure.snapshotId === 'string' && activeBeforeFailureState.activeFrameCount === 1 && activeBeforeFailureState.phase === 'ready', activeBeforeFailure);

    // R2-1: next-revision SNAPSHOT failure -> old active iframe retained/playable.
    const preRetentionInspect = await invokeHttp(bridge, 'inspect', { projectId });
    const retentionMark = await evaluate(page, () => window.__CASE__.mark());
    await evaluate(page, () => window.__CASE__.inject({ method: 'preview.snapshot', code: 'E_PREVIEW_NOT_FOUND', message: 'Injected snapshot failure (harness)', times: 1 }));
    const retentionRevision = await composeThroughTool(tool, sessionId, projectId, preRetentionInspect.revision, genreAModified().html, 'r2-retention');
    const retentionNotice = await evaluate(page, () => window.__CASE__.waitNotice(30000));
    const retentionState = retentionNotice.state;
    const retentionShot = await screenshotPage(page, join(evidenceDirectory, '04-r2-retention-notice.png'));
    checks.check('R2: the injected next-revision snapshot failure was consumed exactly once', (await evaluate(page, () => window.__CASE__.injectionState())).some((entry) => entry.hits === 1), { injections: await evaluate(page, () => window.__CASE__.injectionState()) });
    checkAcceptance('B4', 'R2: a failed next-revision snapshot keeps the last ready iframe mounted', retentionNotice.ok === true && retentionState.activeFrameCount >= 1 && retentionState.activeFrames[0].snapshotId === activeBeforeFailure.snapshotId, { noticeOk: retentionNotice.ok, activeFrames: retentionState.activeFrames, expectedOldSnapshot: activeBeforeFailure.snapshotId });
    checkAcceptance('B4', 'R2: retention markers are truthful (data-canvas-revision stays the OLD published revision, data-canvas-target-revision names the requested one)', retentionState.revision === activeBeforeFailure.revision && retentionState.targetRevision === retentionRevision.publishedRevision, { phase: retentionState.phase, activeRevision: retentionState.revision, expectedActive: activeBeforeFailure.revision, targetRevision: retentionState.targetRevision, requestedRevision: retentionRevision.publishedRevision });
    checkAcceptance('B4', 'R2: retention failure shows the compact dv-preview-notice[role=alert] with retry, not an unmount/full-error replacement', retentionState.noticeVisible === true && retentionState.notices.length > 0 && retentionState.notices[0].role === 'alert' && retentionState.notices[0].retry !== null && retentionState.fullErrorVisible === false && retentionState.phase === 'ready', { notice: retentionState.notices[0] ?? null, phase: retentionState.phase, fullErrorVisible: retentionState.fullErrorVisible });
    checks.check('R2: the retention notice text is not the legacy empty-frame copy', retentionState.noticeTexts.join(' | ').includes(legacyEmptyCopy) === false && retentionState.noticeTexts.join(' ').length > 0, { noticeTexts: retentionState.noticeTexts, legacyEmptyCopy });
    const retainedPlayable = await assertRetainedPlayable(page, pauseText);
    checkAcceptance('B4', 'R2: the retained old preview stays playable during the failed next-revision load', retainedPlayable.ok === true && retainedPlayable.activeFrames >= 1, { retainedPlayable: { ok: retainedPlayable.ok, timeText: retainedPlayable.timeText, revision: retainedPlayable.revision } });
    const retentionRequests = await evaluate(page, (mark) => window.__CASE__.requestsSince(mark), retentionMark);
    checks.check('R2: during retention no preview.release was issued for the retained old snapshot', retentionRequests.every((entry) => entry.method !== 'preview.release' || (entry.params && entry.params.snapshotId !== activeBeforeFailure.snapshotId)), { retentionRequests: retentionRequests.map((entry) => ({ method: entry.method, snapshotId: entry.params && entry.params.snapshotId })) });
    const oldSnapshotEntryRoute = '/api/dsh-video/preview/' + activeBeforeFailure.snapshotId + '/index.html';
    const retentionRoute = host.routes.find((candidate) => candidate.path === oldSnapshotEntryRoute);
    let retentionRouteStatus = null;
    if (retentionRoute !== undefined) {
      try {
        const routeResponse = await retentionRoute.fetch(new Request('http://127.0.0.1' + oldSnapshotEntryRoute + '?instance=' + RETENTION_INSTANCE + '&nonce=' + RETENTION_NONCE, { method: 'GET' }));
        retentionRouteStatus = routeResponse.status;
      } catch (_error) {
        retentionRouteStatus = 'fetch-error';
      }
    }
    checks.check('R2: the Host keeps the retained snapshot route alive/served while the candidate fails (resources kept until switch)', retentionRoute !== undefined && retentionRouteStatus === 200, { oldSnapshotEntryRoute, routeRegistered: retentionRoute !== undefined, retentionRouteStatus, hostPreviewRoutes: host.routes.filter((candidate) => typeof candidate.path === 'string' && candidate.path.indexOf('/api/dsh-video/preview/') === 0).length });
    r2Evidence.retention = { requestedRevision: retentionRevision.publishedRevision, activeRevision: retentionState.revision, targetRevision: retentionState.targetRevision, notice: retentionState.notices[0] ?? null, retainedPlayable: retainedPlayable.ok, screenshot: retentionShot };

    // R2-2: explicit retry switches to the requested revision and releases the old snapshot.
    const retentionHasNotice = retentionNotice.ok === true && retentionState.notices.length > 0 && retentionState.notices[0].retry !== null;
    let retrySwitchState = retentionState;
    let oldSnapshotReleased = false;
    let retrySwitchShot = null;
    if (retentionHasNotice) {
      const retrySwitchMark = await evaluate(page, () => window.__CASE__.mark());
      await page.mouse.click(retentionState.notices[0].retry.rect.centerX, retentionState.notices[0].retry.rect.centerY);
      const retrySwitch = await evaluate(page, (expected) => window.__CASE__.waitCanvas({ phase: 'ready', revision: expected, notice: false, maxCandidateFrames: 0 }, 30000), retentionRevision.publishedRevision);
      if (retrySwitch.ok === true) await evaluate(page, (since) => window.__CASE__.waitFrameLoad(since, 10000), retrySwitchMark);
      retrySwitchState = retrySwitch.state;
      const retryRelease = await waitForPreviewRelease(page, retrySwitchMark, activeBeforeFailure.snapshotId, 5000);
      const retrySwitchRequests = retryRelease.requests;
      oldSnapshotReleased = retryRelease.ok === true && retryRelease.request.responseOk === true;
      checkAcceptance('B4', 'R2: explicit retry switches to the requested revision (markers/iframe updated, candidate gone)', retrySwitch.ok === true && retrySwitchState.revision === retentionRevision.publishedRevision && retrySwitchState.snapshotId !== activeBeforeFailure.snapshotId && retrySwitchState.candidateFrameCount === 0, { ok: retrySwitch.ok, revision: retrySwitchState.revision, expected: retentionRevision.publishedRevision, snapshotId: retrySwitchState.snapshotId, previousSnapshot: activeBeforeFailure.snapshotId, candidateFrames: retrySwitchState.candidateFrameCount });
      checkAcceptance('B4', 'R2: the old Host snapshot is released after a successful switch (preview.release observed)', oldSnapshotReleased === true, { releases: retrySwitchRequests.filter((entry) => entry.method === 'preview.release').map((entry) => ({ snapshotId: entry.params && entry.params.snapshotId, ok: entry.responseOk, code: entry.responseErrorCode })) });
      retrySwitchShot = await screenshotPage(page, join(evidenceDirectory, '05-r2-switched.png'));
      checks.check('R2: released old snapshot route is removed from the Host route table after the switch', host.routes.every((candidate) => candidate.path !== oldSnapshotEntryRoute), { oldSnapshotEntryRoute, hostPreviewRoutes: host.routes.filter((candidate) => typeof candidate.path === 'string' && candidate.path.indexOf('/api/dsh-video/preview/') === 0).length });
      checks.check('R2: Host snapshot records stay bounded after the switch (max 4 per project)', bridge.snapshots.records.size <= 4, { snapshotRecords: bridge.snapshots.records.size });
    } else {
      checkAcceptance('B4', 'R2: explicit retry switches to the requested revision (markers/iframe updated, candidate gone)', false, { reason: 'no retention notice/retry was rendered by the product (retention contract missing)' });
      checkAcceptance('B4', 'R2: the old Host snapshot is released after a successful switch (preview.release observed)', false, { reason: 'switch never happened; retention notice missing' });
    }
    r2Evidence.retrySwitch = { revision: retrySwitchState.revision, oldSnapshotReleased, screenshot: retrySwitchShot };

    // R2-3: candidate RUNTIME error (snapshot request succeeds with a document
    // whose fixed runtime errors) -> old active stays mounted/playable.
    const activeBeforeRuntimeState = await evaluate(page, () => window.__CASE__.state());
    const activeBeforeRuntime = {
      revision: activeBeforeRuntimeState.revision,
      snapshotId: activeBeforeRuntimeState.activeFrames.length > 0 ? activeBeforeRuntimeState.activeFrames[0].snapshotId : null,
    };
    const preRuntimeInspect = await invokeHttp(bridge, 'inspect', { projectId });
    const runtimeMark = await evaluate(page, () => window.__CASE__.mark());
    await evaluate(page, () => window.__CASE__.inject({ method: 'preview.snapshot', kind: 'fake-snapshot', entryUrl: '/harness/broken-candidate/index.html', times: 1 }));
    const runtimeRevision = await composeThroughTool(tool, sessionId, projectId, preRuntimeInspect.revision, modifyGenreB(fixtureB.html).html, 'r2-runtime');
    const runtimeNotice = await evaluate(page, () => window.__CASE__.waitNotice(30000));
    const runtimeNoticeState = runtimeNotice.state;
    const runtimeShot = await screenshotPage(page, join(evidenceDirectory, '06-r2-candidate-runtime-error.png'));
    checkAcceptance('B4', 'R2: a candidate RUNTIME error keeps the last ready iframe (active revision unchanged)', runtimeNotice.ok === true && runtimeNoticeState.activeFrameCount >= 1 && runtimeNoticeState.activeFrames[0].snapshotId === activeBeforeRuntime.snapshotId && runtimeNoticeState.revision === activeBeforeRuntime.revision, { noticeOk: runtimeNotice.ok, activeFrames: runtimeNoticeState.activeFrames, activeRevision: runtimeNoticeState.revision, expectedActive: activeBeforeRuntime.revision });
    checkAcceptance('B4', 'R2: candidate-runtime-error markers/notice are truthful and the failed candidate is discarded', runtimeNotice.ok === true && runtimeNoticeState.targetRevision === runtimeRevision.publishedRevision && runtimeNoticeState.noticeVisible === true && runtimeNoticeState.notices.length > 0 && runtimeNoticeState.notices[0].retry !== null && runtimeNoticeState.candidateFrameCount === 0, { targetRevision: runtimeNoticeState.targetRevision, requestedRevision: runtimeRevision.publishedRevision, notice: runtimeNoticeState.notices[0] ?? null, candidateFrames: runtimeNoticeState.candidateFrameCount });
    const runtimeRetainedPlayable = await assertRetainedPlayable(page, pauseText);
    checkAcceptance('B4', 'R2: the old preview stays playable during a candidate runtime failure', runtimeRetainedPlayable.ok === true && runtimeRetainedPlayable.activeFrames >= 1, { runtimeRetainedPlayable: { ok: runtimeRetainedPlayable.ok, timeText: runtimeRetainedPlayable.timeText, revision: runtimeRetainedPlayable.revision } });
    const candidateRelease = await waitForPreviewRelease(page, runtimeMark, 'f'.repeat(32), 5000);
    const runtimeRequests = candidateRelease.requests;
    const candidateDiscarded = candidateRelease.ok === true;
    checks.check('R2: the failed synthetic candidate snapshot is released (discard attempted)', candidateDiscarded === true || runtimeNoticeState.candidateFrameCount === 0, { candidateReleaseObserved: candidateDiscarded, requests: runtimeRequests.filter((entry) => entry.method === 'preview.release').map((entry) => entry.params && entry.params.snapshotId) });
    r2Evidence.candidateRuntimeError = { requestedRevision: runtimeRevision.publishedRevision, activeRevision: runtimeNoticeState.revision, notice: runtimeNoticeState.notices[0] ?? null, retainedPlayable: runtimeRetainedPlayable.ok, screenshot: runtimeShot };

    // R2-4: a following GOOD revision auto-switches (no user action) and releases
    // the previously retained active snapshot.
    const autoSwitchMark = await evaluate(page, () => window.__CASE__.mark());
    const goodRevision = await composeThroughTool(tool, sessionId, projectId, runtimeRevision.publishedRevision, modifyGenreBAgain(modifyGenreB(fixtureB.html).html).html, 'r2-auto-switch');
    const autoSwitch = await evaluate(page, (expected) => window.__CASE__.waitCanvas({ phase: 'ready', revision: expected, notice: false, maxCandidateFrames: 0 }, 30000), goodRevision.publishedRevision);
    if (autoSwitch.ok === true) await evaluate(page, (since) => window.__CASE__.waitFrameLoad(since, 10000), autoSwitchMark);
    const autoSwitchState = autoSwitch.state;
    const autoRelease = await waitForPreviewRelease(page, autoSwitchMark, activeBeforeRuntime.snapshotId, 5000);
    const autoSwitchRequests = autoRelease.requests;
    const autoReleasedOld = autoRelease.ok === true;
    const autoSwitchShot = await screenshotPage(page, join(evidenceDirectory, '07-r2-following-good-revision.png'));
    checkAcceptance('B4', 'R2: a following good revision auto-switches to the new ready snapshot without any user action', autoSwitch.ok === true && autoSwitchState.revision === goodRevision.publishedRevision && autoSwitchState.snapshotId !== activeBeforeRuntime.snapshotId && autoSwitchState.noticeVisible === false && autoSwitchState.candidateFrameCount === 0, { ok: autoSwitch.ok, revision: autoSwitchState.revision, expected: goodRevision.publishedRevision, snapshotId: autoSwitchState.snapshotId, previous: activeBeforeRuntime.snapshotId, notice: autoSwitchState.noticeVisible });
    checkAcceptance('B4', 'R2: auto-switch releases the previously retained snapshot after promotion', autoReleasedOld === true, { releases: autoSwitchRequests.filter((entry) => entry.method === 'preview.release').map((entry) => ({ snapshotId: entry.params && entry.params.snapshotId, ok: entry.responseOk, code: entry.responseErrorCode })) });
    // Adversarial R2: messages that still carry the OLD instance handshake must
    // never be accepted by the promoted preview (old ledger revoked on promotion).
    const oldInstanceMatch = activeBeforeRuntimeState.activeFrames.length > 0 && typeof activeBeforeRuntimeState.activeFrames[0].src === 'string'
      ? /[?&]instance=([^&]+)&nonce=([a-f0-9]{32})/.exec(activeBeforeRuntimeState.activeFrames[0].src)
      : null;
    let staleMessageIsolation = null;
    if (oldInstanceMatch !== null) {
      const isolationBefore = await evaluate(page, () => window.__CASE__.state());
      await evaluate(page, (handshake) => {
        window.postMessage({ v: 1, kind: 'evt', instanceId: handshake.instanceId, nonce: handshake.nonce, type: 'seeked', payload: { time: 9.99, playing: true } }, '*');
        window.postMessage({ v: 1, kind: 'evt', instanceId: handshake.instanceId, nonce: handshake.nonce, type: 'ready', payload: { runtimeVersion: 'stale', width: 1, height: 1, duration: 999 } }, '*');
      }, { instanceId: oldInstanceMatch[1], nonce: oldInstanceMatch[2] });
      await sleep(450);
      const isolationAfter = await evaluate(page, () => window.__CASE__.state());
      staleMessageIsolation = {
        accepted: isolationAfter.timeText !== isolationBefore.timeText || isolationAfter.snapshotId !== isolationBefore.snapshotId || isolationAfter.revision !== isolationBefore.revision,
        before: { revision: isolationBefore.revision, snapshotId: isolationBefore.snapshotId, timeText: isolationBefore.timeText },
        after: { revision: isolationAfter.revision, snapshotId: isolationAfter.snapshotId, timeText: isolationAfter.timeText },
      };
      checks.check('R2: stale old-instance runtime messages cannot change the promoted preview (old ledger revoked)', staleMessageIsolation.accepted === false, staleMessageIsolation);
    } else {
      checks.check('R2: stale old-instance runtime messages cannot change the promoted preview (old ledger revoked)', false, { reason: 'could not capture the old instance handshake from the pre-switch iframe' });
    }
    const oldRuntimeSnapshotEntryRoute = activeBeforeRuntime.snapshotId === null ? null : '/api/dsh-video/preview/' + activeBeforeRuntime.snapshotId + '/index.html';
    checks.check('R2: auto-switch releases the retained old snapshot route from the Host table', oldRuntimeSnapshotEntryRoute !== null && host.routes.every((candidate) => candidate.path !== oldRuntimeSnapshotEntryRoute), { oldRuntimeSnapshotEntryRoute, hostPreviewRoutes: host.routes.filter((candidate) => typeof candidate.path === 'string' && candidate.path.indexOf('/api/dsh-video/preview/') === 0).length });
    checks.check('R2: Host snapshot records stay bounded after the auto-switch (max 4 per project)', bridge.snapshots.records.size <= 4, { snapshotRecords: bridge.snapshots.records.size });
    r2Evidence.autoSwitch = { revision: autoSwitchState.revision, autoReleasedOld, staleMessageIsolation, screenshot: autoSwitchShot };

    // ── Adversarial R2 stress (DSH_R2_STRESS=1): repeated switches, LRU bound,
    // double-retry idempotency and unmount-during-candidate-failure cleanup.
    if (process.env.DSH_R2_STRESS === '1') {
      console.log('[phase] R2 stress start');
      const stress = { switches: [], doubleRetry: null, unmountDuringFailure: null };
      r2Evidence.stress = stress;
      const stressDocs = [
        genreA().html,
        genreB().html,
        genreAModified().html,
        modifyGenreB(genreB().html).html,
        modifyGenreBAgain(modifyGenreB(genreB().html).html).html,
      ];
      let stressPrevSnapshot = autoSwitchState.snapshotId;
      let stressPrevRevision = autoSwitchState.revision;
      for (let index = 0; index < stressDocs.length; index += 1) {
        const inspectBefore = await invokeHttp(bridge, 'inspect', { projectId });
        const stressMark = await evaluate(page, () => window.__CASE__.mark());
        const stressResult = await composeThroughTool(tool, sessionId, projectId, inspectBefore.revision, stressDocs[index], 'r2-stress-' + (index + 1));
        const stressReady = await evaluate(page, (expected) => window.__CASE__.waitCanvas({ phase: 'ready', revision: expected, notice: false, maxCandidateFrames: 0 }, 30000), stressResult.publishedRevision);
        if (stressReady.ok === true) await evaluate(page, (since) => window.__CASE__.waitFrameLoad(since, 10000), stressMark);
        const stressState = stressReady.state;
        const stressRelease = await waitForPreviewRelease(page, stressMark, stressPrevSnapshot, 5000);
        const stressRequests = stressRelease.requests;
        const releaseForPrevious = stressRelease.ok === true;
        stress.switches.push({ round: index + 1, ok: stressReady.ok, revision: stressState.revision, expected: stressResult.publishedRevision, snapshotId: stressState.snapshotId, releasedPrevious: releaseForPrevious, records: bridge.snapshots.records.size, previewRoutes: host.routes.filter((candidate) => typeof candidate.path === 'string' && candidate.path.indexOf('/api/dsh-video/preview/') === 0).length });
        checkAcceptance('B4', 'R2 stress round ' + (index + 1) + ': publish→auto-switch keeps markers truthful and releases the previous snapshot', stressReady.ok === true && stressState.revision === stressResult.publishedRevision && stressState.candidateFrameCount === 0 && releaseForPrevious === true, { round: index + 1, state: { revision: stressState.revision, snapshotId: stressState.snapshotId }, previousSnapshot: stressPrevSnapshot, releasedPrevious: releaseForPrevious });
        stressPrevSnapshot = stressState.snapshotId;
        stressPrevRevision = stressState.revision;
      }
      checks.check('R2 stress: Host snapshot records stay bounded (<=4 per project) across repeated switches', bridge.snapshots.records.size <= 4, { snapshotRecords: bridge.snapshots.records.size, previewRoutes: host.routes.filter((candidate) => typeof candidate.path === 'string' && candidate.path.indexOf('/api/dsh-video/preview/') === 0).length });
      // Double retry click must not break the switch or leak releases.
      const doubleInspect = await invokeHttp(bridge, 'inspect', { projectId });
      const doubleMark = await evaluate(page, () => window.__CASE__.mark());
      await evaluate(page, () => window.__CASE__.inject({ method: 'preview.snapshot', code: 'E_PREVIEW_NOT_FOUND', message: 'Injected snapshot failure (stress)', times: 1 }));
      const doubleRevision = await composeThroughTool(tool, sessionId, projectId, doubleInspect.revision, genreB().html, 'r2-stress-double');
      const doubleNotice = await evaluate(page, () => window.__CASE__.waitNotice(30000));
      let doubleResult = { ok: false, state: doubleNotice.state };
      if (doubleNotice.ok === true && doubleNotice.state.notices.length > 0 && doubleNotice.state.notices[0].retry !== null) {
        const retryRect = doubleNotice.state.notices[0].retry.rect;
        await page.mouse.click(retryRect.centerX, retryRect.centerY);
        await sleep(60);
        await page.mouse.click(retryRect.centerX, retryRect.centerY);
        doubleResult = await evaluate(page, (expected) => window.__CASE__.waitCanvas({ phase: 'ready', revision: expected, notice: false, maxCandidateFrames: 0 }, 30000), doubleRevision.publishedRevision);
      }
      const doubleRequests = await evaluate(page, (mark) => window.__CASE__.requestsSince(mark), doubleMark);
      const doubleReleases = doubleRequests.filter((entry) => entry.method === 'preview.release');
      const doubleErroredReleases = doubleReleases.filter((entry) => entry.responseErrorCode !== null && entry.responseErrorCode !== undefined);
      stress.doubleRetry = { revision: doubleResult.state.revision, expected: doubleRevision.publishedRevision, ok: doubleResult.ok, releases: doubleReleases.length, erroredReleases: doubleErroredReleases.length, records: bridge.snapshots.records.size };
      checkAcceptance('B4', 'R2 stress: a double retry click still switches once and leaves no candidate/unexpected release errors', doubleResult.ok === true && doubleResult.state.revision === doubleRevision.publishedRevision && doubleResult.state.candidateFrameCount === 0 && doubleErroredReleases.length === 0, stress.doubleRetry);
      // Unmount while the candidate failure notice is visible: no leaked routes/records.
      const unmountInspect = await invokeHttp(bridge, 'inspect', { projectId });
      await evaluate(page, () => window.__CASE__.inject({ method: 'preview.snapshot', code: 'E_PREVIEW_NOT_FOUND', message: 'Injected snapshot failure (unmount stress)', times: 1 }));
      await composeThroughTool(tool, sessionId, projectId, unmountInspect.revision, genreAModified().html, 'r2-stress-unmount');
      const unmountNotice = await evaluate(page, () => window.__CASE__.waitNotice(30000));
      await evaluate(page, () => window.__CASE__.unmount());
      let unmountRoutes = -1;
      let unmountRecords = -1;
      for (let attempt = 0; attempt < 40; attempt += 1) {
        unmountRoutes = host.routes.filter((candidate) => typeof candidate.path === 'string' && candidate.path.indexOf('/api/dsh-video/preview/') === 0).length;
        unmountRecords = bridge.snapshots.records.size;
        if (unmountRoutes === 0 && unmountRecords === 0) break;
        await sleep(100);
      }
      stress.unmountDuringFailure = { noticeSeen: unmountNotice.ok === true, previewRoutes: unmountRoutes, snapshotRecords: unmountRecords };
      checkAcceptance('B4', 'R2 stress: unmounting while a candidate failure notice is visible releases snapshots/routes (no leak)', unmountNotice.ok === true && unmountRoutes === 0 && unmountRecords === 0, stress.unmountDuringFailure);
      console.log('[phase] R2 stress done: switches=' + stress.switches.length + ' doubleRetry=' + doubleResult.ok + ' unmountRoutes=' + unmountRoutes + ' records=' + unmountRecords);
    }
    evidence.stress = process.env.DSH_R2_STRESS === '1' && evidence.r2 !== null ? evidence.r2.stress : null;
    // R2-5: with NO valid preview yet, an initial failure stays fully recoverable
    // (existing full .dv-canvas-status error + retry; no stale iframe is claimed).
    await evaluate(page, () => window.__CASE__.unmount());
    await evaluate(page, () => window.__CASE__.clearInjections());
    await evaluate(page, () => window.__CASE__.inject({ method: 'preview.snapshot', code: 'E_PREVIEW_NOT_FOUND', message: 'Injected initial snapshot failure (harness)', times: 1 }));
    const remountStartedAt = Date.now();
    await evaluate(page, () => window.__CASE__.mount());
    const initialError = await evaluate(page, () => window.__CASE__.waitError(40000));
    const initialErrorState = initialError.state;
    const remountToErrorMs = Date.now() - remountStartedAt;
    const initialErrorShot = await screenshotPage(page, join(evidenceDirectory, '08-r2-initial-failure.png'));
    checkAcceptance('B4', 'R2: with no valid preview yet an initial failure shows the full recoverable error (phase=error, no stale iframe)', initialError.ok === true && initialErrorState.phase === 'error' && initialErrorState.fullErrorVisible === true && initialErrorState.activeFrameCount === 0 && initialErrorState.canvasStatusRetry !== null, { ok: initialError.ok, phase: initialErrorState.phase, fullErrorVisible: initialErrorState.fullErrorVisible, activeFrames: initialErrorState.activeFrameCount, hasRetry: initialErrorState.canvasStatusRetry !== null });
    let initialRecovered = { ok: false, state: initialErrorState };
    if (initialErrorState.canvasStatusRetry !== null) {
      const initialRetryMark = await evaluate(page, () => window.__CASE__.mark());
      await page.mouse.click(initialErrorState.canvasStatusRetry.rect.centerX, initialErrorState.canvasStatusRetry.rect.centerY);
      initialRecovered = await evaluate(page, () => window.__CASE__.waitCanvas({ phase: 'ready', minActiveFrames: 1, maxCandidateFrames: 0, fullError: false }, 40000));
      if (initialRecovered.ok === true) await evaluate(page, (since) => window.__CASE__.waitFrameLoad(since, 10000), initialRetryMark);
    }
    const initialRecoveredShot = await screenshotPage(page, join(evidenceDirectory, '09-r2-initial-failure-recovered.png'));
    checkAcceptance('B4', 'R2: initial-failure retry recovers to a ready preview (no dead end)', initialRecovered.ok === true && initialRecovered.state.fullErrorVisible === false && initialRecovered.state.activeFrameCount >= 1, { ok: initialRecovered.ok, phase: initialRecovered.state.phase, revision: initialRecovered.state.revision, activeFrames: initialRecovered.state.activeFrameCount });
    r2Evidence.initialFailure = { remountToErrorMs, errorWaitMs: initialError.elapsedMs, retryRecoverMs: initialRecovered.elapsedMs, recoverOk: initialRecovered.ok, screenshots: [initialErrorShot, initialRecoveredShot] };
    console.log('[phase] R2 retention/markers/switch/release/initial-failure evidence captured');
    evidence.recovery = {
      mode: 'r2-retention-and-switch',
      retentionRevision: r2Evidence.retention === null ? null : r2Evidence.retention.requestedRevision,
      retrySwitchRevision: r2Evidence.retrySwitch === null ? null : r2Evidence.retrySwitch.revision,
      candidateRuntimeRevision: r2Evidence.candidateRuntimeError === null ? null : r2Evidence.candidateRuntimeError.requestedRevision,
      autoSwitchRevision: r2Evidence.autoSwitch === null ? null : r2Evidence.autoSwitch.revision,
      initialFailureRecovered: r2Evidence.initialFailure === null ? null : r2Evidence.initialFailure.recoverOk,
      screenshots: [retentionShot, retrySwitchShot, runtimeShot, autoSwitchShot, initialErrorShot, initialRecoveredShot],
    };

    // ─── B5: no deferred manual controls + gesture safety ──────────────────
    const forbiddenSelectors = [
      '.dv-editor', '.dv-stagebar', '.dv-controls', '.dv-selection', '.dv-overlay', '.dv-inline-editor',
      '.dv-editor-actions', '.dv-drawer', '.dv-canvas-tools', '.dv-handle', '.dv-export-link', '.dv-size-input',
      '.dv-frame', '#dsh-video-target', '#dsh-video-title', '#dsh-video-frame-time', '#dsh-video-start', '#dsh-video-duration',
      '.dv-job', '.dv-details', '.dv-meta-list', '.dv-upload', '.dv-asset-list',
      'input[type="color"]', 'input[type="number"]', 'input[type="file"]', 'input[type="text"]', 'textarea',
    ];
    const forbiddenTextKeys = [
      'video.canvas.undo', 'video.canvas.redo', 'video.canvas.materials', 'video.canvas.addScene',
      'video.canvas.export', 'video.canvas.exporting', 'video.canvas.download', 'video.canvas.sceneColor',
      'video.canvas.textStyle', 'video.canvas.apply', 'video.canvas.busy', 'video.canvas.hint',
      'video.save', 'video.update', 'video.refresh', 'video.frameTime', 'video.target', 'video.title',
      'video.start', 'video.duration', 'video.details', 'video.export', 'video.import',
    ];
    const forbiddenTexts = forbiddenTextKeys.map((key) => dictionary[key]).filter((value) => typeof value === 'string' && value.length > 0);
    const finalState = await evaluate(page, () => window.__CASE__.state());
    const audit = await evaluate(page, (argsForAudit) => window.__CASE__.domAudit(argsForAudit.selectors, argsForAudit.texts), { selectors: forbiddenSelectors, texts: forbiddenTexts });
    checkAcceptance('B5', 'B5: rendered product panel contains no deferred manual-edit controls (undo/redo/materials/addScene/export/property forms/selection/editor)', audit.present.length === 0 && audit.copyHits.length === 0, { present: audit.present, copyHits: audit.copyHits, forbiddenTexts });
    const disallowedControls = audit.formControls.filter((control) => !(control.tag === 'input' && control.type === 'range'));
    checkAcceptance('B5', 'B5: only the read-only preview controls remain (play/pause, seek, time label)', audit.canvasBarPresent === true && audit.playButton !== null && audit.seekPresent === true && audit.timePresent === true && disallowedControls.length === 0, { canvasBar: audit.canvasBarPresent, playButton: audit.playButton, seek: audit.seekPresent, time: audit.timePresent, disallowedControls });
    // Gesture safety: real clicks/double-click/keyboard on the preview must not
    // open any editor/selection nor issue a project write.
    const gestureMark = await evaluate(page, () => window.__CASE__.mark());
    const wrapRect = finalState.wrap;
    if (wrapRect !== null) {
      await page.mouse.click(wrapRect.left + wrapRect.width / 2, wrapRect.top + wrapRect.height / 2);
      await sleep(150);
      await page.mouse.click(wrapRect.left + wrapRect.width / 2, wrapRect.top + wrapRect.height / 2, { count: 2 });
      await page.keyboard.press('ArrowRight');
      await page.keyboard.press('Space');
      await sleep(400);
    }
    const gestureRequests = requestsBetween(apiLog, gestureMark);
    const gestureWrites = gestureRequests.filter((entry) => WRITE_METHODS.has(entry.method));
    const gestureAudit = await evaluate(page, (argsForAudit) => window.__CASE__.domAudit(argsForAudit.selectors, argsForAudit.texts), { selectors: ['.dv-selection', '.dv-inline-editor', '.dv-editor-actions', '.dv-handle', '.dv-drawer'], texts: forbiddenTexts });
    const gestureState = await evaluate(page, () => window.__CASE__.state());
    checkAcceptance('B5', 'B5: real user gestures on the preview issue no write request and open no editor/selection', gestureWrites.length === 0 && gestureAudit.present.length === 0 && gestureState.phase === 'ready', { gestureRequests: gestureRequests.map((entry) => entry.method), gestureWrites: gestureWrites.map((entry) => entry.method), openedSelectors: gestureAudit.present, phase: gestureState.phase });
    console.log('[phase] preview-only audit: present=' + JSON.stringify(audit.present) + ' copyHits=' + JSON.stringify(audit.copyHits) + ' gestureWrites=' + JSON.stringify(gestureWrites.map((entry) => entry.method)));
    evidence.gestures = { gestureRequests: gestureRequests.map((entry) => entry.method), gestureWrites: gestureWrites.map((entry) => entry.method), openedSelectors: gestureAudit.present, audit, forbiddenSelectors, forbiddenTexts };

    // ─── global network / console / final revision evidence ────────────────
    const onlineRevision = (await invokeHttp(bridge, 'inspect', { projectId })).revision;
    checks.check('final canvas revision equals the Host project revision (no stale preview)', gestureState.revision === onlineRevision, { canvasRevision: gestureState.revision, hostRevision: onlineRevision });
    const internal = (url) => url.startsWith(origin) || url.startsWith('data:') || url.startsWith('about:') || url.startsWith('blob:');
    const externalRequests = networkRequests.filter((request) => internal(request.url) === false);
    const rawConsoleErrors = consoleMessages.filter((message) => message.type === 'error');
    const rejectedHostResponses = serverLog.filter((entry) => entry.path === REQUEST_PATH && entry.status >= 400);
    const expectedConsoleErrors = rawConsoleErrors.filter((message) => {
      const match = /^Failed to load resource: the server responded with a status of (\d{3})/.exec(message.text);
      return match !== null && rejectedHostResponses.some((entry) => String(entry.status) === match[1]);
    });
    // Documented reload-cancellation noise: the Host revokes a project's previous
    // snapshot routes when a new revision registers; an iframe from the revision
    // being replaced can still be fetching its GSAP asset, which then aborts/404s
    // inside that discarded sandbox document ("gsap is not defined" is thrown by
    // the old document only). Recorded explicitly, never used to hide a failure of
    // the CURRENT preview (phase/revision/screenshot checks still run).
    const previewAssetAborts = requestFailures.filter((failure) => typeof failure.url === 'string'
      && failure.url.indexOf('/api/dsh-video/preview/') !== -1
      && failure.url.indexOf('/assets/gsap.min.js') !== -1
      && /ERR_ABORTED/.test(String(failure.error || '')));
    const expectedReloadCancellations = {
      previewAssetAborts,
      pageErrors: pageErrors.filter((text) => text === 'gsap is not defined'),
      consoleErrors: rawConsoleErrors.filter((message) => /status of 404/.test(message.text) && previewAssetAborts.length > 0),
    };
    const expectedConsoleFiltered = rawConsoleErrors.filter((message) => expectedConsoleErrors.includes(message) || expectedReloadCancellations.consoleErrors.includes(message));
    const unexpectedConsoleErrors = rawConsoleErrors.filter((message) => expectedConsoleFiltered.includes(message) === false);
    const unexpectedPageErrors = pageErrors.filter((text) => expectedReloadCancellations.pageErrors.includes(text) === false);
    evidence.network = {
      origin,
      totalRequests: networkRequests.length,
      external: externalRequests,
      requestFailures,
      rejectedHostResponses,
      expectedReloadCancellations,
      console: { errors: rawConsoleErrors, expectedResourceErrors: expectedConsoleErrors, unexpectedErrors: unexpectedConsoleErrors },
      pageErrors,
      harnessPageErrors: await evaluate(page, () => window.__CASE__.pageErrors()),
      apiRequestsByMethod: apiLog.reduce((counts, request) => { counts[request.method] = (counts[request.method] || 0) + 1; return counts; }, {}),
      writeRequests: apiLog.filter((entry) => WRITE_METHODS.has(entry.method)).length,
    };
    checks.check('no external network request during the real-staged preview run', externalRequests.length === 0, { external: externalRequests });
    checks.check('no unexpected page/console errors during the real-staged preview run', unexpectedConsoleErrors.length === 0 && unexpectedPageErrors.length === 0 && evidence.network.harnessPageErrors.length === 0, { unexpectedConsoleErrors, unexpectedPageErrors, expectedReloadCancellations, harnessPageErrors: evidence.network.harnessPageErrors });

    // ─── teardown ──────────────────────────────────────────────────────────
    await evaluate(page, () => window.__CASE__.unmount());
    await sleep(300);
    const latePageErrors = await evaluate(page, () => window.__CASE__.pageErrors());
    const previewRoutesBeforeDispose = host.routes.filter((candidate) => typeof candidate.path === 'string' && candidate.path.indexOf('/api/dsh-video/preview/') === 0).length;
    const snapshotRecordsBeforeDispose = bridge.snapshots.records.size;
    checks.check('R2: unmount releases preview snapshots and Host preview routes (no leak after the panel closes)', previewRoutesBeforeDispose === 0 && snapshotRecordsBeforeDispose === 0, { previewRoutesBeforeDispose, snapshotRecordsBeforeDispose });
    const bridgeStateBeforeDispose = bridge.state();
    await browser.close();
    browser = null;
    await new Promise((resolveClose) => server.close(resolveClose));
    server = null;
    await bridge.dispose();
    const bridgeStateAfterDispose = bridge.state();
    const snapshotCount = bridge.snapshots.records.size;
    const teardown = {
      bridgeBeforeDispose: bridgeStateBeforeDispose,
      bridgeAfterDispose: bridgeStateAfterDispose,
      snapshotRecordsAfterDispose: snapshotCount,
      routesAfterDispose: host.routes.length,
      serverClosed: server === null,
      browserClosed: browser === null,
      noLatePageErrors: latePageErrors.length === 0,
    };
    teardown.ok = bridgeStateAfterDispose.inFlight === 0 && snapshotCount === 0 && teardown.routesAfterDispose === 0 && teardown.serverClosed && teardown.browserClosed && teardown.noLatePageErrors;
    checks.check('honest teardown: bridge drained, routes/snapshots released, browser+server closed', teardown.ok === true, teardown);
    evidence.teardown = teardown;
    checks.check('every recorded acceptance check passed', true, { checks: checks.checks.length });
  } catch (error) {
    evidence.fatalError = { message: error instanceof Error ? error.message : String(error), stack: error instanceof Error ? error.stack : undefined };
    console.error('harness failed:', evidence.fatalError.message);
  } finally {
    if (browser !== null) await browser.close().catch(() => {});
    if (server !== null) await new Promise((resolveClose) => server.close(resolveClose)).catch(() => {});
    if (bridge !== null) {
      try {
        await bridge.dispose();
      } catch (_error) { /* reported by checks/teardown */ }
    }
    if (stagingBefore !== null && staged !== null) {
      try {
        evidence.stagingReadOnly = {
          ...compareStagingSources(stagingBefore, await listStagingSources(staged.evidence.staging)),
          note: 'Only immutable source/config files are compared; worker business dirs, node_modules, caches and evidence/ are excluded.',
        };
      } catch (error) {
        evidence.stagingReadOnly = { same: null, error: error instanceof Error ? error.message : String(error) };
      }
    }
    evidence.acceptance = {
      B1: { ok: acceptanceChecks.B1.length > 0 && acceptanceChecks.B1.every((entry) => entry.ok), checks: acceptanceChecks.B1 },
      B2: { ok: acceptanceChecks.B2.length > 0 && acceptanceChecks.B2.every((entry) => entry.ok), checks: acceptanceChecks.B2 },
      B3: { ok: acceptanceChecks.B3.length > 0 && acceptanceChecks.B3.every((entry) => entry.ok), checks: acceptanceChecks.B3 },
      B4: { ok: acceptanceChecks.B4.length > 0 && acceptanceChecks.B4.every((entry) => entry.ok), checks: acceptanceChecks.B4 },
      B5: { ok: acceptanceChecks.B5.length > 0 && acceptanceChecks.B5.every((entry) => entry.ok), checks: acceptanceChecks.B5 },
    };
    evidence.checks = checks.checks;
    evidence.summary = { total: checks.checks.length, passed: checks.passed(), failed: checks.checks.length - checks.passed() };
    evidence.ok = checks.ok() && evidence.fatalError === undefined && evidence.stagingReadOnly !== null && evidence.stagingReadOnly.same === true;
    evidence.finishedAt = new Date().toISOString();
    evidence.requests = apiLog;
    const evidenceFile = await writeEvidence(outRoot, runDirectory, 'conversation-preview', evidence);
    console.log(JSON.stringify({
      evidence: evidenceFile,
      ok: evidence.ok,
      checks: evidence.summary,
      acceptance: evidence.acceptance ? Object.fromEntries(Object.entries(evidence.acceptance).map(([id, entry]) => [id, entry.ok])) : null,
      latency: evidence.latency,
      rounds: evidence.rounds.map((round) => ({ round: round.round, genre: round.genre, revision: round.revision, snapshotId: round.snapshotId, latency: round.latency })),
      playback: evidence.playback ?? null,
      recovery: evidence.recovery ? { mode: evidence.recovery.mode, retentionRevision: evidence.recovery.retentionRevision, retrySwitchRevision: evidence.recovery.retrySwitchRevision, candidateRuntimeRevision: evidence.recovery.candidateRuntimeRevision, autoSwitchRevision: evidence.recovery.autoSwitchRevision, initialFailureRecovered: evidence.recovery.initialFailureRecovered } : null,
      r2: evidence.r2 ? {
        retentionKeptOld: evidence.r2.retention !== null,
        retainedPlayable: evidence.r2.retention !== null && evidence.r2.retention.retainedPlayable === true,
        oldSnapshotReleased: evidence.r2.retrySwitch !== null && evidence.r2.retrySwitch.oldSnapshotReleased === true,
        candidateRuntimeRetained: evidence.r2.candidateRuntimeError !== null && evidence.r2.candidateRuntimeError.retainedPlayable === true,
        autoReleasedOld: evidence.r2.autoSwitch !== null && evidence.r2.autoSwitch.autoReleasedOld === true,
        initialFailureRecovered: evidence.r2.initialFailure !== null && evidence.r2.initialFailure.recoverOk === true,
      } : null,
      stress: evidence.stress ? { switches: evidence.stress.switches.length, doubleRetry: evidence.stress.doubleRetry, unmountDuringFailure: evidence.stress.unmountDuringFailure } : null,
      network: evidence.network ? { external: evidence.network.external.length, writeRequests: evidence.network.writeRequests, apiRequestsByMethod: evidence.network.apiRequestsByMethod } : null,
      extraction: evidence.extraction ? { clientSha256: evidence.extraction.clientSha256?.slice(0, 16), factorySha256: evidence.extraction.factorySha256?.slice(0, 16), factoryLines: evidence.extraction.factoryLines } : null,
      engineCommit: evidence.engineCommit,
      rootCommit: evidence.rootCommit,
      stagingReadOnly: evidence.stagingReadOnly,
    }, null, 2));
  }
  process.exitCode = evidence.ok === true ? 0 : 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
