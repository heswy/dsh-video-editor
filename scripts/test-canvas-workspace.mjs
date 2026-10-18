#!/usr/bin/env node
/**
 * P3-008 real-browser CanvasWorkspace regression harness.
 *
 * Loads the EXACT staged client bundle (`<staging>/bundle/client.js`) and runs
 * the real `CanvasWorkspace` component in real Chrome with real DOM pointer and
 * keyboard gestures, against the real staged Host (`VideoBridge` from
 * `<staging>/bundle/host/bridge.js`), a real worker-managed `product-launch-v1`
 * project and the real fixed snapshot runtime.
 *
 * What is real here:
 *   - the component source is extracted by region markers from the staged
 *     `client.js` bytes (no reimplementation): `//#region host bridge helpers`
 *     through its end marker plus `//#region P3-008 canvas workspace` through
 *     its end marker; sha256 of both slices and of the whole staged file are
 *     recorded in the evidence JSON;
 *   - the component receives `{t, projectId, inspected, onReload, onError}` and
 *     calls the module-scope `hostRequest`, which POSTs to the real Host request
 *     route (`host/routes.js#createRequestRoute(videoBridge)`) served by a
 *     loopback HTTP server;
 *   - project creation, inspect, layout/text edits, revision conflicts and
 *     preview snapshots all go through the staged `VideoBridge` -> WorkerClient
 *     -> managed worker project; iframe snapshots are served by the staged
 *     `SnapshotRoutes` with the fixed (`canvas-runtime.js`) runtime and CSP;
 *   - interactions are real Chrome mouse/keyboard input (puppeteer-core resolved
 *     from the staged engine-worker node_modules). Selected drags/double-clicks
 *     are mapped from composition CSS pixels through the component's own
 *     letterbox scale.
 *
 * Failure injection wraps `window.fetch` INSIDE the test page only (never the
 * staged source): a matching `edit`/`scene.update` request is answered with a
 * Host-shaped `{ok:false,error:{code,message}}` body so the component's own
 * error path runs unchanged.
 *
 * Immutability: the staging snapshot is verified by loadStagedHost and is only
 * written for the evidence JSON (`<staging>/evidence/` by default). All mutable
 * bridge state (managed registry, projects, previews, asset inbox, session
 * state) is redirected to a fresh OS temp directory recorded in the evidence,
 * so the staged tree is not mutated by project.create/snapshot writes.
 *
 * Usage:
 *   node scripts/test-canvas-workspace.mjs --staging <absolute staging dir>
 *                                          [--out <absolute evidence dir>]
 *                                          [--case <comma separated id prefixes>]
 *
 * Exit code: 0 only when every executed case assertion, the network/console
 * check and teardown checks pass; 1 otherwise; 2 on usage errors.
 */

import { createServer } from 'node:http';
import { access, mkdir, mkdtemp, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadStagedHost, sha256 } from './lib/staged-host.mjs';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const LIB_DIR = join(SCRIPT_DIR, 'lib');
const REQUEST_PATH = '/api/dsh-video/request';
const TITLE_ID = 'scene-1-title';
const RULE_ID = 'scene-1-rule';
const TITLE_BASE = { left: 88, top: 196, width: 980, height: null };
const RULE_BASE = { left: 88, top: 560, width: 1104, height: 2 };
const COMPOSITION_WIDTH = 1280;
const COMPOSITION_HEIGHT = 720;
const PROJECT_TITLE = 'P3-008 Harness';

// ─── arguments / assertions ────────────────────────────────────────────────

function usage(message) {
  if (message) console.error(message);
  console.error('usage: node scripts/test-canvas-workspace.mjs --staging <absolute staging dir> [--out <absolute evidence dir>] [--case <id-prefixes>]');
  process.exit(2);
}

function parseArgs(argv) {
  const args = { caseFilter: null };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--staging') {
      args.staging = argv[index + 1];
      index += 1;
    } else if (argument === '--out') {
      args.out = argv[index + 1];
      index += 1;
    } else if (argument === '--case') {
      args.caseFilter = argv[index + 1];
      index += 1;
    } else {
      usage('unknown argument ' + argument);
    }
  }
  if (!args.staging || isAbsolute(args.staging) === false) usage('--staging must be an absolute directory');
  if (args.out !== undefined && isAbsolute(args.out) === false) usage('--out must be an absolute directory when given');
  return args;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function newCase(id, title) {
  return { id, title, ok: true, assertions: [], startedAt: new Date().toISOString() };
}

function check(caseResult, name, ok, details) {
  const entry = { name, ok: ok === true };
  if (details !== undefined) entry.details = details;
  caseResult.assertions.push(entry);
  if (ok !== true) caseResult.ok = false;
  return ok === true;
}

function sameKeys(object, expectedKeys) {
  if (object === null || typeof object !== 'object') return false;
  const actual = Object.keys(object).sort();
  const expected = expectedKeys.slice().sort();
  if (actual.length !== expected.length) return false;
  return actual.every((key, index) => key === expected[index]);
}

function near(value, expected, tolerance) {
  return Number.isFinite(Number(value)) && Math.abs(Number(value) - expected) <= tolerance;
}

function rectNear(actual, expected, tolerance) {
  if (actual === null || actual === undefined) return false;
  return near(actual.x, expected.x, tolerance)
    && near(actual.y, expected.y, tolerance)
    && near(actual.width, expected.width, tolerance)
    && near(actual.height, expected.height, tolerance);
}

function rectOf(rect) {
  if (rect === null || rect === undefined) return null;
  return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
}

function findElement(inspected, stableId) {
  const elements = inspected !== null && Array.isArray(inspected.elements) ? inspected.elements : [];
  return elements.find((element) => element !== null && element.stableId === stableId) || null;
}

// ─── staged source extraction ──────────────────────────────────────────────

/**
 * One `//#region <name>` line through the first following `//#endregion` line.
 * Markers are asserted (single occurrence, contiguous lines) so a staging drift
 * fails before any browser work instead of silently extracting the wrong code.
 */
function regionSlice(source, name) {
  const lines = source.split('\n');
  const startMarker = '//#region ' + name;
  const starts = [];
  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index].trim() === startMarker) starts.push(index);
  }
  assert(starts.length === 1, `staged client.js must contain exactly one "${startMarker}" marker (found ${starts.length})`);
  const start = starts[0];
  let end = -1;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (lines[index].trim() === '//#endregion') {
      end = index;
      break;
    }
  }
  assert(end !== -1, `staged client.js region "${name}" has no end marker`);
  const text = lines.slice(start, end + 1).join('\n');
  return {
    name,
    startLine: start + 1,
    endLine: end + 1,
    lines: end - start + 1,
    bytes: Buffer.byteLength(text, 'utf8'),
    sha256: sha256(Buffer.from(text, 'utf8')),
    text,
  };
}

const FACTORY_GLUE = '\nreturn { CanvasWorkspace: CanvasWorkspace, hostRequest: hostRequest, formatSeconds: formatSeconds, errorText: errorText, hostError: hostError, operationId: operationId };\n';

function extractStagedSource(clientSource) {
  const helpers = regionSlice(clientSource, 'host bridge helpers');
  const canvas = regionSlice(clientSource, 'P3-008 canvas workspace');
  const locale = regionSlice(clientSource, 'locale dictionaries');
  const styles = regionSlice(clientSource, 'styles');
  assert(helpers.startLine < canvas.startLine, 'host bridge helpers must precede the canvas workspace region');

  for (const marker of [
    'const REQUEST_ROUTE = \'api/dsh-video/request\';',
    'async function hostRequest(',
    'function hostError(',
    'function errorText(',
    'function formatSeconds(',
    'function operationId(',
  ]) {
    assert(helpers.text.includes(marker), 'host bridge helpers slice is missing: ' + marker);
  }
  for (const marker of [
    'function canvasStaticBase(',
    'function canvasLayoutPatch(',
    'function canvasValidateEvent(',
    'function canvasValidateCommand(',
  ]) {
    assert(helpers.text.includes(marker), 'host bridge helpers slice is missing the layout/message helper: ' + marker);
  }
  for (const marker of [
    'function CanvasWorkspace(',
    'const iframeRef = React.useRef(null);',
    'data-canvas-revision',
    'function beginDrag(',
    'function commitLayout(',
    'function submitText(',
    'function openTextEditor(',
    'function onOverlayDoubleClick(',
    'dv-canvas-stage',
  ]) {
    assert(canvas.text.includes(marker), 'P3-008 canvas workspace slice is missing: ' + marker);
  }
  assert(helpers.text.trimEnd().endsWith('//#endregion'), 'host bridge helpers slice does not end with //#endregion');
  assert(canvas.text.trimEnd().endsWith('//#endregion'), 'canvas workspace slice does not end with //#endregion');

  let EN;
  try {
    EN = new Function(locale.text + '\nreturn EN;')();
  } catch (error) {
    throw new Error('staged locale dictionary slice could not be evaluated: ' + (error instanceof Error ? error.message : String(error)));
  }
  assert(EN !== null && typeof EN === 'object', 'staged EN dictionary is not an object');
  for (const key of ['video.error.conflict', 'video.canvas.loading', 'video.canvas.retry', 'video.canvas.busy']) {
    assert(typeof EN[key] === 'string' && EN[key].length > 0, 'staged EN dictionary is missing ' + key);
  }
  let CSS;
  try {
    CSS = new Function(styles.text + '\nreturn CSS;')();
  } catch (error) {
    throw new Error('staged CSS slice could not be evaluated: ' + (error instanceof Error ? error.message : String(error)));
  }
  assert(typeof CSS === 'string' && CSS.length > 1000, 'staged CSS slice is unexpectedly small');

  // The factory body is the concatenation of both verified slices inside one
  // function scope, exactly how the staged factory would see them.
  const factoryBody = '"use strict";\n' + helpers.text + '\n' + canvas.text + '\n' + FACTORY_GLUE;
  try {
    // Compile only (React/h are injected at page runtime); a syntax error in the
    // staging or a duplicate declaration must fail here, not in the browser.
    // eslint-disable-next-line no-new-func
    new Function('React', 'h', factoryBody);
  } catch (error) {
    throw new Error('extracted CanvasWorkspace source does not compile: ' + (error instanceof Error ? error.message : String(error)));
  }
  const pageSource = 'window.CanvasModule = function (React, h) {\n' + factoryBody + '\n};\n';
  return {
    helpers,
    canvas,
    locale,
    styles,
    EN,
    CSS,
    factoryBody,
    pageSource,
    evidence: {
      clientBytes: Buffer.byteLength(clientSource, 'utf8'),
      clientSha256: sha256(Buffer.from(clientSource, 'utf8')),
      helpers: { startLine: helpers.startLine, endLine: helpers.endLine, bytes: helpers.bytes, sha256: helpers.sha256 },
      canvas: { startLine: canvas.startLine, endLine: canvas.endLine, bytes: canvas.bytes, sha256: canvas.sha256 },
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
  return moduleSource.replace(
    exportLine,
    'window.ReactLite = { React, createElement, createRoot, createPortal, flushSync, pendingWork };'
  );
}

// ─── isolated mutable bridge state ─────────────────────────────────────────

async function prepareStateRoot(staging, config) {
  const base = await mkdtemp(join(tmpdir(), 'dsh-p3008-canvas-'));
  const directories = {
    projects: join(base, 'projects'),
    output: join(base, 'output'),
    inbox: join(base, 'asset-inbox'),
    sessionCwd: join(base, 'session-cwd'),
    managed: join(base, 'managed'),
  };
  for (const directory of Object.values(directories)) await mkdir(directory, { recursive: true });
  const stagingRegistry = JSON.parse(await readFile(config.registryPath, 'utf8'));
  assert(stagingRegistry !== null && typeof stagingRegistry === 'object' && typeof stagingRegistry.projectsRoot === 'string',
    'staging worker registry is not a managed registry');
  const projectsRegistryPath = join(directories.managed, 'projects.json');
  const registry = {
    ...stagingRegistry,
    projectsRoot: directories.projects,
    registryPath: projectsRegistryPath,
    outputRoot: directories.output,
    assetInboxRoot: directories.inbox,
  };
  delete registry.projects;
  const registryPath = join(directories.managed, 'registry.json');
  await writeFile(registryPath, JSON.stringify(registry, null, 2) + '\n');
  await writeFile(projectsRegistryPath, JSON.stringify({ projects: {} }, null, 2) + '\n');
  const redirected = {
    ...config,
    registryPath,
    artifactRoot: directories.output,
    projectsRoot: directories.projects,
    assetInboxRoot: directories.inbox,
    sessionStatePath: join(base, 'session-state.json'),
    sessionCwd: directories.sessionCwd,
  };
  return { base, registryPath, projectsRegistryPath, directories, config: redirected, stagingRegistry };
}

function fakeSessionController() {
  return {
    async create() {
      return { sessionId: 'session-browser-1' };
    },
    async rename(request) {
      return { title: request.title, seq: 1 };
    },
    async inspect(id) {
      return { meta: { id }, events: [] };
    },
  };
}

function fakeCtx() {
  const routes = [];
  const services = {
    sessionController: fakeSessionController(),
    workspaceRegistry: { archivedSessionIds: [] },
    systemPrompt: { context() { return () => {}; } },
    agents: { get() { return undefined; } },
  };
  return {
    routes,
    ctx: {
      logger: { warn() {}, error() {} },
      subprocess: {
        async resolveExecutable(command) {
          if (isAbsolute(command)) {
            await access(command, constants.X_OK);
            return command;
          }
          for (const directory of (process.env.PATH || '').split(':')) {
            if (directory === '') continue;
            const candidate = join(directory, command);
            try {
              await access(candidate, constants.X_OK);
              return candidate;
            } catch (_error) {
              /* keep searching */
            }
          }
          throw new Error('executable not found: ' + command);
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
      tools: { register() { return () => {}; } },
      effect() { return () => {}; },
      get(name) { return services[name]; },
    },
  };
}

// ─── content sanitising / response helpers ─────────────────────────────────

function sanitizeRequestParams(params) {
  // Evidence keeps the exact typed request (needed to assert patch keys) but
  // bounds very long free-text fields for readability.
  try {
    const text = JSON.stringify(params);
    if (text.length <= 4000) return params;
    return { truncated: true, bytes: text.length, preview: text.slice(0, 4000) };
  } catch (_error) {
    return { unserializable: true };
  }
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
  response.headers.forEach((value, key) => {
    headers[key] = value;
  });
  const buffer = Buffer.from(await response.arrayBuffer());
  res.writeHead(response.status, headers);
  res.end(buffer);
}

function sleep(ms) {
  return new Promise((resolveSleep) => {
    setTimeout(resolveSleep, ms);
  });
}

// ─── staging read-only audit ───────────────────────────────────────────────

const STAGING_EXCLUDED_PREFIXES = [
  'bundle/node_modules/',
  'engine-client/node_modules/',
  'engine-worker/node_modules/',
  'engine-worker/artifacts/',
  'engine-worker/cache/',
  'cache/',
  'evidence/',
  'projects/',
  'managed/',
  'restore/',
  'asset-inbox/',
  'session-cwd/',
  'session-state.json',
];

function stagingSourceExcluded(relativePath) {
  if (STAGING_EXCLUDED_PREFIXES.some((prefix) => relativePath === prefix.slice(0, -1) || relativePath.startsWith(prefix))) return true;
  return false;
}

async function listStagingSources(stagingRoot) {
  const entries = [];
  async function walk(directory, relative) {
    const children = await readdir(directory, { withFileTypes: true });
    for (const child of children) {
      const childRelative = relative === '' ? child.name : relative + '/' + child.name;
      if (stagingSourceExcluded(childRelative)) continue;
      const childPath = join(directory, child.name);
      if (child.isDirectory()) {
        await walk(childPath, childRelative);
      } else if (child.isFile()) {
        const info = await stat(childPath);
        entries.push({ path: childRelative, bytes: info.size, mtimeMs: Math.round(info.mtimeMs) });
      }
    }
  }
  await walk(stagingRoot, '');
  return entries.sort((left, right) => left.path.localeCompare(right.path));
}

function compareStagingSources(before, after) {
  const beforeMap = new Map(before.map((entry) => [entry.path, entry]));
  const afterMap = new Map(after.map((entry) => [entry.path, entry]));
  const changed = [];
  for (const [path, entry] of beforeMap) {
    const next = afterMap.get(path);
    if (next === undefined) changed.push({ path, change: 'removed' });
    else if (next.bytes !== entry.bytes || next.mtimeMs !== entry.mtimeMs) changed.push({ path, change: 'modified', beforeBytes: entry.bytes, afterBytes: next.bytes });
  }
  for (const path of afterMap.keys()) {
    if (beforeMap.has(path) === false) changed.push({ path, change: 'added' });
  }
  return { same: changed.length === 0, changed, beforeCount: before.length, afterCount: after.length };
}

// ─── browser orchestration primitives ──────────────────────────────────────

async function pageState(page) {
  return page.evaluate(() => window.__CASE__.state());
}

async function compToScreen(page, x, y) {
  return page.evaluate(([compX, compY]) => window.__CASE__.compToScreen(compX, compY), [x, y]);
}

async function clickComp(page, x, y) {
  const point = await compToScreen(page, x, y);
  await page.mouse.click(point.x, point.y);
  return point;
}

async function dragBy(page, from, dxScreen, dyScreen) {
  await page.mouse.move(from.x, from.y);
  await sleep(20);
  await page.mouse.down();
  await sleep(40);
  const steps = 14;
  for (let index = 1; index <= steps; index += 1) {
    await page.mouse.move(from.x + (dxScreen * index) / steps, from.y + (dyScreen * index) / steps);
    await sleep(12);
  }
  await sleep(150);
  await page.mouse.up();
}

async function waitForRevision(page, oldRevision, timeout) {
  try {
    await page.waitForFunction(
      (previous) => {
        const shell = document.querySelector('.dv-canvas-shell');
        return shell !== null && shell.getAttribute('data-canvas-revision') !== previous;
      },
      { timeout, polling: 'raf' },
      oldRevision
    );
    return true;
  } catch (_error) {
    return false;
  }
}

async function waitForPhaseReady(page, timeout) {
  try {
    await page.waitForFunction(
      () => {
        const shell = document.querySelector('.dv-canvas-shell');
        if (shell === null) return false;
        if (shell.getAttribute('data-canvas-phase') !== 'ready') return false;
        const stage = document.querySelector('.dv-stage');
        return stage !== null && stage.getBoundingClientRect().width > 0;
      },
      { timeout, polling: 'raf' }
    );
    return true;
  } catch (_error) {
    return false;
  }
}

async function waitForErrorOrActions(page, timeout) {
  try {
    await page.waitForFunction(
      () => document.querySelector('.dv-tool-error') !== null
        || document.querySelector('.dv-editor-actions') !== null
        || document.querySelector('button.dv-editor-retry') !== null,
      { timeout, polling: 'raf' }
    );
    return true;
  } catch (_error) {
    return false;
  }
}

/**
 * Seek through the staged component's own timeline control and click the
 * animated title. Retries because (a) the iframe runtime handshake is async and
 * (b) the fixed runtime can need one extra `state` round trip after load.
 */
function expectedTitleOffset(t) {
  // product-launch-v1 timeline (frozen engine fixture):
  //   tl.fromTo(title, { opacity: 0, y: 36 }, { opacity: 1, y: 0, duration: .9, ease: 'power2.out' }, 0)
  // GSAP power2 == cubic, so y(t) = 36 * (1 - clamp(t / .9, 0, 1))^3.
  const progress = Math.min(Math.max(t / 0.9, 0), 1);
  return 36 * Math.pow(1 - progress, 3);
}

function expectedRuleScaleX(t) {
  //   tl.fromTo(rule, { scaleX: 0 }, { scaleX: 1, duration: 1.2, ease: 'none' }, 0.2)
  return Math.min(Math.max((t - 0.2) / 1.2, 0), 1);
}

function ruleAnimatedRect(t) {
  const scaleX = expectedRuleScaleX(t);
  const width = RULE_BASE.width * scaleX;
  return { x: RULE_BASE.left + (RULE_BASE.width - width) / 2, y: RULE_BASE.top, width, height: RULE_BASE.height, scaleX };
}

async function selectTitle(page, inspected, t) {
  const element = findElement(inspected, TITLE_ID);
  assert(element !== null, 'inspected project has no scene-1-title');
  const base = element.layout || TITLE_BASE;
  const expectedY = base.top + expectedTitleOffset(t);
  const point = { x: base.left + 200, y: base.top + 60 };
  let last = null;
  for (let attempt = 1; attempt <= 10; attempt += 1) {
    await page.evaluate((time) => window.__CASE__.seek(time), t);
    await sleep(80);
    const screen = await compToScreen(page, point.x, point.y);
    await page.mouse.click(screen.x, screen.y);
    await sleep(200);
    const state = await pageState(page);
    last = state;
    if (state.selection !== null
      && near(state.selection.width, base.width, 1.2)
      && near(state.selection.y, expectedY, 1.5)) {
      return { selection: state.selection, state, attempts: attempt, clickComposition: point };
    }
    await sleep(480);
  }
  throw new Error('could not select ' + TITLE_ID + ' at t=' + t + '; last state=' + JSON.stringify(last).slice(0, 2000));
}

async function selectRule(page, inspected, t) {
  const element = findElement(inspected, RULE_ID);
  assert(element !== null, 'inspected project has no scene-1-rule');
  const expected = ruleAnimatedRect(t);
  const point = { x: expected.x + expected.width / 2, y: expected.y + 1 };
  let last = null;
  for (let attempt = 1; attempt <= 10; attempt += 1) {
    await page.evaluate((time) => window.__CASE__.seek(time), t);
    await sleep(80);
    const screen = await compToScreen(page, point.x, point.y);
    await page.mouse.click(screen.x, screen.y);
    await sleep(200);
    const state = await pageState(page);
    last = state;
    if (state.selection !== null
      && near(state.selection.y, RULE_BASE.top, 1.5)
      && near(state.selection.width, expected.width, 2)
      && state.selection.height < 10) {
      return { selection: state.selection, state, expected, attempts: attempt, clickComposition: point };
    }
    await sleep(480);
  }
  throw new Error('could not select ' + RULE_ID + ' at t=' + t + '; last state=' + JSON.stringify(last).slice(0, 2000));
}

/** Click the center of an expected composition rect until the selection matches. */
async function locateSelection(page, expectedRect, tolerance, attempts) {
  const center = { x: expectedRect.x + expectedRect.width / 2, y: expectedRect.y + expectedRect.height / 2 };
  const maxAttempts = attempts || 6;
  let state = await pageState(page);
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    if (state.selection !== null && rectNear(state.selection, expectedRect, tolerance)) {
      return { selection: state.selection, state, attempts: attempt };
    }
    const screen = await compToScreen(page, center.x, center.y);
    await page.mouse.click(screen.x, screen.y);
    await sleep(220);
    state = await pageState(page);
    if (state.selection !== null && rectNear(state.selection, expectedRect, tolerance)) {
      return { selection: state.selection, state, attempts: attempt };
    }
    await sleep(520);
  }
  return { selection: state.selection, state, attempts: maxAttempts };
}

async function openTextEditor(page, selection) {
  const center = { x: selection.x + selection.width / 2, y: selection.y + selection.height / 2 };
  const screen = await compToScreen(page, center.x, center.y);
  await page.mouse.click(screen.x, screen.y);
  await sleep(700);
  await page.mouse.click(screen.x, screen.y, { count: 2 });
  await sleep(300);
  let state = await pageState(page);
  if (state.editor !== null) return { state, selection, mode: 'real-double-click' };
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    await page.mouse.click(screen.x, screen.y, { count: 2 });
    await sleep(400);
    state = await pageState(page);
    if (state.editor !== null) return { state, selection, mode: 'real-double-click' };
    await sleep(300);
  }
  // Fallback used only while the staged component's pointer capture retargets
  // click/dblclick to `.dv-overlay` (so the real gesture can never reach the
  // selection handler). Dispatch a real DOM dblclick at the selection element;
  // the component's own onDoubleClick -> openTextEditor path still runs. The
  // evidence marks this path, and callers assert whether the REAL double-click
  // gesture opened the editor.
  const fallback = await page.evaluate(() => {
    const selectionNode = document.querySelector('.dv-selection');
    if (selectionNode === null) return false;
    selectionNode.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true, view: window }));
    return true;
  });
  await sleep(350);
  state = await pageState(page);
  if (state.editor !== null) return { state, selection, mode: 'dispatched-dblclick-fallback', fallbackDispatched: fallback };
  const events = await page.evaluate(() => window.__CASE__.events().slice(-40));
  throw new Error('inline text editor could not be opened; last state=' + JSON.stringify(state).slice(0, 1500) + ' events=' + JSON.stringify(events));
}

function styleAttributeOf(html, id) {
  const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const elementPattern = new RegExp('<[^>]*\\bid="' + escaped + '"[^>]*>');
  const match = elementPattern.exec(html);
  if (match === null) return null;
  const stylePattern = /\bstyle="([^"]*)"/;
  const style = stylePattern.exec(match[0]);
  return style === null ? '' : style[1];
}

function styleDeclarations(styleText) {
  const declarations = {};
  if (typeof styleText !== 'string') return declarations;
  for (const part of styleText.split(';')) {
    const colon = part.indexOf(':');
    if (colon === -1) continue;
    declarations[part.slice(0, colon).trim().toLowerCase()] = part.slice(colon + 1).trim();
  }
  return declarations;
}

// ─── case runners ──────────────────────────────────────────────────────────


function expectedStageScale(wrap) {
  return Math.min(wrap.width / COMPOSITION_WIDTH, wrap.height / COMPOSITION_HEIGHT);
}

/**
 * The component must size the stage to composition x letterbox scale and
 * centre it in the measured wrap: that is the mapping every gesture uses.
 */
function assertStageLetterbox(caseResult, label, state) {
  const stage = state.stage;
  const wrap = state.wrap;
  const mounted = check(caseResult, label + ' stage and wrap are mounted', stage !== null && wrap !== null, { stage, wrap });
  if (!mounted) return;
  const scale = expectedStageScale(wrap);
  const expectedWidth = COMPOSITION_WIDTH * scale;
  const expectedHeight = COMPOSITION_HEIGHT * scale;
  check(caseResult, label + ' stage box = composition x letterbox scale', near(stage.width, expectedWidth, 0.6) && near(stage.height, expectedHeight, 0.6), { expectedWidth, expectedHeight, actualWidth: stage.width, actualHeight: stage.height });
  check(caseResult, label + ' stage is letterbox centred in the wrap', near(stage.left, wrap.left + (wrap.width - expectedWidth) / 2, 1.2) && near(stage.top, wrap.top + (wrap.height - expectedHeight) / 2, 1.2), { expectedLeft: wrap.left + (wrap.width - expectedWidth) / 2, expectedTop: wrap.top + (wrap.height - expectedHeight) / 2, actualLeft: stage.left, actualTop: stage.top });
  check(caseResult, label + ' composition-to-screen scale matches the letterbox', near(stage.scale, scale, 0.002), { expectedScale: scale, actualScale: stage.scale });
}

/**
 * Non-assertive frame diagnostics: the fixed runtime contract says composition
 * coordinates are CSS pixels in the preview document viewport, so the Host must
 * render the sandboxed document at composition size (scaling it in CSS). When
 * that is not the case, hit tests at composition coordinates outside the
 * iframe's viewport silently miss; the evidence records this per case.
 */
function attachFrameDiagnostics(caseResult, state) {
  if (caseResult.diagnostics === undefined) caseResult.diagnostics = {};
  const iframe = state.iframe;
  caseResult.diagnostics.iframe = iframe;
  caseResult.diagnostics.iframeMapsComposition = iframe !== null
    && near(iframe.viewportWidth, COMPOSITION_WIDTH, 1)
    && near(iframe.viewportHeight, COMPOSITION_HEIGHT, 1);
  caseResult.diagnostics.stage = state.stage;
  return caseResult.diagnostics;
}

async function createFreshProject(ctx, title) {
  const created = await ctx.bridge.invoke('project.create', { templateId: 'product-launch-v1', title }, { source: 'http' });
  ctx.projectIds.push(created.projectId);
  return created.projectId;
}

async function inspectProject(ctx, projectId) {
  return ctx.bridge.invoke('inspect', { projectId }, { source: 'http' });
}

async function mountWorkspace(ctx, options) {
  const mountOptions = { ...options, frameScaleProbe: process.env.DSH_CANVAS_PROBE_FRAME_SCALE === '1' };
  const state = await ctx.page.evaluate((next) => window.__CASE__.mount(next), mountOptions);
  return state;
}

async function readProjectHtml(ctx, projectId) {
  return readFile(join(ctx.stateRoot.directories.projects, projectId, 'index.html'), 'utf8');
}

function layoutSnapshot(inspected, stableId) {
  const element = findElement(inspected, stableId);
  return element !== null ? element.layout : null;
}

/** Case 1: drag-move at one animation moment and one letterbox stage size. */
async function runDragMoveCase(ctx, spec) {
  const caseResult = newCase(spec.id, 'drag-move t=' + spec.t + ' wrap=' + spec.wrap.width + 'x' + spec.wrap.height);
  const { page } = ctx;
  const projectId = await createFreshProject(ctx, PROJECT_TITLE + ' move');
  const inspected = await inspectProject(ctx, projectId);
  const base = layoutSnapshot(inspected, TITLE_ID);
  check(caseResult, 'fresh title static base', base !== null && base.left === TITLE_BASE.left && base.top === TITLE_BASE.top && base.width === TITLE_BASE.width && base.height === null, { expected: TITLE_BASE, actual: base });

  const mountedState = await mountWorkspace(ctx, { projectId, inspected, wrap: spec.wrap, t: spec.t });
  assertStageLetterbox(caseResult, 'drag-move', mountedState);
  attachFrameDiagnostics(caseResult, mountedState);
  const selected = await selectTitle(page, inspected, spec.t);
  const stageScale = selected.state.stage !== null ? selected.state.stage.scale : 0;
  const animatedOffset = selected.selection.y - base.top;
  check(caseResult, 'animation moment rendered (title y offset)', near(animatedOffset, expectedTitleOffset(spec.t), 0.9), { expected: expectedTitleOffset(spec.t), actual: animatedOffset, t: spec.t });
  check(caseResult, 'selected animated title rect', near(selected.selection.width, base.width, 1.2) && near(selected.selection.height, 71.672, 1.5), { actual: rectOf(selected.selection), expectedWidth: base.width, expectedHeight: 71.672 });

  const beforeState = await pageState(page);
  const startScreen = await compToScreen(page, selected.selection.x + selected.selection.width / 2, selected.selection.y + selected.selection.height / 2);
  const compositionDelta = { x: 100, y: 40 };
  const screenDelta = { x: compositionDelta.x * stageScale, y: compositionDelta.y * stageScale };
  const apiMark = ctx.apiLog.length;
  const pageMark = await page.evaluate(() => window.__CASE__.mark());
  await dragBy(page, startScreen, screenDelta.x, screenDelta.y);
  const revised = await waitForRevision(page, beforeState.revision, 30000);
  const ready = await waitForPhaseReady(page, 20000);
  await sleep(260);
  const afterState = await pageState(page);
  const inspectedAfter = await inspectProject(ctx, projectId);
  const committed = layoutSnapshot(inspectedAfter, TITLE_ID);
  const editRequests = ctx.apiLog.slice(apiMark).filter((request) => request.method === 'edit');
  const editParams = editRequests.length > 0 ? editRequests[0].params : null;
  const box = editParams !== null && Array.isArray(editParams.ops) && editParams.ops[0] !== undefined ? editParams.ops[0].box : null;

  check(caseResult, 'edit succeeded and published a new revision', revised, { beforeRevision: beforeState.revision, afterRevision: afterState.revision, inspectedRevision: inspectedAfter.revision });
  check(caseResult, 'new revision snapshot loaded (iframe src changed)', afterState.snapshotId !== beforeState.snapshotId && afterState.snapshotId !== null, { beforeSnapshot: beforeState.snapshotId, afterSnapshot: afterState.snapshotId });
  check(caseResult, 'new revision rendered in the canvas shell', afterState.revision === inspectedAfter.revision, { expected: inspectedAfter.revision, actual: afterState.revision });
  check(caseResult, 'exactly one layout edit request', editRequests.length === 1, { actual: editRequests.length, requests: ctx.apiLog.slice(apiMark).map((request) => request.method) });
  check(caseResult, 'move patch contains only left/top (no width/height)', sameKeys(box, ['left', 'top']), { actual: box });
  check(caseResult, 'committed left = static base + composition dx', committed !== null && near(committed.left, base.left + compositionDelta.x, 0.6), { expected: base.left + compositionDelta.x, actual: committed !== null ? committed.left : null });
  check(caseResult, 'committed top = static base + composition dy', committed !== null && near(committed.top, base.top + compositionDelta.y, 0.6), { expected: base.top + compositionDelta.y, actual: committed !== null ? committed.top : null });
  check(caseResult, 'committed width unchanged', committed !== null && near(committed.width, base.width, 1e-6), { expected: base.width, actual: committed !== null ? committed.width : null });
  check(caseResult, 'committed auto height stays unknown (null)', committed !== null && committed.height === null, { expected: null, actual: committed !== null ? committed.height : null });
  if (Math.abs(animatedOffset) > 3) {
    const bakedTop = selected.selection.y + compositionDelta.y;
    check(caseResult, 'current animation offset is not baked into the committed layout', committed !== null && Math.abs(committed.top - bakedTop) > 2, { animationOffset: animatedOffset, animatedRectPlusDelta: bakedTop, committedTop: committed !== null ? committed.top : null });
  }

  const expectedRendered = { x: selected.selection.x + compositionDelta.x, y: selected.selection.y + compositionDelta.y, width: selected.selection.width, height: selected.selection.height };
  const located = await locateSelection(page, expectedRendered, 1.0, 8);
  check(caseResult, 'rendered title after reload = animated rect + composition delta', located.selection !== null && rectNear(located.selection, expectedRendered, 1.0), { expected: expectedRendered, actual: rectOf(located.selection), attempts: located.attempts, clickComposition: { x: expectedRendered.x + expectedRendered.width / 2, y: expectedRendered.y + expectedRendered.height / 2 }, iframe: located.state.iframe });

  const html = await readProjectHtml(ctx, projectId);
  const titleStyle = styleDeclarations(styleAttributeOf(html, TITLE_ID));
  check(caseResult, 'host HTML keeps the static title width', near(parseFloat(String(titleStyle.width || 'NaN').replace('px', '')), base.width, 0.01), { expected: base.width, actual: titleStyle.width });
  check(caseResult, 'host HTML does not bake the animation transform', !/\btransform\b|\bscale[XY]?\(|\btranslate[XY]?\(/.test(styleAttributeOf(html, TITLE_ID) || ''), { actual: styleAttributeOf(html, TITLE_ID) });
  check(caseResult, 'no action error after a successful move', afterState.toolErrors.length === 0 && afterState.onErrors.length === 0, { toolErrors: afterState.toolErrors, onErrors: afterState.onErrors });
  caseResult.finishedAt = new Date().toISOString();
  return caseResult;
}

/** Case 2a: se resize of a scaleX-animated element -> inverse mapped width. */
async function runResizeRuleCase(ctx) {
  const caseResult = newCase('R1', 'se resize inverse mapping (scene-1-rule scaleX at t=0.8)');
  const { page } = ctx;
  const wrap = { width: COMPOSITION_WIDTH, height: COMPOSITION_HEIGHT };
  const t = 0.8;
  const projectId = await createFreshProject(ctx, PROJECT_TITLE + ' resize rule');
  const inspected = await inspectProject(ctx, projectId);
  const base = layoutSnapshot(inspected, RULE_ID);
  check(caseResult, 'fresh rule static base', base !== null && base.left === RULE_BASE.left && base.top === RULE_BASE.top && base.width === RULE_BASE.width && base.height === RULE_BASE.height, { expected: RULE_BASE, actual: base });

  const mountedState = await mountWorkspace(ctx, { projectId, inspected, wrap, t });
  assertStageLetterbox(caseResult, 'resize-rule', mountedState);
  attachFrameDiagnostics(caseResult, mountedState);
  const selected = await selectRule(page, inspected, t);
  const scale = selected.state.stage !== null ? selected.state.stage.scale : 0;
  check(caseResult, 'stage runs at composition scale 1 for the resize probe', near(scale, 1, 0.002), { actual: scale });
  const animated = rectOf(selected.selection);
  const expectedAnimated = ruleAnimatedRect(t);
  check(caseResult, 'rule rendered with scaleX animation at t=0.8', animated !== null && near(animated.x, expectedAnimated.x, 2) && near(animated.width, expectedAnimated.width, 2) && near(animated.height, 2, 1), { expected: rectOf(expectedAnimated), actual: animated });

  const handleRect = selected.state.handleSeRect;
  check(caseResult, 'se handle is present', handleRect !== null, { actual: handleRect });
  const startScreen = handleRect !== null ? { x: handleRect.centerX, y: handleRect.centerY } : null;
  const compositionDelta = { x: 60, y: 20 };
  const screenDelta = { x: compositionDelta.x * scale, y: compositionDelta.y * scale };
  const apiMark = ctx.apiLog.length;
  const beforeState = await pageState(page);
  if (startScreen !== null) await dragBy(page, startScreen, screenDelta.x, screenDelta.y);
  const revised = await waitForRevision(page, beforeState.revision, 30000);
  await waitForPhaseReady(page, 20000);
  await sleep(260);
  const afterState = await pageState(page);
  const inspectedAfter = await inspectProject(ctx, projectId);
  const committed = layoutSnapshot(inspectedAfter, RULE_ID);
  const editRequests = ctx.apiLog.slice(apiMark).filter((request) => request.method === 'edit');
  const editParams = editRequests.length > 0 ? editRequests[0].params : null;
  const box = editParams !== null && Array.isArray(editParams.ops) && editParams.ops[0] !== undefined ? editParams.ops[0].box : null;
  const startRect = selected.selection;
  const scaleFactor = startRect.width / base.width;
  const unclampedWidth = (startRect.width + compositionDelta.x) / scaleFactor;
  // The fixed client clamps an east-edge extent to the remaining composition
  // space after the static left (documented in canvasLayoutPatch).
  const expectedWidth = Math.min(unclampedWidth, COMPOSITION_WIDTH - base.left);
  const expectedHeight = (startRect.height + compositionDelta.y) / 1;

  check(caseResult, 'resize edit succeeded and published a new revision', revised, { beforeRevision: beforeState.revision, afterRevision: afterState.revision });
  check(caseResult, 'exactly one layout edit request', editRequests.length === 1, { actual: editRequests.length });
  check(caseResult, 'se resize patch contains only width/height (left/top untouched)', sameKeys(box, ['height', 'width']), { actual: box });
  check(caseResult, 'committed width is inverse-scaled from the animated rect (clamped to composition space)', committed !== null && near(committed.width, expectedWidth, 0.8), { expected: expectedWidth, unclampedWidth, compositionCeiling: COMPOSITION_WIDTH - base.left, actual: committed !== null ? committed.width : null, scaleFactor, animatedWidth: startRect.width, compositionDx: compositionDelta.x });
  check(caseResult, 'committed height is inverse-mapped for the se drag', committed !== null && near(committed.height, expectedHeight, 0.8), { expected: expectedHeight, actual: committed !== null ? committed.height : null, compositionDy: compositionDelta.y });
  check(caseResult, 'committed left/top unchanged for a se drag', committed !== null && near(committed.left, base.left, 1e-6) && near(committed.top, base.top, 1e-6), { expectedLeft: base.left, expectedTop: base.top, actualLeft: committed !== null ? committed.left : null, actualTop: committed !== null ? committed.top : null });
  check(caseResult, 'resize did not bake the rendered animated width', committed !== null && Math.abs(committed.width - (startRect.width + compositionDelta.x)) > 5, { animatedPreviewWidth: startRect.width + compositionDelta.x, committedWidth: committed !== null ? committed.width : null });

  // The rule's scaleX=0.5 transform is still applied after reload, so the
  // rendered rect is the new static box scaled about its center.
  const expectedPost = committed !== null ? {
    x: committed.left + (committed.width - committed.width * scaleFactor) / 2,
    y: committed.top,
    width: committed.width * scaleFactor,
    height: committed.height,
  } : null;
  const located = expectedPost !== null ? await locateSelection(page, expectedPost, 1.5, 8) : { selection: null };
  check(caseResult, 'rendered rule after reload keeps the scaleX animation (animated rect from new static width)', expectedPost !== null && located.selection !== null && rectNear(located.selection, expectedPost, 1.5), { expected: expectedPost, actual: rectOf(located.selection) });

  const html = await readProjectHtml(ctx, projectId);
  const ruleStyle = styleDeclarations(styleAttributeOf(html, RULE_ID));
  const htmlWidth = parseFloat(String(ruleStyle.width || 'NaN').replace('px', ''));
  check(caseResult, 'host HTML stores the inverse-mapped static width', near(htmlWidth, expectedWidth, 0.05), { expected: expectedWidth, actual: ruleStyle.width });
  check(caseResult, 'host HTML does not bake the animation transform', !/\btransform\b|\bscale[XY]?\(|\btranslate[XY]?\(/.test(styleAttributeOf(html, RULE_ID) || ''), { actual: styleAttributeOf(html, RULE_ID) });
  check(caseResult, 'new revision snapshot loaded', afterState.snapshotId !== beforeState.snapshotId && afterState.revision === inspectedAfter.revision, { beforeSnapshot: beforeState.snapshotId, afterSnapshot: afterState.snapshotId });
  caseResult.finishedAt = new Date().toISOString();
  return caseResult;
}

/** Case 2b: se resize of the auto-height title -> explicit size patch. */
async function runResizeTitleCase(ctx) {
  const caseResult = newCase('R2', 'se resize auto height (scene-1-title at t=2, wrap 900x400)');
  const { page } = ctx;
  const wrap = { width: 900, height: 400 };
  const t = 2;
  const projectId = await createFreshProject(ctx, PROJECT_TITLE + ' resize title');
  const inspected = await inspectProject(ctx, projectId);
  const base = layoutSnapshot(inspected, TITLE_ID);
  check(caseResult, 'fresh title static base has auto height', base !== null && base.height === null && base.width === TITLE_BASE.width, { actual: base });
  const mountedState = await mountWorkspace(ctx, { projectId, inspected, wrap, t });
  assertStageLetterbox(caseResult, 'resize-title', mountedState);
  attachFrameDiagnostics(caseResult, mountedState);
  const scale = mountedState.stage !== null ? mountedState.stage.scale : 0;
  const selected = await selectTitle(page, inspected, t);
  const startRect = selected.selection;
  check(caseResult, 'title selected at settled animation moment', near(startRect.y, base.top, 1.2) && near(startRect.width, base.width, 1.2), { expected: { x: base.left, y: base.top, width: base.width }, actual: rectOf(startRect) });
  const handleRect = selected.state.handleSeRect;
  const startScreen = handleRect !== null ? { x: handleRect.centerX, y: handleRect.centerY } : null;
  const compositionDelta = { x: 60, y: 30 };
  const screenDelta = { x: compositionDelta.x * scale, y: compositionDelta.y * scale };
  const apiMark = ctx.apiLog.length;
  const beforeState = await pageState(page);
  if (startScreen !== null) await dragBy(page, startScreen, screenDelta.x, screenDelta.y);
  const revised = await waitForRevision(page, beforeState.revision, 30000);
  await waitForPhaseReady(page, 20000);
  await sleep(260);
  const inspectedAfter = await inspectProject(ctx, projectId);
  const committed = layoutSnapshot(inspectedAfter, TITLE_ID);
  const editRequests = ctx.apiLog.slice(apiMark).filter((request) => request.method === 'edit');
  const editParams = editRequests.length > 0 ? editRequests[0].params : null;
  const box = editParams !== null && Array.isArray(editParams.ops) && editParams.ops[0] !== undefined ? editParams.ops[0].box : null;
  const expectedWidth = base.width + compositionDelta.x;
  const expectedHeight = startRect.height + compositionDelta.y;
  check(caseResult, 'resize edit succeeded', revised, { beforeRevision: beforeState.revision });
  check(caseResult, 'exactly one layout edit request', editRequests.length === 1, { actual: editRequests.length });
  check(caseResult, 'se resize patch for the auto-height title contains only width/height', sameKeys(box, ['height', 'width']), { actual: box });
  check(caseResult, 'committed width = static base width + dx', committed !== null && near(committed.width, expectedWidth, 0.8), { expected: expectedWidth, actual: committed !== null ? committed.width : null });
  check(caseResult, 'committed height becomes the explicit rendered height + dy (no fake auto height)', committed !== null && near(committed.height, expectedHeight, 0.8), { expected: expectedHeight, actual: committed !== null ? committed.height : null, startRenderedHeight: startRect.height });
  check(caseResult, 'committed left/top unchanged for se', committed !== null && near(committed.left, base.left, 1e-6) && near(committed.top, base.top, 1e-6), { actualLeft: committed !== null ? committed.left : null, actualTop: committed !== null ? committed.top : null });
  const expectedPost = { x: base.left, y: base.top, width: expectedWidth, height: expectedHeight };
  const located = await locateSelection(page, expectedPost, 1.2, 8);
  check(caseResult, 'rendered title after reload matches the new static box', located.selection !== null && rectNear(located.selection, expectedPost, 1.2), { expected: expectedPost, actual: rectOf(located.selection) });
  const html = await readProjectHtml(ctx, projectId);
  const titleStyle = styleDeclarations(styleAttributeOf(html, TITLE_ID));
  check(caseResult, 'host HTML stores explicit width and height', near(parseFloat(String(titleStyle.width || 'NaN').replace('px', '')), expectedWidth, 0.05) && near(parseFloat(String(titleStyle.height || 'NaN').replace('px', '')), expectedHeight, 0.05), { expectedWidth, expectedHeight, actualStyle: titleStyle });
  check(caseResult, 'host HTML does not bake the animation transform', !/\btransform\b|\bscale[XY]?\(|\btranslate[XY]?\(/.test(styleAttributeOf(html, TITLE_ID) || ''), { actual: styleAttributeOf(html, TITLE_ID) });
  caseResult.finishedAt = new Date().toISOString();
  return caseResult;
}

/** Case 3: a failed layout edit recovers; no auto retry; retry succeeds. */
async function runDragFailureCase(ctx) {
  const caseResult = newCase('F1', 'drag E_PERSIST failure recovery (t=2, wrap 900x400)');
  const { page } = ctx;
  const wrap = { width: 900, height: 400 };
  const t = 2;
  const projectId = await createFreshProject(ctx, PROJECT_TITLE + ' drag failure');
  const inspected = await inspectProject(ctx, projectId);
  const base = layoutSnapshot(inspected, TITLE_ID);
  const mountedState = await mountWorkspace(ctx, { projectId, inspected, wrap, t });
  assertStageLetterbox(caseResult, 'resize-title', mountedState);
  attachFrameDiagnostics(caseResult, mountedState);
  const scale = mountedState.stage !== null ? mountedState.stage.scale : 0;
  const selected = await selectTitle(page, inspected, t);
  const preDragRect = rectOf(selected.selection);
  const beforeState = await pageState(page);
  const apiMark = ctx.apiLog.length;
  const pageMark = await page.evaluate(() => window.__CASE__.mark());
  await page.evaluate(() => window.__CASE__.inject({ method: 'edit', code: 'E_PERSIST', message: 'Injected layout persist failure', times: 1 }));
  const compositionDelta = { x: 60, y: 30 };
  const screenDelta = { x: compositionDelta.x * scale, y: compositionDelta.y * scale };
  const startScreen = await compToScreen(page, preDragRect.x + preDragRect.width / 2, preDragRect.y + preDragRect.height / 2);
  await dragBy(page, startScreen, screenDelta.x, screenDelta.y);
  const sawError = await waitForErrorOrActions(page, 15000);
  await sleep(600);
  const failureState = await pageState(page);
  const inspectedFailure = await inspectProject(ctx, projectId);
  const failureLayout = layoutSnapshot(inspectedFailure, TITLE_ID);
  const injected = await page.evaluate(() => window.__CASE__.injectionState());
  const pageRequests = await page.evaluate((mark) => window.__CASE__.requestsSince(mark), pageMark);
  const apiEdits = ctx.apiLog.slice(apiMark).filter((request) => request.method === 'edit');

  check(caseResult, 'failure surfaced in the UI', sawError && failureState.errorVisible, { sawError, toolErrors: failureState.toolErrors });
  check(caseResult, 'injected host-shaped failure was consumed exactly once', injected.length === 1 && injected[0].hits === 1 && injected[0].remaining === 0, { actual: injected });
  check(caseResult, 'failed edit never reached the real Host request route', apiEdits.length === 0, { actual: apiEdits.length, methods: ctx.apiLog.slice(apiMark).map((request) => request.method) });
  check(caseResult, 'no automatic retry of the failed edit', pageRequests.filter((request) => request.method === 'edit').length === 1, { editRequests: pageRequests.filter((request) => request.method === 'edit') });
  check(caseResult, 'failure does not change the project revision', failureState.revision === beforeState.revision && inspectedFailure.revision === beforeState.revision, { beforeRevision: beforeState.revision, canvasRevision: failureState.revision, hostRevision: inspectedFailure.revision });
  check(caseResult, 'failure keeps the pre-drag host layout', failureLayout !== null && JSON.stringify(failureLayout) === JSON.stringify(base), { expected: base, actual: failureLayout });
  check(caseResult, 'selection returns to the pre-drag rect', failureState.selection !== null && rectNear(failureState.selection, preDragRect, 0.6), { expected: preDragRect, actual: rectOf(failureState.selection) });
  check(caseResult, 'error text is visible', failureState.toolErrors.some((text) => typeof text === 'string' && text.includes('Injected layout persist failure')), { toolErrors: failureState.toolErrors });

  // Retry the same gesture with no injection: it must succeed against the real Host.
  const retryScreen = await compToScreen(page, preDragRect.x + preDragRect.width / 2, preDragRect.y + preDragRect.height / 2);
  const retryApiMark = ctx.apiLog.length;
  await dragBy(page, retryScreen, screenDelta.x, screenDelta.y);
  const retried = await waitForRevision(page, beforeState.revision, 30000);
  await waitForPhaseReady(page, 20000);
  await sleep(240);
  const retryState = await pageState(page);
  const inspectedRetry = await inspectProject(ctx, projectId);
  const retryLayout = layoutSnapshot(inspectedRetry, TITLE_ID);
  const retryEdits = ctx.apiLog.slice(retryApiMark).filter((request) => request.method === 'edit');
  const retryBox = retryEdits.length > 0 ? retryEdits[0].params.ops[0].box : null;
  check(caseResult, 'retry gesture succeeds after the failure', retried && retryEdits.length === 1, { retried, editRequests: retryEdits.length });
  check(caseResult, 'retry commit uses the pre-drag static base + delta', retryLayout !== null && near(retryLayout.left, base.left + compositionDelta.x, 0.6) && near(retryLayout.top, base.top + compositionDelta.y, 0.6), { expected: { left: base.left + compositionDelta.x, top: base.top + compositionDelta.y }, actual: retryLayout });
  check(caseResult, 'retry patch contains only left/top', sameKeys(retryBox, ['left', 'top']), { actual: retryBox });
  check(caseResult, 'error clears after the successful retry', retryState.toolErrors.length === 0, { toolErrors: retryState.toolErrors });
  caseResult.finishedAt = new Date().toISOString();
  return caseResult;
}

/** Case 4a: text failure keeps the draft, retry saves it. */
async function runTextFailureRetryCase(ctx) {
  const caseResult = newCase('T1', 'inline text E_PERSIST failure keeps draft and retry saves (t=2)');
  const { page } = ctx;
  const projectId = await createFreshProject(ctx, PROJECT_TITLE + ' text failure');
  const inspected = await inspectProject(ctx, projectId);
  const titleElement = findElement(inspected, TITLE_ID);
  const originalText = titleElement !== null ? titleElement.text : null;
  const wrap = { width: 900, height: 400 };
  await mountWorkspace(ctx, { projectId, inspected, wrap, t: 2 });
  const selected = await selectTitle(page, inspected, 2);
  const opened = await openTextEditor(page, selected.selection);
  const initialValue = opened.state.editor !== null ? opened.state.editor.value : null;
  check(caseResult, 'real double-click gesture opens the inline editor', opened.mode === 'real-double-click', { mode: opened.mode });
  check(caseResult, 'double-click opens the inline editor with the current text', typeof initialValue === 'string' && initialValue === originalText, { originalText, editorValue: initialValue });
  await page.keyboard.type(' DRAFT-A', { delay: 18 });
  await sleep(120);
  const typedState = await pageState(page);
  const draft = typedState.editor !== null ? typedState.editor.value : null;
  check(caseResult, 'keyboard typing updates the draft in the real textarea', typeof draft === 'string' && draft.includes('DRAFT-A') && draft !== initialValue, { draft });

  const beforeState = await pageState(page);
  const apiMark = ctx.apiLog.length;
  const pageMark = await page.evaluate(() => window.__CASE__.mark());
  await page.evaluate(() => window.__CASE__.inject({ method: 'edit', code: 'E_PERSIST', message: 'Injected text persist failure', times: 1 }));
  await page.keyboard.press('Enter');
  const sawError = await waitForErrorOrActions(page, 15000);
  await sleep(600);
  const failureState = await pageState(page);
  const inspectedFailure = await inspectProject(ctx, projectId);
  const failureTitle = findElement(inspectedFailure, TITLE_ID);
  const injected = await page.evaluate(() => window.__CASE__.injectionState());
  const pageRequests = await page.evaluate((mark) => window.__CASE__.requestsSince(mark), pageMark);
  const apiEdits = ctx.apiLog.slice(apiMark).filter((request) => request.method === 'edit');

  check(caseResult, 'Enter submitted the text edit', pageRequests.filter((request) => request.method === 'edit').length === 1, { requests: pageRequests });
  check(caseResult, 'injected failure consumed once', injected.length === 1 && injected[0].hits === 1, { actual: injected });
  check(caseResult, 'failed text edit never reached the real Host route', apiEdits.length === 0, { actual: apiEdits.length });
  check(caseResult, 'no automatic text retry', pageRequests.filter((request) => request.method === 'edit').length === 1, { editRequests: pageRequests.filter((request) => request.method === 'edit') });
  check(caseResult, 'failure error is visible', sawError && failureState.errorVisible, { toolErrors: failureState.toolErrors });
  check(caseResult, 'editor stays open with the draft after E_PERSIST', failureState.editor !== null && failureState.editor.value === draft, { expectedDraft: draft, actualEditor: failureState.editor });
  check(caseResult, 'retry affordance is visible', failureState.retryVisible === true, { retryText: failureState.retryText, editorActions: failureState.editorActions });
  check(caseResult, 'failed edit does not change the host revision or text', inspectedFailure.revision === beforeState.revision && failureTitle !== null && failureTitle.text === originalText, { expectedRevision: beforeState.revision, actualRevision: inspectedFailure.revision, actualText: failureTitle !== null ? failureTitle.text : null });
  check(caseResult, 'onError reported the persist failure', failureState.onErrors.some((error) => error.code === 'E_PERSIST'), { onErrors: failureState.onErrors });

  // Retry through the real retry button (same submit path as Enter).
  const retryRect = failureState.retryRect;
  check(caseResult, 'retry button has a box to click', retryRect !== null, { actual: retryRect });
  const retryApiMark = ctx.apiLog.length;
  if (retryRect !== null) await page.mouse.click(retryRect.centerX, retryRect.centerY);
  let saved = false;
  try {
    await page.waitForFunction(
      (previous) => {
        const shell = document.querySelector('.dv-canvas-shell');
        const editor = document.querySelector('.dv-inline-editor');
        return shell !== null && shell.getAttribute('data-canvas-revision') !== previous && editor === null;
      },
      { timeout: 30000, polling: 'raf' },
      failureState.revision
    );
    saved = true;
  } catch (_error) {
    saved = false;
  }
  await waitForPhaseReady(page, 20000);
  await sleep(240);
  const savedState = await pageState(page);
  const inspectedSaved = await inspectProject(ctx, projectId);
  const savedTitle = findElement(inspectedSaved, TITLE_ID);
  const retryEdits = ctx.apiLog.slice(retryApiMark).filter((request) => request.method === 'edit');
  const retryOp = retryEdits.length > 0 ? retryEdits[0].params.ops[0] : null;
  check(caseResult, 'retry save succeeds and closes the editor', saved, { revision: savedState.revision, editor: savedState.editor });
  check(caseResult, 'retry save persists exactly the draft', retryOp !== null && retryOp.type === 'text' && retryOp.target === TITLE_ID && retryOp.text === draft, { expectedText: draft, actualOp: retryOp });
  check(caseResult, 'host project text equals the draft after reload', savedTitle !== null && savedTitle.text === draft, { expectedText: draft, actualText: savedTitle !== null ? savedTitle.text : null });
  check(caseResult, 'new revision snapshot loaded after save', savedState.snapshotId !== failureState.snapshotId && savedState.revision === inspectedSaved.revision, { beforeSnapshot: failureState.snapshotId, afterSnapshot: savedState.snapshotId });
  check(caseResult, 'editor actions cleared after success', savedState.retryVisible === false && savedState.toolErrors.length === 0, { retryVisible: savedState.retryVisible, toolErrors: savedState.toolErrors });
  caseResult.finishedAt = new Date().toISOString();
  return caseResult;
}

/** Case 4b: Escape closes without any edit request. */
async function runTextEscapeCase(ctx) {
  const caseResult = newCase('T2', 'inline text Escape sends no write (t=2)');
  const { page } = ctx;
  const projectId = await createFreshProject(ctx, PROJECT_TITLE + ' text escape');
  const inspected = await inspectProject(ctx, projectId);
  const titleElement = findElement(inspected, TITLE_ID);
  const originalText = titleElement !== null ? titleElement.text : null;
  await mountWorkspace(ctx, { projectId, inspected, wrap: { width: 900, height: 400 }, t: 2 });
  const selected = await selectTitle(page, inspected, 2);
  const opened = await openTextEditor(page, selected.selection);
  check(caseResult, 'real double-click gesture opens the inline editor', opened.mode === 'real-double-click', { mode: opened.mode });
  check(caseResult, 'editor open before Escape', opened.state.editor !== null, { editor: opened.state.editor });
  await page.keyboard.type(' DISCARD-ME', { delay: 18 });
  await sleep(120);
  const apiMark = ctx.apiLog.length;
  const pageMark = await page.evaluate(() => window.__CASE__.mark());
  const beforeState = await pageState(page);
  await page.keyboard.press('Escape');
  await sleep(600);
  const state = await pageState(page);
  const inspectedAfter = await inspectProject(ctx, projectId);
  const titleAfter = findElement(inspectedAfter, TITLE_ID);
  const pageRequests = await page.evaluate((mark) => window.__CASE__.requestsSince(mark), pageMark);
  const apiEdits = ctx.apiLog.slice(apiMark).filter((request) => request.method === 'edit');
  check(caseResult, 'Escape closes the editor', state.editor === null, { editor: state.editor });
  check(caseResult, 'Escape sends no request at all', pageRequests.length === 0, { requests: pageRequests });
  check(caseResult, 'Escape performs no host write and no revision change', apiEdits.length === 0 && inspectedAfter.revision === beforeState.revision, { apiEdits: apiEdits.length, beforeRevision: beforeState.revision, afterRevision: inspectedAfter.revision });
  check(caseResult, 'Escape keeps the original host text', titleAfter !== null && titleAfter.text === originalText, { expectedText: originalText, actualText: titleAfter !== null ? titleAfter.text : null });
  check(caseResult, 'Escape leaves no editor actions behind', state.retryVisible === false, { retryVisible: state.retryVisible });
  caseResult.finishedAt = new Date().toISOString();
  return caseResult;
}

/** Case 4c: revision conflict is recoverable, no silent overwrite, two-step save. */
async function runTextConflictCase(ctx) {
  const caseResult = newCase('T3', 'inline text revision conflict recovery (t=2)');
  const { page } = ctx;
  const projectId = await createFreshProject(ctx, PROJECT_TITLE + ' text conflict');
  const inspected = await inspectProject(ctx, projectId);
  const originalText = findElement(inspected, TITLE_ID) !== null ? findElement(inspected, TITLE_ID).text : null;
  await mountWorkspace(ctx, { projectId, inspected, wrap: { width: 900, height: 400 }, t: 2 });
  const selected = await selectTitle(page, inspected, 2);
  const opened = await openTextEditor(page, selected.selection);
  check(caseResult, 'real double-click gesture opens the inline editor', opened.mode === 'real-double-click', { mode: opened.mode });
  await page.keyboard.type(' CONFLICT-DRAFT', { delay: 18 });
  await sleep(120);
  const typedState = await pageState(page);
  const draft = typedState.editor !== null ? typedState.editor.value : null;
  check(caseResult, 'draft typed before conflict', typeof draft === 'string' && draft.includes('CONFLICT-DRAFT'), { draft });
  const beforeState = await pageState(page);

  // Real out-of-band edit through the same staged bridge, as if the AI/session
  // wrote the title while the user was typing.
  const outOfBandText = 'Out-of-band AI edit';
  const outOfBand = await ctx.bridge.invoke('edit', {
    projectId,
    expectedRevision: inspected.revision,
    operationId: 'harness-out-of-band-1',
    ops: [{ type: 'text', target: TITLE_ID, text: outOfBandText }],
  }, { source: 'http' });
  const revisionB = outOfBand.revision;
  const apiMark = ctx.apiLog.length;
  const pageMark = await page.evaluate(() => window.__CASE__.mark());
  await page.keyboard.press('Enter');
  const sawError = await waitForErrorOrActions(page, 15000);
  await sleep(700);
  const conflictState = await pageState(page);
  const inspectedConflict = await inspectProject(ctx, projectId);
  const conflictTitle = findElement(inspectedConflict, TITLE_ID);
  const pageRequests = await page.evaluate((mark) => window.__CASE__.requestsSince(mark), pageMark);
  const apiEdits = ctx.apiLog.slice(apiMark).filter((request) => request.method === 'edit');
  const conflictText = ctx.dictionary['video.error.conflict'];
  check(caseResult, 'conflict surfaces as a visible error', sawError && conflictState.errorVisible, { toolErrors: conflictState.toolErrors });
  check(caseResult, 'conflict error names the stale revision', conflictState.toolErrors.some((text) => typeof text === 'string' && (text.includes(String(conflictText)) || /revision/i.test(text))), { expectedFragment: conflictText, toolErrors: conflictState.toolErrors });
  check(caseResult, 'stale edit request was sent once and rejected by the real Host', apiEdits.length === 1 && pageRequests.filter((request) => request.method === 'edit').length === 1, { apiEdits: apiEdits.length });
  check(caseResult, 'conflict does not silently overwrite the out-of-band text', conflictTitle !== null && conflictTitle.text === outOfBandText, { expectedText: outOfBandText, actualText: conflictTitle !== null ? conflictTitle.text : null });
  check(caseResult, 'conflict keeps the draft and target in the editor', conflictState.editor !== null && conflictState.editor.value === draft, { expectedDraft: draft, actualEditor: conflictState.editor });
  check(caseResult, 'conflict alone does not reload the project revision yet', conflictState.revision === beforeState.revision, { canvasRevision: conflictState.revision, expected: beforeState.revision, outOfBandRevision: revisionB });
  check(caseResult, 'no automatic overwrite retry after the conflict', pageRequests.filter((request) => request.method === 'edit').length === 1, { editRequests: pageRequests.filter((request) => request.method === 'edit') });

  const retryRect = conflictState.retryRect;
  check(caseResult, 'conflict shows the retry affordance', conflictState.retryVisible === true && retryRect !== null, { retryText: conflictState.retryText });
  if (retryRect === null) {
    caseResult.finishedAt = new Date().toISOString();
    return caseResult;
  }
  // First explicit retry after a conflict: refresh only (inspect + reload), no write.
  const refreshApiMark = ctx.apiLog.length;
  const refreshPageMark = await page.evaluate(() => window.__CASE__.mark());
  await page.mouse.click(retryRect.centerX, retryRect.centerY);
  const refreshed = await waitForRevision(page, beforeState.revision, 20000);
  await waitForPhaseReady(page, 20000);
  await sleep(320);
  const refreshedState = await pageState(page);
  const refreshRequests = await page.evaluate((mark) => window.__CASE__.requestsSince(mark), refreshPageMark);
  const refreshEdits = ctx.apiLog.slice(refreshApiMark).filter((request) => request.method === 'edit');
  check(caseResult, 'first retry after conflict refreshes the revision', refreshed && refreshedState.revision === revisionB, { expected: revisionB, actual: refreshedState.revision });
  check(caseResult, 'refresh step sends inspect and no edit', refreshRequests.some((request) => request.method === 'inspect') && refreshEdits.length === 0 && refreshRequests.filter((request) => request.method === 'edit').length === 0, { requests: refreshRequests.map((request) => request.method) });
  check(caseResult, 'draft and editor survive the refresh', refreshedState.editor !== null && refreshedState.editor.value === draft, { expectedDraft: draft, actualEditor: refreshedState.editor });
  check(caseResult, 'refresh clears the error and shows the refreshed hint', refreshedState.toolErrors.length === 0 && refreshedState.hintVisible === true, { toolErrors: refreshedState.toolErrors, toolHints: refreshedState.toolHints });
  check(caseResult, 'refreshed hint text is the staged localization', refreshedState.toolHints.some((text) => typeof text === 'string' && (text === ctx.dictionary['video.canvas.revisionRefreshed'] || text.includes('revisionRefreshed') || (typeof ctx.dictionary['video.canvas.revisionRefreshed'] === 'string' && text.includes(ctx.dictionary['video.canvas.revisionRefreshed'])))), { expected: ctx.dictionary['video.canvas.revisionRefreshed'], actual: refreshedState.toolHints });

  // Second explicit submit saves the draft into the refreshed revision.
  const saveApiMark = ctx.apiLog.length;
  const retryRect2 = refreshedState.retryRect;
  if (retryRect2 !== null) await page.mouse.click(retryRect2.centerX, retryRect2.centerY);
  let saved = false;
  try {
    await page.waitForFunction(
      (previous) => {
        const shell = document.querySelector('.dv-canvas-shell');
        const editor = document.querySelector('.dv-inline-editor');
        return shell !== null && shell.getAttribute('data-canvas-revision') !== previous && editor === null;
      },
      { timeout: 30000, polling: 'raf' },
      revisionB
    );
    saved = true;
  } catch (_error) {
    saved = false;
  }
  await waitForPhaseReady(page, 20000);
  await sleep(240);
  const savedState = await pageState(page);
  const inspectedSaved = await inspectProject(ctx, projectId);
  const savedTitle = findElement(inspectedSaved, TITLE_ID);
  const saveEdits = ctx.apiLog.slice(saveApiMark).filter((request) => request.method === 'edit');
  const saveOp = saveEdits.length > 0 ? saveEdits[0].params.ops[0] : null;
  check(caseResult, 'second explicit submit saves the draft', saved, { revision: savedState.revision, editor: savedState.editor });
  check(caseResult, 'save request uses the refreshed revision', saveEdits.length === 1 && saveEdits[0].params.expectedRevision === revisionB, { expectedRevision: revisionB, actualRevision: saveEdits.length > 0 ? saveEdits[0].params.expectedRevision : null });
  check(caseResult, 'saved text equals the user draft', savedTitle !== null && savedTitle.text === draft && saveOp !== null && saveOp.text === draft, { expectedText: draft, actualText: savedTitle !== null ? savedTitle.text : null });
  caseResult.finishedAt = new Date().toISOString();
  return caseResult;
}

// ─── R5-follow-up: write succeeded, response lost, explicit recovery ───────

function editRequestsBetween(ctx, mark) {
  return ctx.apiLog.slice(mark).filter((request) => request.method === 'edit');
}

function editTextOf(request) {
  if (request === null || request === undefined) return null;
  const params = request.params;
  if (params === null || typeof params !== 'object' || Array.isArray(params.ops) === false) return null;
  const op = params.ops[0];
  return op !== null && typeof op === 'object' && op.type === 'text' && typeof op.text === 'string' ? op.text : null;
}

/** Immutable identity of one edit attempt: expectedRevision + operationId + ops. */
function editRequestSignature(request) {
  if (request === null || request === undefined) return null;
  const params = request.params || {};
  return JSON.stringify({
    projectId: params.projectId,
    expectedRevision: params.expectedRevision,
    operationId: params.operationId,
    ops: params.ops,
  });
}

function editRequestSummary(request) {
  if (request === null || request === undefined) return null;
  const params = request.params || {};
  return {
    operationId: params.operationId,
    expectedRevision: params.expectedRevision,
    ops: params.ops,
    responseStatus: request.responseStatus,
    responseErrorCode: request.responseErrorCode,
    responseRevision: request.responseRevision,
  };
}

async function waitForHostRevisionChange(ctx, projectId, previousRevision, timeout) {
  const deadline = Date.now() + (timeout || 15000);
  let inspected = await inspectProject(ctx, projectId);
  while (Date.now() < deadline) {
    if (inspected.revision !== previousRevision) return inspected;
    await sleep(100);
    inspected = await inspectProject(ctx, projectId);
  }
  return inspected;
}

async function waitForCanvasRevision(page, expectedRevision, timeout) {
  try {
    await page.waitForFunction(
      (expected) => {
        const shell = document.querySelector('.dv-canvas-shell');
        return shell !== null && shell.getAttribute('data-canvas-revision') === expected;
      },
      { timeout, polling: 'raf' },
      expectedRevision
    );
    return true;
  } catch (_error) {
    return false;
  }
}

async function waitForEditorClosed(page, timeout) {
  try {
    await page.waitForFunction(
      () => document.querySelector('.dv-inline-editor') === null,
      { timeout, polling: 'raf' }
    );
    return true;
  } catch (_error) {
    return false;
  }
}

/**
 * Shared T4 setup: type a draft, inject a lost-response failure that FIRST
 * forwards the edit to the real staged Host (real worker write) and only then
 * reports a lost/uncertain transport result to the page.
 */
async function beginLostResponseAttempt(ctx, caseResult, options) {
  const { page } = ctx;
  const projectId = await createFreshProject(ctx, options.projectTitle);
  const inspected = await inspectProject(ctx, projectId);
  const titleElement = findElement(inspected, TITLE_ID);
  const originalText = titleElement !== null ? titleElement.text : null;
  await mountWorkspace(ctx, { projectId, inspected, wrap: { width: 900, height: 400 }, t: 2 });
  const selected = await selectTitle(page, inspected, 2);
  const opened = await openTextEditor(page, selected.selection);
  check(caseResult, 'real double-click gesture opens the inline editor', opened.mode === 'real-double-click', { mode: opened.mode });
  const initialValue = opened.state.editor !== null ? opened.state.editor.value : null;
  check(caseResult, 'editor opens with the current host text', initialValue === originalText, { originalText, editorValue: initialValue });
  await page.keyboard.type(options.draftSuffix, { delay: 18 });
  await sleep(140);
  let state = await pageState(page);
  const draft = state.editor !== null ? state.editor.value : null;
  check(caseResult, 'keyboard typing updates the draft', typeof draft === 'string' && draft !== initialValue, { draft });

  const revisionA = inspected.revision;
  const apiMark = ctx.apiLog.length;
  const pageMark = await page.evaluate(() => window.__CASE__.mark());
  await page.evaluate((spec) => window.__CASE__.inject(spec), {
    method: 'edit',
    kind: 'lost-response',
    code: 'E_TRANSPORT',
    message: 'response lost after Host commit',
    uncertain: true,
    times: 1,
  });
  await page.keyboard.press('Enter');
  // The response is only lost AFTER the real Host/worker write: wait for the
  // authoritative revision to advance before reading the page-side failure.
  const writtenInspected = await waitForHostRevisionChange(ctx, projectId, revisionA, 20000);
  const sawError = await waitForErrorOrActions(page, 15000);
  await sleep(650);
  state = await pageState(page);
  const pageRequests = await page.evaluate((mark) => window.__CASE__.requestsSince(mark), pageMark);
  const apiEdits = editRequestsBetween(ctx, apiMark);
  const injected = await page.evaluate(() => window.__CASE__.injectionState());
  const firstRequest = apiEdits.length > 0 ? apiEdits[0] : null;
  const pageEditRequests = pageRequests.filter((request) => request.method === 'edit');
  const revisionB = writtenInspected.revision;
  const writtenTitle = findElement(writtenInspected, TITLE_ID);
  const writtenText = writtenTitle !== null ? writtenTitle.text : null;
  const setup = {
    page,
    projectId,
    inspected,
    originalText,
    initialValue,
    draft,
    revisionA,
    revisionB,
    writtenText,
    sawError,
    failureState: state,
    pageRequests,
    pageEditRequests,
    injected,
    apiEdits,
    firstRequest,
    operationId: firstRequest !== null ? firstRequest.params.operationId : null,
    signature: editRequestSignature(firstRequest),
    apiMark,
  };

  check(caseResult, 'real Host/worker write completed BEFORE the response was lost', setup.revisionB !== revisionA
    && setup.writtenText === draft, { revisionA, revisionB: setup.revisionB, expectedText: draft, actualText: setup.writtenText });
  check(caseResult, 'lost-response injection consumed exactly once and only after a real Host response', injected.length === 1
    && injected[0].kind === 'lost-response'
    && injected[0].hits === 1
    && pageEditRequests.length === 1
    && pageEditRequests[0].injected === 'LOST_RESPONSE'
    && pageEditRequests[0].realStatus === 200
    && pageEditRequests[0].realOk === true
    && pageEditRequests[0].realRevision === setup.revisionB
    && pageEditRequests[0].responseDiscarded === true, {
    injected,
    pageEditRequests: pageEditRequests.map((request) => ({
      injected: request.injected,
      realStatus: request.realStatus,
      realOk: request.realOk,
      realRevision: request.realRevision,
      responseDiscarded: request.responseDiscarded,
    })),
    revisionB: setup.revisionB,
  });
  check(caseResult, 'exactly one edit request reached the real Host for the lost attempt', apiEdits.length === 1, { actual: apiEdits.length });
  check(caseResult, 'frozen attempt body captured (operationId / expectedRevision=pre-write revision / draft ops)', setup.firstRequest !== null
    && typeof setup.operationId === 'string'
    && setup.operationId.length > 0
    && setup.firstRequest.params.expectedRevision === revisionA
    && editTextOf(setup.firstRequest) === draft, { operationId: setup.operationId, expectedRevision: setup.firstRequest !== null ? setup.firstRequest.params.expectedRevision : null, revisionA, opsText: editTextOf(setup.firstRequest), draft });
  check(caseResult, 'UI shows the lost-response failure and keeps the textarea with the draft', sawError
    && state.errorVisible === true
    && state.editor !== null
    && state.editor.value === draft, { sawError, toolErrors: state.toolErrors, editor: state.editor, draft });
  check(caseResult, 'retry affordance is visible (no Esc/reopen needed)', state.retryVisible === true, { retryText: state.retryText, editorActions: state.editorActions });
  check(caseResult, 'no automatic replay after the lost response', apiEdits.length === 1 && pageEditRequests.length === 1, { apiEdits: apiEdits.length, pageEdits: pageEditRequests.length });
  check(caseResult, 'no E_OPERATION_REUSED response for the lost attempt', setup.firstRequest !== null && setup.firstRequest.responseErrorCode !== 'E_OPERATION_REUSED', { actual: setup.firstRequest !== null ? setup.firstRequest.responseErrorCode : null });
  caseResult.diagnostics = {
    projectId,
    revisionA,
    revisionB: setup.revisionB,
    operationId: setup.operationId,
    lostResponseRequest: editRequestSummary(setup.firstRequest),
  };
  return setup;
}

/** T4A: unchanged retained draft -> exact frozen retry applies once, editor closes. */
async function runLostResponseUnchangedRetryCase(ctx) {
  const caseResult = newCase('T4A', 'write succeeded + response lost -> unchanged draft exact retry applies once (t=2)');
  const setup = await beginLostResponseAttempt(ctx, caseResult, {
    projectTitle: PROJECT_TITLE + ' lost response unchanged',
    draftSuffix: ' LOST-RESPONSE-DRAFT',
  });
  const { page, failureState } = setup;

  const retryApiMark = ctx.apiLog.length;
  const retryPageMark = await page.evaluate(() => window.__CASE__.mark());
  if (failureState.retryRect !== null) {
    await page.mouse.click(failureState.retryRect.centerX, failureState.retryRect.centerY);
  } else {
    await page.keyboard.press('Enter');
  }
  const closed = await waitForEditorClosed(page, 20000);
  const revisionRendered = await waitForCanvasRevision(page, setup.revisionB, 20000);
  await waitForPhaseReady(page, 20000);
  await sleep(300);
  const state = await pageState(page);
  const inspected = await inspectProject(ctx, setup.projectId);
  const title = findElement(inspected, TITLE_ID);
  const retryEdits = editRequestsBetween(ctx, retryApiMark);
  const retryPageRequests = await page.evaluate((mark) => window.__CASE__.requestsSince(mark), retryPageMark);
  const retryRequest = retryEdits.length > 0 ? retryEdits[0] : null;

  check(caseResult, 'explicit retry closes the editor', closed, { editor: state.editor });
  check(caseResult, 'exactly one retry edit request', retryEdits.length === 1, { actual: retryEdits.length });
  check(caseResult, 'retry re-sends the IDENTICAL frozen request (operationId / expectedRevision / ops)',
    retryRequest !== null
    && editRequestSignature(retryRequest) === setup.signature
    && retryRequest.params.operationId === setup.operationId
    && retryRequest.params.expectedRevision === setup.revisionA
    && editTextOf(retryRequest) === setup.draft,
    { frozen: { operationId: setup.operationId, expectedRevision: setup.revisionA, text: setup.draft }, retried: editRequestSummary(retryRequest) });
  check(caseResult, 'retry is served by the real Host as a settled cached success', retryRequest !== null
    && retryRequest.responseStatus === 200
    && retryRequest.responseErrorCode === null, { actual: retryRequest !== null ? { responseStatus: retryRequest.responseStatus, responseErrorCode: retryRequest.responseErrorCode } : null });
  check(caseResult, 'no E_OPERATION_REUSED response anywhere in the case', ctx.apiLog.slice(setup.apiMark).every((request) => request.method !== 'edit' || request.responseErrorCode !== 'E_OPERATION_REUSED'), { editResponses: ctx.apiLog.slice(setup.apiMark).filter((request) => request.method === 'edit').map((request) => ({ operationId: request.params.operationId, expectedRevision: request.params.expectedRevision, responseStatus: request.responseStatus, responseErrorCode: request.responseErrorCode })) });
  check(caseResult, 'worker applied the write exactly once (retry returns the same revision, no new commit)', inspected.revision === setup.revisionB
    && state.revision === setup.revisionB, { revisionAfterLostWrite: setup.revisionB, revisionAfterRetry: inspected.revision, canvasRevision: state.revision });
  check(caseResult, 'committed text equals the draft after the explicit retry', title !== null && title.text === setup.draft, { expectedText: setup.draft, actualText: title !== null ? title.text : null });
  check(caseResult, 'new revision snapshot loaded and the error is cleared', revisionRendered && state.snapshotId !== failureState.snapshotId && state.toolErrors.length === 0, { revisionRendered, beforeSnapshot: failureState.snapshotId, afterSnapshot: state.snapshotId, toolErrors: state.toolErrors });
  check(caseResult, 'single editor lifetime (no Esc/reopen workaround)', state.editorMountCount === 1, { editorMountCount: state.editorMountCount });
  caseResult.diagnostics.retryRequest = editRequestSummary(retryRequest);
  caseResult.diagnostics.retryPageRequests = retryPageRequests.map((request) => ({ method: request.method, injected: request.injected }));
  caseResult.diagnostics.editorMountCount = state.editorMountCount;
  caseResult.finishedAt = new Date().toISOString();
  return caseResult;
}

/** Replace the retained draft with new text using real keyboard input. */
async function retypeRetainedDraft(page, editor, newText) {
  const screen = editor.rect !== null && editor.rect.screen !== undefined ? editor.rect.screen : null;
  if (screen === null) throw new Error('inline editor has no screen rect to focus');
  const centerX = screen.left + screen.width / 2;
  const centerY = screen.top + screen.height / 2;
  await page.mouse.click(centerX, centerY);
  await sleep(180);
  // Triple-click is the real-gesture select-all for a textarea (Chrome). If the
  // platform does not select, the typed suffix appends; the actual retained
  // value is read back and used verbatim as the new text.
  await page.mouse.click(centerX, centerY, { count: 3 });
  await sleep(160);
  await page.keyboard.type(newText, { delay: 14 });
  await sleep(200);
  const state = await pageState(page);
  return state.editor !== null ? state.editor.value : null;
}

/** T4B: modified retained draft -> settle frozen attempt, then new id/revision commit. */
async function runLostResponseModifiedDraftCase(ctx) {
  const caseResult = newCase('T4B', 'write succeeded + response lost -> modified retained draft settles then commits new text (t=2)');
  const setup = await beginLostResponseAttempt(ctx, caseResult, {
    projectTitle: PROJECT_TITLE + ' lost response modified',
    draftSuffix: ' LOST-ORIGINAL-DRAFT',
  });
  const { page, failureState } = setup;
  const newDraft = 'P3-008 Harness T4B NEW-TEXT';

  const newValue = await retypeRetainedDraft(page, failureState.editor, newDraft);
  const editorState = await pageState(page);
  check(caseResult, 'retained draft modified by real keyboard input (same editor, no reopen)', editorState.editor !== null
    && typeof newValue === 'string'
    && newValue !== setup.draft
    && newValue.includes(newDraft), { oldDraft: setup.draft, newValue, replacement: newValue === newDraft, editorMountCount: editorState.editorMountCount });
  check(caseResult, 'modifying the draft did not reopen the editor', editorState.editorMountCount === 1, { editorMountCount: editorState.editorMountCount });

  const submitApiMark = ctx.apiLog.length;
  const submitPageMark = await page.evaluate(() => window.__CASE__.mark());
  await page.keyboard.press('Enter');
  const closed = await waitForEditorClosed(page, 25000);
  const interimEdits = editRequestsBetween(ctx, submitApiMark);
  const expectedFinalRevision = interimEdits.length > 1 && interimEdits[1].responseRevision !== null && interimEdits[1].responseRevision !== undefined
    ? interimEdits[1].responseRevision
    : null;
  if (expectedFinalRevision !== null) await waitForCanvasRevision(page, expectedFinalRevision, 25000);
  await waitForPhaseReady(page, 25000);
  await sleep(320);
  const state = await pageState(page);
  const inspected = await inspectProject(ctx, setup.projectId);
  const title = findElement(inspected, TITLE_ID);
  const submitEdits = editRequestsBetween(ctx, submitApiMark);
  const submitPageRequests = await page.evaluate((mark) => window.__CASE__.requestsSince(mark), submitPageMark);
  const settleRequest = submitEdits.length > 0 ? submitEdits[0] : null;
  const newRequest = submitEdits.length > 1 ? submitEdits[1] : null;

  check(caseResult, 'submitting the modified draft closes the editor (no Esc/reopen)', closed, { editor: state.editor });
  check(caseResult, 'exactly two edit requests: freeze/settle first, then the new intent', submitEdits.length === 2, { actual: submitEdits.length, requests: submitEdits.map(editRequestSummary) });
  check(caseResult, 'first request is the IDENTICAL frozen attempt (same operationId / expectedRevision / ops)', settleRequest !== null
    && editRequestSignature(settleRequest) === setup.signature
    && settleRequest.params.operationId === setup.operationId
    && settleRequest.params.expectedRevision === setup.revisionA
    && editTextOf(settleRequest) === setup.draft, { frozenSignature: setup.signature, frozenOperationId: setup.operationId, settle: editRequestSummary(settleRequest) });
  check(caseResult, 'settle request is a real cached Host success, not a failure', settleRequest !== null
    && settleRequest.responseStatus === 200
    && settleRequest.responseErrorCode === null, { settle: settleRequest !== null ? { responseStatus: settleRequest.responseStatus, responseErrorCode: settleRequest.responseErrorCode, responseRevision: settleRequest.responseRevision } : null });
  check(caseResult, 'second request uses a NEW operationId with the new text', newRequest !== null
    && typeof newRequest.params.operationId === 'string'
    && newRequest.params.operationId !== setup.operationId
    && newRequest.params.ops !== undefined
    && Array.isArray(newRequest.params.ops)
    && newRequest.params.ops[0] !== undefined
    && newRequest.params.ops[0].text === newValue, { originalOperationId: setup.operationId, newRequest: editRequestSummary(newRequest), expectedText: newValue });
  check(caseResult, 'second request uses the settled revision as expectedRevision', newRequest !== null
    && newRequest.params.expectedRevision === setup.revisionB, { expectedRevision: setup.revisionB, actual: newRequest !== null ? newRequest.params.expectedRevision : null });
  check(caseResult, 'new-intent request succeeds and commits a new revision', newRequest !== null
    && newRequest.responseStatus === 200
    && newRequest.responseErrorCode === null
    && newRequest.responseRevision !== null
    && newRequest.responseRevision !== setup.revisionB, { newRequest: newRequest !== null ? { responseStatus: newRequest.responseStatus, responseErrorCode: newRequest.responseErrorCode, responseRevision: newRequest.responseRevision } : null });
  check(caseResult, 'no E_OPERATION_REUSED response anywhere in the case', ctx.apiLog.slice(setup.apiMark).every((request) => request.method !== 'edit' || request.responseErrorCode !== 'E_OPERATION_REUSED'), { editResponses: ctx.apiLog.slice(setup.apiMark).filter((request) => request.method === 'edit').map((request) => ({ operationId: request.params.operationId, expectedRevision: request.params.expectedRevision, responseStatus: request.responseStatus, responseErrorCode: request.responseErrorCode })) });
  check(caseResult, 'final committed text is the NEW text', title !== null && title.text === newValue, { expectedText: newValue, actualText: title !== null ? title.text : null });
  check(caseResult, 'canvas renders the new revision with the save applied', state.revision === inspected.revision && state.revision !== setup.revisionB, { canvasRevision: state.revision, hostRevision: inspected.revision, settledRevision: setup.revisionB });
  check(caseResult, 'error cleared and single editor lifetime', state.toolErrors.length === 0 && state.editorMountCount === 1 && state.retryVisible === false, { toolErrors: state.toolErrors, editorMountCount: state.editorMountCount, retryVisible: state.retryVisible });
  caseResult.diagnostics.settleRequest = editRequestSummary(settleRequest);
  caseResult.diagnostics.newRequest = editRequestSummary(newRequest);
  caseResult.diagnostics.newDraft = newValue;
  caseResult.diagnostics.finalRevision = inspected.revision;
  caseResult.diagnostics.submitPageRequests = submitPageRequests.map((request) => ({ method: request.method, injected: request.injected }));
  caseResult.finishedAt = new Date().toISOString();
  return caseResult;
}

/**
 * T4C: uncertain attempt + concurrent out-of-band revision change.
 *
 * Deterministic real-worker flow (fixed client):
 *   1. lost response after a real write => frozen attempt (O1, expectedRevision A, text D1),
 *      worker revision B and draft D1 retained in the UI;
 *   2. out-of-band write => revision C (title = out-of-band text);
 *   3. user changes the retained draft to D2 and submits: the fixed client first
 *      re-sends the frozen attempt (cached success B, applied once), then starts a
 *      NEW intent (new operationId O2, expectedRevision = settled B, text D2),
 *      which the real worker rejects with E_REVISION_CONFLICT because C is current;
 *   4. explicit refresh (inspect only) makes C authoritative and keeps the draft;
 *   5. explicit submit sends a third attempt (O3, expectedRevision C, text D2) and
 *      commits revision D. No E_OPERATION_REUSED, no Esc/reopen, no silent overwrite.
 */
async function runLostResponseConflictRecoveryCase(ctx) {
  const caseResult = newCase('T4C', 'write succeeded + response lost -> concurrent revision conflict explicit recovery (t=2)');
  const setup = await beginLostResponseAttempt(ctx, caseResult, {
    projectTitle: PROJECT_TITLE + ' lost response conflict',
    draftSuffix: ' LOST-CONFLICT-DRAFT',
  });
  const { page, failureState } = setup;
  const newDraft = 'P3-008 Harness T4C AFTER-CONFLICT';

  // Real concurrent write through the same staged bridge (AI/session editing).
  const outOfBandText = 'Out-of-band concurrent edit';
  const outOfBand = await ctx.bridge.invoke('edit', {
    projectId: setup.projectId,
    expectedRevision: setup.revisionB,
    operationId: 'harness-t4c-out-of-band-1',
    ops: [{ type: 'text', target: TITLE_ID, text: outOfBandText }],
  }, { source: 'http' });
  const revisionC = outOfBand.revision;
  const afterOutOfBand = await inspectProject(ctx, setup.projectId);
  const afterOutOfBandTitle = findElement(afterOutOfBand, TITLE_ID);
  check(caseResult, 'real out-of-band write advanced the project after the lost attempt', revisionC !== setup.revisionB
    && afterOutOfBandTitle !== null
    && afterOutOfBandTitle.text === outOfBandText, { revisionB: setup.revisionB, revisionC, title: afterOutOfBandTitle !== null ? afterOutOfBandTitle.text : null });

  const newValue = await retypeRetainedDraft(page, failureState.editor, newDraft);
  const editorState = await pageState(page);
  check(caseResult, 'retained draft changed after the uncertain attempt (same editor)', editorState.editor !== null
    && typeof newValue === 'string'
    && newValue !== setup.draft
    && newValue.includes(newDraft)
    && editorState.editorMountCount === 1, { oldDraft: setup.draft, newValue, editorMountCount: editorState.editorMountCount });

  const submitApiMark = ctx.apiLog.length;
  const submitPageMark = await page.evaluate(() => window.__CASE__.mark());
  await page.keyboard.press('Enter');
  const sawConflict = await waitForErrorOrActions(page, 20000);
  await sleep(900);
  const conflictState = await pageState(page);
  const conflictEdits = editRequestsBetween(ctx, submitApiMark);
  const conflictPageRequests = await page.evaluate((mark) => window.__CASE__.requestsSince(mark), submitPageMark);
  const settleRequest = conflictEdits.length > 0 ? conflictEdits[0] : null;
  const newIntentRequest = conflictEdits.length > 1 ? conflictEdits[1] : null;
  const conflictInspect = await inspectProject(ctx, setup.projectId);
  const conflictTitle = findElement(conflictInspect, TITLE_ID);

  check(caseResult, 'submit settles the frozen attempt first, then sends the new intent', conflictEdits.length === 2, { actual: conflictEdits.length, requests: conflictEdits.map(editRequestSummary) });
  check(caseResult, 'settle request is the IDENTICAL frozen attempt and a real cached success', settleRequest !== null
    && editRequestSignature(settleRequest) === setup.signature
    && settleRequest.params.operationId === setup.operationId
    && settleRequest.params.expectedRevision === setup.revisionA
    && editTextOf(settleRequest) === setup.draft
    && settleRequest.responseStatus === 200
    && settleRequest.responseErrorCode === null
    && settleRequest.responseRevision === setup.revisionB, { frozenOperationId: setup.operationId, frozenRevision: setup.revisionA, settle: editRequestSummary(settleRequest) });
  check(caseResult, 'new intent uses a new operationId, the settled revision and the new text', newIntentRequest !== null
    && newIntentRequest.params.operationId !== setup.operationId
    && newIntentRequest.params.expectedRevision === setup.revisionB
    && editTextOf(newIntentRequest) === newValue, { originalOperationId: setup.operationId, settledRevision: setup.revisionB, newIntent: editRequestSummary(newIntentRequest), expectedText: newValue });
  check(caseResult, 'concurrent revision turns the new intent into a real E_REVISION_CONFLICT', newIntentRequest !== null
    && newIntentRequest.responseStatus === 409
    && newIntentRequest.responseErrorCode === 'E_REVISION_CONFLICT', { actual: newIntentRequest !== null ? { responseStatus: newIntentRequest.responseStatus, responseErrorCode: newIntentRequest.responseErrorCode } : null, revisionC });
  check(caseResult, 'conflict is visible and the changed draft survives', sawConflict && conflictState.errorVisible === true
    && conflictState.editor !== null && conflictState.editor.value === newValue, { toolErrors: conflictState.toolErrors, editor: conflictState.editor });
  check(caseResult, 'no silent overwrite of the out-of-band text', conflictTitle !== null && conflictTitle.text === outOfBandText, { expectedText: outOfBandText, actualText: conflictTitle !== null ? conflictTitle.text : null });
  check(caseResult, 'no automatic replay/refresh after the conflict', conflictEdits.length === 2
    && conflictPageRequests.filter((request) => request.method === 'edit').length === 2, { editRequests: conflictEdits.length, pageRequests: conflictPageRequests.map((request) => request.method) });
  check(caseResult, 'no E_OPERATION_REUSED response anywhere in T4C', ctx.apiLog.slice(setup.apiMark).every((request) => request.method !== 'edit' || request.responseErrorCode !== 'E_OPERATION_REUSED'), { editResponses: ctx.apiLog.slice(setup.apiMark).filter((request) => request.method === 'edit').map((request) => ({ operationId: request.params.operationId, expectedRevision: request.params.expectedRevision, responseStatus: request.responseStatus, responseErrorCode: request.responseErrorCode })) });

  // Explicit step 1: refresh only (no write), keep the draft, show the notice.
  const conflictRetryRect = conflictState.retryRect;
  check(caseResult, 'conflict exposes the explicit retry affordance', conflictRetryRect !== null && conflictState.retryVisible === true, { retryText: conflictState.retryText });
  if (conflictRetryRect === null) {
    caseResult.finishedAt = new Date().toISOString();
    return caseResult;
  }
  const refreshApiMark = ctx.apiLog.length;
  const refreshPageMark = await page.evaluate(() => window.__CASE__.mark());
  await page.mouse.click(conflictRetryRect.centerX, conflictRetryRect.centerY);
  const refreshedRevisionRendered = await waitForCanvasRevision(page, revisionC, 20000);
  await waitForPhaseReady(page, 20000);
  await sleep(320);
  const refreshedState = await pageState(page);
  const refreshEdits = editRequestsBetween(ctx, refreshApiMark);
  const refreshPageRequests = await page.evaluate((mark) => window.__CASE__.requestsSince(mark), refreshPageMark);
  check(caseResult, 'first explicit retry refreshes only (inspect, no edit) to the concurrent revision', refreshedRevisionRendered
    && refreshEdits.length === 0
    && refreshPageRequests.some((request) => request.method === 'inspect'), { revisionC, canvasRevision: refreshedState.revision, requests: refreshPageRequests.map((request) => request.method) });
  check(caseResult, 'refresh keeps the changed draft and clears the conflict error', refreshedState.editor !== null
    && refreshedState.editor.value === newValue
    && refreshedState.toolErrors.length === 0
    && refreshedState.hintVisible === true, { editor: refreshedState.editor, toolErrors: refreshedState.toolErrors, toolHints: refreshedState.toolHints });

  // Explicit step 2: a third, fresh attempt at the refreshed revision commits D2.
  const saveApiMark = ctx.apiLog.length;
  const saveRetryRect = refreshedState.retryRect;
  if (saveRetryRect !== null) await page.mouse.click(saveRetryRect.centerX, saveRetryRect.centerY);
  else await page.keyboard.press('Enter');
  const savedClosed = await waitForEditorClosed(page, 25000);
  const saveEditsProbe = editRequestsBetween(ctx, saveApiMark);
  const expectedFinalRevision = saveEditsProbe.length > 0 && saveEditsProbe[0].responseRevision !== null && saveEditsProbe[0].responseRevision !== undefined
    ? saveEditsProbe[0].responseRevision
    : null;
  if (expectedFinalRevision !== null) await waitForCanvasRevision(page, expectedFinalRevision, 25000);
  await waitForPhaseReady(page, 25000);
  await sleep(320);
  const savedState = await pageState(page);
  const savedInspect = await inspectProject(ctx, setup.projectId);
  const savedTitle = findElement(savedInspect, TITLE_ID);
  const saveEdits = editRequestsBetween(ctx, saveApiMark);
  const saveRequest = saveEdits.length > 0 ? saveEdits[0] : null;
  const allOperationIds = ctx.apiLog.slice(setup.apiMark).filter((request) => request.method === 'edit').map((request) => request.params.operationId);

  check(caseResult, 'explicit submit after refresh closes the editor', savedClosed, { editor: savedState.editor });
  check(caseResult, 'exactly one final edit request with the refreshed revision and the changed draft', saveEdits.length === 1
    && saveRequest.params.expectedRevision === revisionC
    && editTextOf(saveRequest) === newValue, { expectedRevision: revisionC, actual: editRequestSummary(saveRequest), expectedText: newValue });
  check(caseResult, 'final attempt uses a third distinct operationId and succeeds', saveRequest !== null
    && saveRequest.params.operationId !== setup.operationId
    && saveRequest.responseStatus === 200
    && saveRequest.responseErrorCode === null
    && saveRequest.responseRevision !== null
    && saveRequest.responseRevision !== revisionC, { saveRequest: editRequestSummary(saveRequest), revisionC });
  const uniqueOperationIds = [...new Set(allOperationIds)];
  check(caseResult, 'three immutable attempts with distinct ids (the frozen replay reuses attempt 1\'s id)', allOperationIds.length === 4
    && uniqueOperationIds.length === 3
    && allOperationIds[0] === setup.operationId
    && allOperationIds[1] === setup.operationId
    && allOperationIds[2] !== setup.operationId
    && allOperationIds[3] !== setup.operationId
    && allOperationIds[2] !== allOperationIds[3], { requests: ctx.apiLog.slice(setup.apiMark).filter((request) => request.method === 'edit').map((request) => ({ operationId: request.params.operationId, expectedRevision: request.params.expectedRevision, responseStatus: request.responseStatus, responseErrorCode: request.responseErrorCode })) });
  check(caseResult, 'final committed text is the changed draft', savedTitle !== null && savedTitle.text === newValue, { expectedText: newValue, actualText: savedTitle !== null ? savedTitle.text : null });
  check(caseResult, 'canvas renders the final revision and the editor stays single-lifetime', savedState.revision === savedInspect.revision
    && savedState.revision !== revisionC
    && savedState.editorMountCount === 1
    && savedState.toolErrors.length === 0, { canvasRevision: savedState.revision, hostRevision: savedInspect.revision, editorMountCount: savedState.editorMountCount, toolErrors: savedState.toolErrors });

  caseResult.diagnostics.revisionB = setup.revisionB;
  caseResult.diagnostics.revisionC = revisionC;
  caseResult.diagnostics.finalRevision = savedInspect.revision;
  caseResult.diagnostics.operationIds = allOperationIds;
  caseResult.diagnostics.settleRequest = editRequestSummary(settleRequest);
  caseResult.diagnostics.conflictNewIntentRequest = editRequestSummary(newIntentRequest);
  caseResult.diagnostics.finalRequest = editRequestSummary(saveRequest);
  caseResult.diagnostics.newDraft = newValue;
  caseResult.finishedAt = new Date().toISOString();
  return caseResult;
}

// ─── main ──────────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const staging = resolve(args.staging);
  const evidence = {
    kind: 'p3-008-canvas-workspace-browser',
    startedAt: new Date().toISOString(),
    staging,
    command: 'node scripts/test-canvas-workspace.mjs ' + process.argv.slice(2).join(' '),
    cases: [],
    requests: [],
    network: null,
    teardown: null,
    stagingReadOnly: null,
  };
  let ok = false;
  let server = null;
  let browser = null;
  let bridge = null;
  let stateRoot = null;
  let staged = null;
  let stagingSourcesBefore = null;
  const consoleMessages = [];
  const pageErrors = [];
  const requestFailures = [];
  const networkRequests = [];
  const apiLog = [];
  const serverLog = [];
  const caseFilter = args.caseFilter === null || args.caseFilter === undefined || args.caseFilter === ''
    ? null
    : args.caseFilter.split(',').map((value) => value.trim()).filter((value) => value.length > 0);

  try {
    staged = await loadStagedHost(staging);
    const stagingRoot = staged.evidence.staging;
    stagingSourcesBefore = await listStagingSources(stagingRoot);
    evidence.rootCommit = staged.integrity.rootCommit;
    evidence.engineCommit = staged.integrity.engineCommit;
    evidence.versions = staged.integrity.versions;
    evidence.browserPath = staged.integrity.browser;
    evidence.stagingSourceCount = stagingSourcesBefore.length;
    evidence.host = staged.evidence;

    // Verify the staged bytes really are the bytes INTEGRITY records for the
    // bundle code we execute, then extract by marker.
    const integrityFiles = Array.isArray(staged.integrity.files?.bundle) ? staged.integrity.files.bundle : [];
    const recordedClient = integrityFiles.find((entry) => entry !== null && entry.path === 'client.js');
    const clientPath = join(stagingRoot, 'bundle', 'client.js');
    const clientSource = await readFile(clientPath, 'utf8');
    const clientSha = sha256(Buffer.from(clientSource, 'utf8'));
    assert(recordedClient !== undefined, 'INTEGRITY.files.bundle does not record client.js');
    assert(recordedClient.sha256 === clientSha, 'staged client.js sha256 does not match INTEGRITY.json');
    const extraction = extractStagedSource(clientSource);
    evidence.extraction = { ...extraction.evidence, integrityClientSha256: recordedClient.sha256, clientVerified: true };
    evidence.testPage = {
      stageOverride: 'removed — the staged client.js scopes .dv-stage.dv-canvas-stage{display:block;flex:none;padding:0}, so the stage box must equal composition x letterbox scale without test-page compensation',
      wrapOverride: 'forced explicit .dv-canvas-wrap width/height (letterbox sizes under test) and disabled the panel entrance animation for stable geometry',
    };

    const rendererModuleSource = await readFile(join(LIB_DIR, 'react-dom-lite.mjs'), 'utf8');
    const rendererSource = rendererPageSource(rendererModuleSource);
    const pageHtml = await readFile(join(LIB_DIR, 'canvas-harness-page.html'), 'utf8');
    const pageGlue = await readFile(join(LIB_DIR, 'canvas-harness-page.js'), 'utf8');
    const harnessScriptBytes = await readFile(fileURLToPath(import.meta.url));
    evidence.harness = {
      note: 'sha256 of the harness files actually executed (working tree; scripts-only follow-up may differ from the staged root commit).',
      files: {
        'scripts/test-canvas-workspace.mjs': sha256(harnessScriptBytes),
        'scripts/lib/react-dom-lite.mjs': sha256(Buffer.from(rendererModuleSource, 'utf8')),
        'scripts/lib/canvas-harness-page.js': sha256(Buffer.from(pageGlue, 'utf8')),
        'scripts/lib/canvas-harness-page.html': sha256(Buffer.from(pageHtml, 'utf8')),
      },
    };
    assert(pageHtml.includes('/harness/page.js'), 'harness page HTML is missing its scripts');

    stateRoot = await prepareStateRoot(stagingRoot, staged.config);
    evidence.stateRoot = stateRoot.base;
    evidence.configRedirection = {
      note: 'The verified staging tree is read-only for this run; all mutable bridge/worker state lives in the recorded temp directory.',
      redirected: ['registryPath', 'artifactRoot', 'projectsRoot', 'assetInboxRoot', 'sessionStatePath', 'sessionCwd'],
      stagedConfigSha256: staged.integrity.config?.sha256,
    };

    const host = fakeCtx();
    bridge = new staged.VideoBridge({ ctx: host.ctx, rawConfig: stateRoot.config });
    const routesModule = await import(pathToFileURL(join(stagingRoot, 'bundle', 'host', 'routes.js')).href);
    assert(typeof routesModule.createRequestRoute === 'function', 'staged host/routes.js has no createRequestRoute');
    const requestRoute = routesModule.createRequestRoute(bridge);

    let origin = '';
    server = createServer(async (request, response) => {
      const requestPath = (() => {
        try {
          return new URL(request.url, 'http://127.0.0.1').pathname;
        } catch (_error) {
          return '';
        }
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
          if (requestPath === '/harness/canvas-module.js') {
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
            response.end(JSON.stringify(extraction.EN));
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
          try {
            parsed = JSON.parse(bodyBuffer.toString('utf8'));
          } catch (_error) {
            parsed = null;
          }
          let apiEntry = null;
          if (parsed !== null && typeof parsed === 'object' && typeof parsed.method === 'string') {
            apiEntry = {
              at: new Date().toISOString(),
              method: parsed.method,
              params: sanitizeRequestParams(parsed.params),
            };
            apiLog.push(apiEntry);
          }
          const hostRequest = new Request(origin + request.url, {
            method: 'POST',
            headers: request.headers,
            body: bodyBuffer,
            duplex: 'half',
          });
          const hostResponse = await requestRoute.fetch(hostRequest);
          if (apiEntry !== null) {
            // Capture the typed Host result/error so the R5 cases can assert
            // "settled cached result" / "no E_OPERATION_REUSED" from the real
            // response, not just from the page's optimistic state.
            try {
              const clone = hostResponse.clone();
              const body = await clone.json();
              apiEntry.responseStatus = hostResponse.status;
              apiEntry.responseOk = body !== null && typeof body === 'object' && body.ok === true;
              apiEntry.responseErrorCode = body !== null && typeof body === 'object' && body.error !== null && typeof body.error === 'object' && typeof body.error.code === 'string'
                ? body.error.code
                : null;
              apiEntry.responseRevision = body !== null && typeof body === 'object' && body.result !== null && typeof body.result === 'object' && typeof body.result.revision === 'string'
                ? body.result.revision
                : null;
            } catch (_error) {
              apiEntry.responseStatus = hostResponse.status;
            }
          }
          await writeResponse(response, hostResponse);
          serverLog.push({ at: new Date().toISOString(), method: request.method, path: requestPath, status: hostResponse.status });
          return;
        }
        const route = host.routes.find((candidate) => candidate.path === requestPath);
        if (route !== undefined) {
          const bodyBuffer = request.method === 'GET' || request.method === 'HEAD' ? undefined : await readBody(request);
          const hostRequest = new Request(origin + request.url, {
            method: request.method,
            headers: request.headers,
            body: bodyBuffer,
            duplex: 'half',
          });
          const hostResponse = await route.fetch(hostRequest);
          await writeResponse(response, hostResponse);
          serverLog.push({ at: new Date().toISOString(), method: request.method, path: requestPath, status: hostResponse.status });
          return;
        }
        response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
        response.end('not found');
        serverLog.push({ at: new Date().toISOString(), method: request.method, path: requestPath, status: 404 });
      } catch (error) {
        try {
          response.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
          response.end('harness server error: ' + (error instanceof Error ? error.message : String(error)));
        } catch (_ignored) {
          /* response may already be sent */
        }
      }
    });
    await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
    origin = `http://127.0.0.1:${server.address().port}`;
    evidence.origin = origin;

    const puppeteer = createRequire(join(stagingRoot, 'engine-worker', 'package.json'))('puppeteer-core');
    browser = await puppeteer.launch({
      executablePath: staged.integrity.browser,
      headless: true,
      defaultViewport: { width: 1400, height: 1000, deviceScaleFactor: 1 },
      args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--hide-scrollbars'],
    });
    const page = await browser.newPage();
    page.setDefaultTimeout(30000);
    page.on('request', (request) => {
      networkRequests.push({ url: request.url(), method: request.method(), resourceType: request.resourceType() });
    });
    page.on('console', (message) => {
      consoleMessages.push({ type: message.type(), text: message.text() });
    });
    page.on('pageerror', (error) => {
      pageErrors.push(String(error && error.message ? error.message : error));
    });
    page.on('requestfailed', (request) => {
      requestFailures.push({ url: request.url(), error: request.failure() ? request.failure().errorText : null });
    });
    await page.goto(origin + '/', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__BOOTED__ === true, { timeout: 20000 });
    const bootError = await page.evaluate(() => window.__BOOT_ERROR__ || null);
    assert(bootError === null, 'harness page boot failed: ' + bootError);
    const dictionary = await page.evaluate(() => window.__CASE__.dictionary());

    // Component onError records are expected only in the injected-failure
    // cases; they are kept per-case in the case state snapshots.
    const ctx = {
      page,
      bridge,
      stateRoot,
      stagingRoot,
      dictionary,
      projectIds: [],
      apiLog,
      serverLog,
    };
    evidence.projectIds = ctx.projectIds;

    const caseRunners = [
      { id: 'M1', filter: 'M1', run: () => runDragMoveCase(ctx, { id: 'M1', t: 0.2, wrap: { width: 900, height: 400 } }) },
      { id: 'M2', filter: 'M2', run: () => runDragMoveCase(ctx, { id: 'M2', t: 0.2, wrap: { width: 600, height: 500 } }) },
      { id: 'M3', filter: 'M3', run: () => runDragMoveCase(ctx, { id: 'M3', t: 0.6, wrap: { width: 900, height: 400 } }) },
      { id: 'M4', filter: 'M4', run: () => runDragMoveCase(ctx, { id: 'M4', t: 0.6, wrap: { width: 600, height: 500 } }) },
      { id: 'R1', filter: 'R1', run: () => runResizeRuleCase(ctx) },
      { id: 'R2', filter: 'R2', run: () => runResizeTitleCase(ctx) },
      { id: 'F1', filter: 'F1', run: () => runDragFailureCase(ctx) },
      { id: 'T1', filter: 'T1', run: () => runTextFailureRetryCase(ctx) },
      { id: 'T2', filter: 'T2', run: () => runTextEscapeCase(ctx) },
      { id: 'T3', filter: 'T3', run: () => runTextConflictCase(ctx) },
      { id: 'T4A', filter: 'T4A', run: () => runLostResponseUnchangedRetryCase(ctx) },
      { id: 'T4B', filter: 'T4B', run: () => runLostResponseModifiedDraftCase(ctx) },
      { id: 'T4C', filter: 'T4C', run: () => runLostResponseConflictRecoveryCase(ctx) },
    ];

    for (const runner of caseRunners) {
      if (caseFilter !== null && caseFilter.some((prefix) => runner.filter.startsWith(prefix) || prefix === '*') === false) continue;
      let caseResult;
      try {
        caseResult = await runner.run();
      } catch (error) {
        caseResult = newCase(runner.id, runner.id);
        caseResult.ok = false;
        caseResult.error = error instanceof Error ? error.message : String(error);
        caseResult.assertions.push({ name: 'case completed', ok: false, details: { error: caseResult.error } });
      }
      evidence.cases.push(caseResult);
      console.log(`[case ${caseResult.id}] ${caseResult.ok ? 'PASS' : 'FAIL'} — ${caseResult.title} (${caseResult.assertions.filter((entry) => entry.ok).length}/${caseResult.assertions.length} assertions)${caseResult.error ? ' error=' + caseResult.error : ''}`);
      for (const entry of caseResult.assertions) {
        if (entry.ok === false) console.log(`  ✗ ${entry.name}${entry.details ? ' ' + JSON.stringify(entry.details).slice(0, 600) : ''}`);
      }
    }

    // ─── network / console / teardown checks ───────────────────────────────
    const internal = (url) => url.startsWith(origin) || url.startsWith('data:') || url.startsWith('about:') || url.startsWith('blob:');
    const externalRequests = networkRequests.filter((request) => internal(request.url) === false);
    // A deliberate negative-path case makes the real Host reject a write (HTTP
    // 409 Conflict). Chrome logs non-2xx resource loads as console errors; that
    // browser noise is expected exactly when the server log recorded the same
    // >=400 response for our request route. Everything else is a harness/page
    // defect and still fails the run.
    const rawConsoleErrors = consoleMessages.filter((message) => message.type === 'error');
    const rejectedHostResponses = serverLog.filter((entry) => entry.path === REQUEST_PATH && entry.status >= 400);
    const expectedConsoleErrors = rawConsoleErrors.filter((message) => {
      const match = /^Failed to load resource: the server responded with a status of (\d{3})/.exec(message.text);
      return match !== null && rejectedHostResponses.some((entry) => String(entry.status) === match[1]);
    });
    const unexpectedConsoleErrors = rawConsoleErrors.filter((message) => expectedConsoleErrors.includes(message) === false);
    evidence.network = {
      origin,
      totalRequests: networkRequests.length,
      external: externalRequests,
      serverRequests: serverLog.length,
      requestFailures,
      rejectedHostResponses,
      console: {
        errors: rawConsoleErrors,
        expectedResourceErrors: expectedConsoleErrors,
        unexpectedErrors: unexpectedConsoleErrors,
        warnings: consoleMessages.filter((message) => message.type === 'warning'),
      },
      pageErrors,
      harnessPageErrors: await page.evaluate(() => window.__CASE__.pageErrors()),
      componentOnErrorSnapshots: evidence.cases.map((caseResult) => ({ id: caseResult.id })),
      apiRequestsByMethod: apiLog.reduce((counts, request) => {
        counts[request.method] = (counts[request.method] || 0) + 1;
        return counts;
      }, {}),
    };
    const globalChecks = {
      noExternalNetwork: externalRequests.length === 0,
      noUnexpectedConsoleErrors: unexpectedConsoleErrors.length === 0,
      noPageErrors: pageErrors.length === 0,
      noHarnessPageErrors: evidence.network.harnessPageErrors.length === 0,
    };
    evidence.globalChecks = globalChecks;

    // Unmount the component, then prove the bridge/server/browser resources are
    // released. Late runtime messages after unmount must not surface as errors.
    await page.evaluate(() => window.__CASE__.unmount());
    await sleep(300);
    evidence.network.lateHarnessPageErrors = await page.evaluate(() => window.__CASE__.pageErrors());
    const bridgeStateBeforeDispose = bridge.state();
    await browser.close();
    browser = null;
    await new Promise((resolveClose, rejectClose) => server.close((error) => (error ? rejectClose(error) : resolveClose())));
    server = null;
    await bridge.dispose();
    const bridgeStateAfterDispose = bridge.state();
    const snapshotCount = bridge.snapshots.records.size;
    const teardown = {
      bridgeBeforeDispose: bridgeStateBeforeDispose,
      bridgeAfterDispose: bridgeStateAfterDispose,
      snapshotRecordsAfterDispose: snapshotCount,
      serverClosed: server === null,
      browserClosed: browser === null,
      noLatePageErrors: evidence.network.lateHarnessPageErrors.length === 0,
    };
    teardown.ok = teardown.bridgeAfterDispose.inFlight === 0
      && teardown.bridgeAfterDispose.jobs === 0
      && snapshotCount === 0
      && teardown.serverClosed
      && teardown.browserClosed
      && teardown.noLatePageErrors;
    evidence.teardown = teardown;

    const casesOk = evidence.cases.every((caseResult) => caseResult.ok);
    ok = casesOk && Object.values(globalChecks).every((value) => value === true) && teardown.ok;
  } catch (error) {
    evidence.fatalError = {
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    };
    ok = false;
    console.error('harness failed:', evidence.fatalError.message);
  } finally {
    // Resource teardown is idempotent: a thrown assertion must not leak a
    // browser, server or worker process.
    if (browser !== null) await browser.close().catch(() => {});
    if (server !== null) await new Promise((resolveClose) => server.close(resolveClose)).catch(() => {});
    if (bridge !== null) {
      try {
        await bridge.dispose();
      } catch (_error) {
        /* reported in evidence.fatalError/teardown */
      }
    }
    if (stagingSourcesBefore !== null) {
      try {
        const stagingSourcesAfter = await listStagingSources(staged.evidence.staging);
        evidence.stagingReadOnly = {
          ...compareStagingSources(stagingSourcesBefore, stagingSourcesAfter),
          note: 'Only immutable source/config files are compared; worker business dirs, node_modules, caches and evidence/ are excluded.',
        };
        if (evidence.stagingReadOnly.same !== true) {
          ok = false;
          console.error('staging source files changed during the run:', JSON.stringify(evidence.stagingReadOnly.changed));
        }
      } catch (error) {
        evidence.stagingReadOnly = { same: null, error: error instanceof Error ? error.message : String(error) };
      }
    }
    evidence.ok = ok;
    evidence.finishedAt = new Date().toISOString();
    evidence.requests = apiLog;
    const outputDirectory = args.out !== undefined ? resolve(args.out) : join(staging, 'evidence');
    await mkdir(outputDirectory, { recursive: true });
    const evidenceFile = join(outputDirectory, 'canvas-workspace-' + new Date().toISOString().replace(/[:.]/g, '-') + '.json');
    await writeFile(evidenceFile, JSON.stringify(evidence, null, 2) + '\n');
    const passed = evidence.cases.filter((caseResult) => caseResult.ok).length;
    const failed = evidence.cases.length - passed;
    console.log(JSON.stringify({
      evidence: evidenceFile,
      ok: evidence.ok,
      cases: { total: evidence.cases.length, passed, failed },
      engineCommit: evidence.engineCommit,
      rootCommit: evidence.rootCommit,
      extraction: evidence.extraction ? { clientSha256: evidence.extraction.clientSha256, helpersSha256: evidence.extraction.helpers.sha256, canvasSha256: evidence.extraction.canvas.sha256 } : null,
    }, null, 2));
  }
  process.exitCode = ok ? 0 : 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
