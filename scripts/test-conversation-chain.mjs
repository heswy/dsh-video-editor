#!/usr/bin/env node
/**
 * P3-012 conversation-first real-staged chain verification.
 *
 * Exercises the EXACT staged Host + engine worker + `video_engine` Tool bytes
 * through the real trusted Agent-Session binding, with the verifier's own two
 * structurally different genre fixtures:
 *
 *   A. genre A — inline-SVG illustrated animation (1280x720)
 *   B. genre B — kinetic typography (720x1280)
 *
 * Coverage (PROTOCOL.md section 6.A):
 *   1. project.create + session.create, `project.source` before any write,
 *      `project.compose` through the real Tool with agent.session.id.
 *   2. Genre B publish through the same path; genre A bytes replaced atomically.
 *   3. Round-2 modification of genre B derived from the published source:
 *      changed fields change, everything else is byte-preserved.
 *   4. Failure matrix (typed errors + revision/entry atomicity): missing #main,
 *      missing window.__timelines, external/undeclared/absolute/.. asset refs,
 *      forbidden tags, duplicate #main, invalid numeric metadata, fragment,
 *      NUL byte, >48 KiB, empty html, stale expectedRevision, malformed params,
 *      operationId idempotency/reuse, unchanged bytes, and Tool scope failures.
 *   5. Preview pipeline: the snapshot route for the published revision returns
 *      the exact entry bytes (+ runtime injection only), assets exactly, CSP
 *      intact; a real Chrome load of each genre snapshot reaches ready, seeks,
 *      plays, and is screenshotted.
 *   6. Close/reopen persistence and honest teardown of routes/in-flight work.
 *
 * This is a development integration run against an immutable staging snapshot:
 * it is not a DSH installation, not a real model call, and no user project or
 * profile state is touched. All mutable bridge/worker state lives in an OS temp
 * directory recorded in the evidence JSON.
 *
 * Usage:
 *   node scripts/test-conversation-chain.mjs --staging <absolute staging dir>
 *                                           [--out <absolute evidence dir>]
 *
 * Exit code: 0 only when every recorded check passes; 1 otherwise; 2 on usage.
 */

import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { chmod, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { loadStagedHost } from './lib/staged-host.mjs';
import {
  DEFAULT_EVIDENCE_ROOT,
  UsageError,
  assert,
  callTool,
  compareStagingSources,
  createChecks,
  fakeCtx,
  fetchRoute,
  invokeHttp,
  listStagingSources,
  loadStagedTool,
  parseCli,
  prepareStateRoot,
  publicErrorOf,
  sanitize,
  sha256,
  sleep,
  stamp,
  stripInjectedRuntime,
  writeBinary,
  writeEvidence,
} from './lib/conversation-harness.mjs';
import {
  checkCompositionContract,
  failureFixtures,
  genreA,
  genreAModified,
  genreB,
  modifyGenreBAgain,
  modifyGenreB,
  svgFragmentUrlProbe,
} from './lib/conversation-fixtures.mjs';

const KIND = 'p3-012-conversation-chain';
const INSTANCE = 'p3012chain001';
const NONCE = '0123456789abcdef0123456789abcdef';
const SHA256 = /^[a-f0-9]{64}$/;
const TOOL_SESSION = { agent: { session: { id: 'unused' } } };

function usage(message) {
  if (message) console.error(message);
  console.error('usage: node scripts/test-conversation-chain.mjs --staging <absolute staging directory> [--out <absolute evidence dir>]');
  process.exit(2);
}

function opId(prefix) {
  return (prefix || 'op') + '-' + randomUUID().replace(/-/g, '').slice(0, 16);
}

/** Real Chrome page that loads one snapshot URL through the fixed runtime. */
function runtimePageSource(entryUrl, composition, expected) {
  const scale = Math.min(560 / composition.width, 640 / composition.height, 1);
  const stageWidth = Math.round(composition.width * scale * 100) / 100;
  const stageHeight = Math.round(composition.height * scale * 100) / 100;
  return `<!doctype html>
<html><head><meta charset="utf-8"><style>
html,body{margin:0;background:#111;color:#eee;font:13px sans-serif}
#stage{position:relative;width:${stageWidth}px;height:${stageHeight}px;margin:16px;background:#000;overflow:hidden}
iframe{position:absolute;left:0;top:0;width:${composition.width}px;height:${composition.height}px;border:0;transform:scale(${scale});transform-origin:top left}
</style></head><body>
<div id="stage"></div>
<script>
var result={started:Date.now(),events:[],done:false};
window.__RESULT__=result;
try{
  var instance=${JSON.stringify(INSTANCE)};
  var nonce=${JSON.stringify(NONCE)};
  var seekTarget=${JSON.stringify(expected.seekTarget)};
  var frame=document.createElement('iframe');
  frame.sandbox='allow-scripts';
  frame.referrerPolicy='no-referrer';
  document.getElementById('stage').appendChild(frame);
  var seq=0; var pending=new Map();
  function command(type,payload){
    return new Promise(function(resolveCommand){
      var id=++seq;
      var timer=setTimeout(function(){pending.delete(id);resolveCommand(null);},5000);
      pending.set(id,{resolve:resolveCommand,timer:timer});
      frame.contentWindow.postMessage({v:1,kind:'cmd',instanceId:instance,nonce:nonce,seq:id,type:type,payload:payload||{}},'*');
    });
  }
  window.addEventListener('message',function(event){
    if(event.source!==frame.contentWindow) return;
    var data=event.data;
    if(!data || data.kind!=='evt' || data.instanceId!==instance || data.nonce!==nonce) return;
    result.events.push(data.type);
    if(data.replyTo && pending.has(data.replyTo)){
      var item=pending.get(data.replyTo); pending.delete(data.replyTo); clearTimeout(item.timer); item.resolve(data.payload);
    }
    if(data.type==='ready'){
      result.ready=data.payload;
      (async function(){
        result.seek=await command('seek',{time:seekTarget});
        result.stateAtSeek=await command('state');
        await command('play');
        await new Promise(function(r){setTimeout(r,480);});
        result.stateAfterPlay=await command('state');
        await command('pause');
        result.eventsAfter=result.events.slice();
        result.done=true;
      })().catch(function(error){result.error=String(error);result.done=true;});
    }
    if(data.type==='error'){result.error=data.payload&&data.payload.message;}
  });
  frame.src=${JSON.stringify(entryUrl)} + '?instance=' + encodeURIComponent(instance) + '&nonce=' + nonce;
  setTimeout(function(){if(!result.done){result.timeout=true;result.done=true;}},20000);
}catch(error){result.error=String(error);result.done=true;}
</script></body></html>`;
}

/** Validate the exact compose result shape required by PROTOCOL.md 3.1. */
function assertComposeResult(checks, label, call, expectedHtml, meta) {
  const result = call.value !== null && typeof call.value === 'object' ? call.value.result : null;
  const fields = ['projectId', 'revision', 'publishedRevision', 'written', 'unchanged', 'entry', 'width', 'height', 'duration', 'bytes', 'assets', 'elements', 'files', 'preview', 'history'];
  const missing = result === null || typeof result !== 'object' ? fields : fields.filter((field) => Object.prototype.hasOwnProperty.call(result, field) === false);
  checks.check(label + ': compose succeeded and returns every required result field', call.ok === true && missing.length === 0, { ok: call.ok, code: call.code, missing, keys: result === null ? null : Object.keys(result) });
  if (result === null || typeof result !== 'object') return null;
  const bytes = Buffer.byteLength(expectedHtml, 'utf8');
  checks.check(label + ': revision is a 64-hex revision', typeof result.revision === 'string' && SHA256.test(result.revision), { revision: result.revision });
  checks.check(label + ': publishedRevision === revision (trusted publish marker)', result.publishedRevision === result.revision && typeof result.publishedRevision === 'string', { publishedRevision: result.publishedRevision, revision: result.revision });
  checks.check(label + ': written true / unchanged false for a new document', result.written === true && result.unchanged === false, { written: result.written, unchanged: result.unchanged });
  checks.check(label + ': entry is index.html', result.entry === 'index.html', { entry: result.entry });
  checks.check(label + ': width/height/duration match the validated document', Number(result.width) === meta.width && Number(result.height) === meta.height && Math.abs(Number(result.duration) - meta.duration) < 0.001, { expected: { width: meta.width, height: meta.height, duration: meta.duration }, actual: { width: result.width, height: result.height, duration: result.duration } });
  checks.check(label + ': bytes equals the submitted UTF-8 byte length', Number(result.bytes) === bytes, { expected: bytes, actual: result.bytes });
  checks.check(label + ': assets lists the declared GSAP asset', Array.isArray(result.assets) && result.assets.includes('assets/gsap.min.js'), { assets: result.assets });
  const elements = Array.isArray(result.elements) ? result.elements : null;
  const elementShapeOk = elements !== null && elements.length <= 40 && elements.every((element) => element !== null && typeof element === 'object'
    && typeof element.stableId === 'string' && element.stableId.length > 0
    && Array.isArray(element.capabilities)
    && element.capabilities.every((capability) => ['text', 'timing', 'layout', 'style'].includes(capability)));
  checks.check(label + ': elements is a bounded typed-target list (<=40, known capabilities)', elementShapeOk, { count: elements === null ? null : elements.length, sample: elements === null ? null : elements.slice(0, 3) });
  const files = Array.isArray(result.files) ? result.files : null;
  const filesShapeOk = files !== null && files.every((file) => file !== null && typeof file === 'object'
    && typeof file.path === 'string' && Number.isFinite(Number(file.bytes)) && typeof file.sha256 === 'string');
  checks.check(label + ': files is a bounded manifest entry list with sha256', filesShapeOk, { files: files === null ? null : files.map((file) => ({ path: file.path, bytes: file.bytes })).slice(0, 8) });
  const preview = result.preview;
  checks.check(label + ': preview proof is mode=snapshot/status=ready for this revision', preview !== null && typeof preview === 'object'
    && preview.mode === 'snapshot' && preview.status === 'ready' && preview.revision === result.revision
    && typeof preview.checked === 'string' && preview.checked.includes('composition') && preview.checked.includes('snapshot'), { preview });
  const history = result.history;
  checks.check(label + ': history settlement is recorded with an integer cursor', history !== null && typeof history === 'object' && history.status === 'recorded' && Number.isInteger(history.historyCursor), { history });
  const sessionProject = result.projectId;
  checks.check(label + ': compose result projectId is the bound project', sessionProject === meta.projectId, { expected: meta.projectId, actual: sessionProject });
  return result;
}

/** `project.source` through the real Tool; returns the source result wrapper. */
async function sourceThroughTool(tool, sessionId, projectId) {
  const call = await callTool(tool, { action: 'project.source', projectId }, sessionId);
  return call;
}

/** Assert one source round-trip: exact bytes, revision, entry, assets shape. */
function assertSource(checks, label, call, expectedHtml, expectedRevision) {
  const result = call.ok === true && call.value !== null && typeof call.value === 'object' ? call.value.result : null;
  checks.check(label + ': project.source succeeds through the Tool', call.ok === true && result !== null && typeof result === 'object', { ok: call.ok, code: call.code, message: call.message });
  if (result === null || typeof result !== 'object') return null;
  const keys = Object.keys(result).sort();
  const required = ['assets', 'bytes', 'entry', 'html', 'projectId', 'revision'];
  checks.check(label + ': source result carries every required field', required.every((field) => keys.includes(field)), { keys });
  checks.check(label + ': source html round-trips the exact published bytes', result.html === expectedHtml, { expectedBytes: Buffer.byteLength(expectedHtml, 'utf8'), actualBytes: typeof result.html === 'string' ? Buffer.byteLength(result.html, 'utf8') : null, equal: result.html === expectedHtml });
  checks.check(label + ': source bytes matches the html UTF-8 length', Number(result.bytes) === (typeof result.html === 'string' ? Buffer.byteLength(result.html, 'utf8') : -1), { bytes: result.bytes });
  if (typeof expectedRevision === 'string') {
    checks.check(label + ': source revision matches the published revision', result.revision === expectedRevision && SHA256.test(result.revision), { expected: expectedRevision, actual: result.revision });
  }
  checks.check(label + ': source entry is index.html and assets include GSAP', result.entry === 'index.html' && Array.isArray(result.assets) && result.assets.includes('assets/gsap.min.js'), { entry: result.entry, assets: result.assets });
  return result;
}

/**
 * Verify one preview snapshot route end-to-end without a browser:
 * exact entry bytes (only the fixed runtime tag injected), CSP, asset bytes.
 */
async function verifySnapshotBytes(host, stateRoot, projectId, snapshot, expectedHtml, label) {
  const entryPath = snapshot.entryUrl;
  // The fixed runtime handshake requires both query parameters; without them the
  // Host entry route answers 400 instead of serving the document.
  const entryResponse = await fetchRoute(host.routes, entryPath + '?instance=' + INSTANCE + '&nonce=' + NONCE, { method: 'GET' });
  const entryHtml = await entryResponse.text();
  const stripped = stripInjectedRuntime(entryHtml);
  const csp = entryResponse.headers.get('content-security-policy') || '';
  const assetRoute = host.routes.find((candidate) => typeof candidate.path === 'string' && candidate.path.endsWith('/assets/gsap.min.js'));
  let assetFacts = null;
  if (assetRoute !== undefined) {
    const assetResponse = await assetRoute.fetch(new Request('http://127.0.0.1' + assetRoute.path, { method: 'GET' }));
    const assetBytes = Buffer.from(await assetResponse.arrayBuffer());
    const disk = await readFile(join(stateRoot.directories.projects, projectId, 'assets/gsap.min.js'));
    assetFacts = {
      route: assetRoute.path,
      status: assetResponse.status,
      bytes: assetBytes.length,
      sha256: sha256(assetBytes),
      diskBytes: disk.length,
      diskSha256: sha256(disk),
      equal: sha256(assetBytes) === sha256(disk),
    };
  }
  return {
    label,
    snapshotId: snapshot.snapshotId,
    revision: snapshot.revision,
    entryUrl: entryPath,
    entryStatus: entryResponse.status,
    contentType: entryResponse.headers.get('content-type'),
    runtimeInjectedOnce: (entryHtml.match(/canvas-runtime\.js/g) || []).length === 1,
    exactBytesAfterRuntimeStrip: stripped === expectedHtml,
    expectedBytes: Buffer.byteLength(expectedHtml, 'utf8'),
    servedBytes: entryHtml.length,
    cspHasConnectNone: /connect-src\s+'none'/.test(csp),
    cspHasScriptSrc: /script-src/.test(csp),
    asset: assetFacts,
  };
}

/**
 * Load one published snapshot URL through the fixed runtime in real Chrome.
 *
 * A fresh toy server proxies the staged Host snapshot routes (full origin +
 * query preserved: the entry route validates the instance/nonce handshake and
 * its CSP pins the request origin). The page drives the runtime command
 * protocol (seek/state/play/pause) and screenshots the stage.
 */
async function runChromeSnapshot({ browser, host, outRoot, runDirectory, snapshot, meta, seekTarget, label }) {
  let server = null;
  let page = null;
  try {
    server = createServer(async (request, response) => {
      try {
        const url = new URL(request.url, 'http://127.0.0.1');
        const origin = 'http://127.0.0.1:' + server.address().port;
        if (url.pathname === '/') {
          response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
          response.end(runtimePageSource(snapshot.entryUrl, meta, { seekTarget }));
          return;
        }
        if (url.pathname === '/favicon.ico') {
          response.writeHead(204, { 'cache-control': 'no-store' });
          response.end();
          return;
        }
        const route = host.routes.find((candidate) => candidate.path === url.pathname);
        if (route === undefined) {
          response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
          response.end('not found');
          return;
        }
        const routeRequest = new Request(origin + request.url, {
          method: request.method,
          headers: request.headers,
          body: request.method === 'GET' || request.method === 'HEAD' ? undefined : request,
          duplex: 'half',
        });
        const routeResponse = await route.fetch(routeRequest);
        const headers = {};
        routeResponse.headers.forEach((value, key) => { headers[key] = value; });
        response.writeHead(routeResponse.status, headers);
        response.end(Buffer.from(await routeResponse.arrayBuffer()));
      } catch (_error) {
        try {
          response.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
          response.end('snapshot server error');
        } catch (_ignored) { /* already sent */ }
      }
    });
    await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
    const origin = 'http://127.0.0.1:' + server.address().port;
    page = await browser.newPage();
    const requests = [];
    const consoleErrors = [];
    const pageErrors = [];
    page.on('request', (pageRequest) => requests.push(pageRequest.url()));
    page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });
    page.on('pageerror', (error) => pageErrors.push(String(error && error.message ? error.message : error)));
    await page.goto(origin + '/?case=' + encodeURIComponent(label), { waitUntil: 'domcontentloaded' });
    await page.waitForFunction('window.__RESULT__ && window.__RESULT__.done === true', { timeout: 40000 });
    const result = await page.evaluate('window.__RESULT__');
    const external = requests.filter((url) => url.startsWith(origin) === false && url.startsWith('data:') === false && url.startsWith('about:') === false);
    const ready = result.ready || null;
    const readyOk = ready !== null && Number(ready.width) === meta.width && Number(ready.height) === meta.height && Math.abs(Number(ready.duration) - meta.duration) < 0.01;
    const seekOk = result.seek !== null && result.seek !== undefined && Math.abs(Number(result.seek.time) - seekTarget) < 0.02;
    const playOk = result.stateAfterPlay !== null && result.stateAfterPlay !== undefined && Number(result.stateAfterPlay.time) >= seekTarget + 0.2;
    const screenshotPath = join(outRoot, runDirectory, 'runtime-' + label + '.png');
    await mkdir(join(outRoot, runDirectory), { recursive: true });
    const stage = await page.$('#stage');
    if (stage !== null) await stage.screenshot({ path: screenshotPath });
    return {
      caseEvidence: {
        label,
        revision: snapshot.revision,
        entryUrl: snapshot.entryUrl,
        ready,
        seek: result.seek,
        stateAtSeek: result.stateAtSeek,
        stateAfterPlay: result.stateAfterPlay,
        events: result.events,
        error: result.error || null,
        timeout: result.timeout === true,
        externalRequests: external,
        consoleErrors,
        pageErrors,
        screenshot: screenshotPath,
        assertions: { readyOk, seekOk, playOk },
      },
      readyOk,
      seekOk,
      playOk,
      error: result.error || null,
      timeout: result.timeout === true,
      external,
      pageErrors,
    };
  } finally {
    if (page !== null) await page.close().catch(() => {});
    // The browser stays alive between snapshot loads, so Chrome keeps an idle
    // keep-alive socket to this per-case server; Node's server.close() would
    // otherwise wait forever for it. Destroy open sockets explicitly.
    if (server !== null) {
      if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
      await new Promise((resolveClose) => server.close(resolveClose)).catch(() => {});
    }
  }
}

/** Record the three per-genre real-Chrome acceptance checks + evidence entry. */
function recordChromeSnapshot(checks, chromeEvidence, loaded, label) {
  chromeEvidence.snapshots.push(loaded.caseEvidence);
  checks.check('real Chrome runtime load of ' + label + ' reaches ready with the composition frame/duration', loaded.readyOk && loaded.error === null && loaded.timeout !== true, { ready: loaded.caseEvidence.ready, error: loaded.error });
  checks.check('real Chrome runtime ' + label + ': seek lands exactly then play advances the playhead', loaded.seekOk && loaded.playOk, { seek: loaded.caseEvidence.seek, stateAfterPlay: loaded.caseEvidence.stateAfterPlay });
  checks.check('real Chrome runtime ' + label + ' makes no external network request and raises no page error', loaded.external.length === 0 && loaded.pageErrors.length === 0, { external: loaded.external, pageErrors: loaded.pageErrors });
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
  const runStamp = stamp(startedAt);
  const runDirectory = 'chain-' + runStamp;
  const evidence = {
    kind: KIND,
    startedAt: startedAt.toISOString(),
    command: 'node scripts/test-conversation-chain.mjs ' + process.argv.slice(2).join(' '),
    staging,
    note: 'Development integration run against an immutable staging snapshot. No DSH install, no real model call, no user profile/project writes. The worker and Host are the staged bytes whose digests are recorded here.',
    checks: null,
    failures: [],
    composeRounds: [],
    snapshots: [],
    sourceChecks: [],
    failureMatrix: [],
    scopeChecks: [],
    paramChecks: [],
    promptContext: null,
    chrome: null,
    r1: null,
    reopen: null,
    teardown: null,
    stagingReadOnly: null,
  };
  const checks = createChecks();
  let staged = null;
  let bridge = null;
  let host = null;
  let stateRoot = null;
  let tool = null;
  let browser = null;
  let server = null;
  let stagingBefore = null;
  let projectId = null;
  let sessionId = null;
  const registeredSnapshots = [];

  try {
    // ─── staging trust ─────────────────────────────────────────────────────
    staged = await loadStagedHost(staging);
    const stagingRoot = staged.evidence.staging;
    stagingBefore = await listStagingSources(stagingRoot);
    evidence.host = staged.evidence;
    evidence.engineCommit = staged.integrity.engineCommit;
    evidence.rootCommit = staged.integrity.rootCommit;
    evidence.versions = staged.integrity.versions;
    evidence.browserPath = staged.integrity.browser;
    evidence.stagingSourceCount = stagingBefore.length;
    assert(typeof staged.integrity.browser === 'string', 'staging INTEGRITY has no browser path');

    const bundleFiles = Array.isArray(staged.integrity.files?.bundle) ? staged.integrity.files.bundle : [];
    for (const relativePath of ['index.js', 'client.js', 'host/bridge.js', 'host/tool.js', 'host/sessions.js', 'host/canvas-runtime.js']) {
      const recorded = bundleFiles.find((entry) => entry !== null && entry.path === relativePath);
      assert(recorded !== undefined, 'INTEGRITY.files.bundle does not record ' + relativePath);
      const bytes = await readFile(join(stagingRoot, 'bundle', relativePath));
      assert(sha256(bytes) === recorded.sha256, 'staged ' + relativePath + ' does not match INTEGRITY.json');
    }
    checks.check('staging snapshot verified: every executed Host/Tool/runtime byte matches INTEGRITY.json', true, {
      rootCommit: staged.integrity.rootCommit,
      engineCommit: staged.integrity.engineCommit,
      versions: staged.integrity.versions,
      hostBridgeSha256: staged.evidence.hostModuleSha256,
    });

    // ─── fixtures: independent contract sanity ─────────────────────────────
    const fixtureContract = {};
    for (const [name, built] of [['genreA', genreA()], ['genreB', genreB()], ['genreB2', modifyGenreB(genreB().html) && { html: modifyGenreB(genreB().html).html }], ['genreA2', genreAModified()]]) {
      const result = checkCompositionContract(built.html, name);
      fixtureContract[name] = { ok: result.ok, problems: result.problems, facts: result.facts, bytes: Buffer.byteLength(built.html, 'utf8') };
      checks.check('fixture ' + name + ' independently satisfies the frozen composition contract', result.ok, result.problems);
    }
    evidence.fixtures = fixtureContract;

    // ─── isolated mutable state + real staged bridge/tool ──────────────────
    stateRoot = await prepareStateRoot(stagingRoot, staged.config, 'dsh-p3012-chain-');
    evidence.stateRoot = stateRoot.base;
    host = fakeCtx('chain');
    bridge = new staged.VideoBridge({ ctx: host.ctx, rawConfig: stateRoot.config });
    const createVideoTool = await loadStagedTool(stagingRoot);
    tool = createVideoTool(bridge);
    console.log('[phase] staged bridge + Tool ready');
    checks.check('staged Tool definition exposes the conversation-first workflow wording', typeof tool.description === 'string'
      && tool.description.includes('project.compose') && tool.description.includes('project.source')
      && tool.description.includes('expectedRevision') && /left preview follows/i.test(tool.description)
      && /never write project files/i.test(tool.description), { descriptionLength: typeof tool.description === 'string' ? tool.description.length : null });

    // ─── 1. managed project + native creation Session ──────────────────────
    const created = await invokeHttp(bridge, 'project.create', { templateId: 'product-launch-v1', title: 'P3-012 Conversation Chain' });
    projectId = created.projectId;
    assert(typeof projectId === 'string' && /^proj-/.test(projectId), 'project.create did not return a managed project id');
    const session = await invokeHttp(bridge, 'session.create', { projectId, requestId: opId('bind') });
    sessionId = session.sessionId;
    assert(typeof sessionId === 'string' && sessionId.length > 0, 'session.create did not return a native session id');
    const sessionList = await invokeHttp(bridge, 'session.list', { projectId });
    checks.check('project.create + session.create bind one managed project to one native Session', sessionList.activeSessionId === sessionId && Array.isArray(sessionList.sessions) && sessionList.sessions.some((item) => item.sessionId === sessionId), { projectId, sessionId, activeSessionId: sessionList.activeSessionId, sessions: sessionList.sessions.map((item) => item.sessionId) });
    const initialInspect = await invokeHttp(bridge, 'inspect', { projectId });
    evidence.initialProject = { projectId, revision: initialInspect.revision, duration: initialInspect.duration, width: initialInspect.width, height: initialInspect.height, scenes: Array.isArray(initialInspect.scenes) ? initialInspect.scenes.length : null };

    // project.list recency payload is the basis of the client auto-open logic.
    const listBefore = await invokeHttp(bridge, 'project.list', {});
    const listSorted = Array.isArray(listBefore.projects) ? listBefore.projects : [];
    const sortedOk = listSorted.every((item, index) => index === 0 || Number(listSorted[index - 1].updatedAt) >= Number(item.updatedAt));
    const managedEntry = listSorted.find((item) => item.projectId === projectId) || null;
    checks.check('project.list returns {projectId, updatedAt} sorted by entry mtime desc with a defaultProjectId', sortedOk
      && managedEntry !== null && Number.isFinite(managedEntry.updatedAt)
      && typeof listBefore.defaultProjectId === 'string' && listSorted.every((item) => typeof item.projectId === 'string' && Number.isFinite(Number(item.updatedAt))), sanitize({ defaultProjectId: listBefore.defaultProjectId, projects: listSorted }, 2000));
    const listViaTool = await callTool(tool, { action: 'project.list' }, sessionId);
    checks.check('project.list stays UI-only for the Tool (E_METHOD) while the UI route keeps it', listViaTool.ok === false && listViaTool.code === 'E_METHOD', { code: listViaTool.code, message: listViaTool.message });
    const demoListed = listSorted.some((item) => item.projectId === 'demo');
    evidence.demoListed = demoListed;

    // ─── 2. project.source before any write (legacy scene project) ─────────
    const legacySourceCall = await sourceThroughTool(tool, sessionId, projectId);
    const legacySource = assertSource(checks, 'legacy scene project source', legacySourceCall, typeof legacySourceCall.value?.result?.html === 'string' ? legacySourceCall.value.result.html : '', initialInspect.revision);
    checks.check('project.source reads the current full HTML of a pre-compose (scene) project without writing', legacySource !== null && legacySource.revision === initialInspect.revision && typeof legacySource.html === 'string' && /<!doctype html/i.test(legacySource.html), { revision: legacySource === null ? null : legacySource.revision, bytes: legacySource === null ? null : legacySource.bytes, initialRevision: initialInspect.revision });
    evidence.sourceChecks.push({ label: 'legacy-scene-project', revision: legacySource === null ? null : legacySource.revision, bytes: legacySource === null ? null : legacySource.bytes });
    const inspectAfterSource = await invokeHttp(bridge, 'inspect', { projectId });
    checks.check('project.source performs no write (revision unchanged)', inspectAfterSource.revision === initialInspect.revision, { before: initialInspect.revision, after: inspectAfterSource.revision });

    // ─── 3. genre A publish through the real Tool ──────────────────────────
    const fixtureA = genreA();
    const composeA = await callTool(tool, {
      action: 'project.compose',
      projectId,
      expectedRevision: initialInspect.revision,
      operationId: opId('compose-a'),
      html: fixtureA.html,
    }, sessionId);
    const resultA = assertComposeResult(checks, 'genre A', composeA, fixtureA.html, { ...fixtureA.meta, projectId });
    const revA = resultA === null ? null : resultA.revision;
    evidence.composeRounds.push({ round: 1, genre: 'A', revision: revA, publishedRevision: resultA?.publishedRevision, bytes: resultA?.bytes, width: resultA?.width, height: resultA?.height, duration: resultA?.duration, toolMs: composeA.ms });
    const inspectA = await invokeHttp(bridge, 'inspect', { projectId });
    checks.check('genre A publish is visible through inspect at the returned revision', inspectA.revision === revA, { composeRevision: revA, inspectRevision: inspectA.revision });
    checks.check('genre A publish updates the inspected frame/duration', Number(inspectA.width) === fixtureA.meta.width && Number(inspectA.height) === fixtureA.meta.height && Math.abs(Number(inspectA.duration) - fixtureA.meta.duration) < 0.001, { expected: { width: fixtureA.meta.width, height: fixtureA.meta.height, duration: fixtureA.meta.duration }, actual: { width: inspectA.width, height: inspectA.height, duration: inspectA.duration } });
    const htmlA = fixtureA.html;
    const sourceACall = await sourceThroughTool(tool, sessionId, projectId);
    assertSource(checks, 'genre A source round-trip', sourceACall, htmlA, revA);
    const historyA = await invokeHttp(bridge, 'history', { projectId, limit: 64 });
    const composeEntriesA = Array.isArray(historyA.entries) ? historyA.entries.filter((entry) => entry !== null && typeof entry === 'object' && entry.kind === 'project.compose') : [];
    evidence.historyAfterA = { revision: historyA.revision, canUndo: historyA.canUndo, entries: Array.isArray(historyA.entries) ? historyA.entries.length : null, composeEntries: composeEntriesA.length };
    checks.check('genre A publish records a project.compose AI history entry', composeEntriesA.length >= 1 && composeEntriesA.some((entry) => entry.actor === 'ai' && entry.revision === revA), { composeEntries: composeEntriesA.slice(-3) });

    // Snapshot the genre A revision while it is current; the real Chrome check
    // loads this exact URL after both genres were published.
    const snapshotACall = await invokeHttp(bridge, 'preview.snapshot', { projectId, revision: revA, ttlMs: 900000 });
    const snapshotA = snapshotACall;
    assert(typeof snapshotA.snapshotId === 'string' && typeof snapshotA.entryUrl === 'string', 'genre A preview snapshot did not return a snapshotId/entryUrl');
    registeredSnapshots.push(snapshotA);
    const bytesA = await verifySnapshotBytes(host, stateRoot, projectId, snapshotA, htmlA, 'genre-a');
    evidence.snapshots.push(bytesA);
    checks.check('genre A snapshot route serves the exact published entry bytes (runtime tag aside)', bytesA.entryStatus === 200 && bytesA.exactBytesAfterRuntimeStrip === true && bytesA.runtimeInjectedOnce === true, { entryStatus: bytesA.entryStatus, exact: bytesA.exactBytesAfterRuntimeStrip, runtimeInjectedOnce: bytesA.runtimeInjectedOnce, servedBytes: bytesA.servedBytes, expectedBytes: bytesA.expectedBytes });
    checks.check('genre A snapshot response keeps the locked-down CSP and serves the declared asset bytes', bytesA.cspHasConnectNone === true && bytesA.cspHasScriptSrc === true && bytesA.asset !== null && bytesA.asset.status === 200 && bytesA.asset.equal === true && bytesA.asset.bytes > 0, { cspHasConnectNone: bytesA.cspHasConnectNone, cspHasScriptSrc: bytesA.cspHasScriptSrc, asset: bytesA.asset });

    // Real Chrome load of the genre A snapshot while its routes are current: a
    // later preview.snapshot for the same project replaces these host routes.
    const puppeteer = createRequire(join(stagingRoot, 'engine-worker', 'package.json'))('puppeteer-core');
    browser = await puppeteer.launch({
      executablePath: staged.integrity.browser,
      headless: true,
      defaultViewport: { width: 900, height: 800, deviceScaleFactor: 1 },
      args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--hide-scrollbars'],
    });
    const chromeEvidence = { snapshots: [], consoleErrors: null, pageErrors: null };
    evidence.chrome = chromeEvidence;
    const chromeA = await runChromeSnapshot({
      browser,
      host,
      outRoot,
      runDirectory,
      snapshot: snapshotA,
      meta: { width: fixtureA.meta.width, height: fixtureA.meta.height, duration: fixtureA.meta.duration },
      seekTarget: 2.4,
      label: 'genre-a-inline-svg',
    });
    recordChromeSnapshot(checks, chromeEvidence, chromeA, 'genre-a-inline-svg');
    console.log('[phase] genre A published + real-Chrome snapshot played');

    // ─── 4. genre B publish through the same Tool path ─────────────────────
    const fixtureB = genreB();
    const composeB = await callTool(tool, {
      action: 'project.compose',
      projectId,
      expectedRevision: inspectA.revision,
      operationId: opId('compose-b'),
      html: fixtureB.html,
    }, sessionId);
    const resultB = assertComposeResult(checks, 'genre B', composeB, fixtureB.html, { ...fixtureB.meta, projectId });
    const revB = resultB === null ? null : resultB.revision;
    evidence.composeRounds.push({ round: 2, genre: 'B', revision: revB, publishedRevision: resultB?.publishedRevision, bytes: resultB?.bytes, width: resultB?.width, height: resultB?.height, duration: resultB?.duration, toolMs: composeB.ms });
    checks.check('genre B publish replaces genre A on the SAME project (new revision, different frame)', revB !== null && revB !== revA && Number(resultB.width) === fixtureB.meta.width && Number(resultB.height) === fixtureB.meta.height, { revA, revB, width: resultB?.width, height: resultB?.height });
    const inspectB = await invokeHttp(bridge, 'inspect', { projectId });
    checks.check('genre B publish is visible through inspect at the returned revision', inspectB.revision === revB, { composeRevision: revB, inspectRevision: inspectB.revision });
    const sourceBCall = await sourceThroughTool(tool, sessionId, projectId);
    const sourceB = assertSource(checks, 'genre B source round-trip', sourceBCall, fixtureB.html, revB);
    checks.check('genre A bytes are gone after the genre B publish (atomic whole-document replacement)', sourceB !== null && sourceB.html.includes('gB-word-1') && sourceB.html.includes('gA-title') === false, { hasB: sourceB?.html.includes('gB-word-1') ?? null, hasA: sourceB?.html.includes('gA-title') ?? null });

    // ─── 5. round-2 modification of genre B derived from the published bytes ─
    const currentSourceB = sourceB.html;
    const modifiedB2 = modifyGenreB(currentSourceB);
    const contractB2 = checkCompositionContract(modifiedB2.html, 'genreB-round2');
    checks.check('round-2 modification source still satisfies the contract', contractB2.ok, contractB2.problems);
    const composeB2 = await callTool(tool, {
      action: 'project.compose',
      projectId,
      expectedRevision: revB,
      operationId: opId('compose-b2'),
      html: modifiedB2.html,
    }, sessionId);
    const resultB2 = assertComposeResult(checks, 'genre B round-2', composeB2, modifiedB2.html, { ...fixtureB.meta, projectId });
    const revB2 = resultB2 === null ? null : resultB2.revision;
    evidence.composeRounds.push({ round: 3, genre: 'B-modified', revision: revB2, publishedRevision: resultB2?.publishedRevision, bytes: resultB2?.bytes, width: resultB2?.width, height: resultB2?.height, duration: resultB2?.duration, toolMs: composeB2.ms, replacements: modifiedB2.applied });
    const sourceB2Call = await sourceThroughTool(tool, sessionId, projectId);
    const sourceB2 = assertSource(checks, 'genre B round-2 source round-trip', sourceB2Call, modifiedB2.html, revB2);
    checks.check('round-2 modification changes the requested fields (headline word, accent colour, animation)',
      sourceB2.html.includes('<span id="gB-word-2">TIDE</span>') && sourceB2.html.includes('--gB-accent:#7cf6c0') && sourceB2.html.includes("duration: 0.85, ease: 'back.out(1.7)'"), {
        hasTide: sourceB2.html.includes('<span id="gB-word-2">TIDE</span>'),
        hasAccent: sourceB2.html.includes('--gB-accent:#7cf6c0'),
        hasAnimation: sourceB2.html.includes("duration: 0.85, ease: 'back.out(1.7)'"),
      });
    checks.check('round-2 modification preserves everything the user did not ask to change',
      sourceB2.html.includes('KINETIC TYPOGRAPHY STUDY') && sourceB2.html.includes('words measured in motion') && sourceB2.html.includes('KINETIC / SERIES 02') && sourceB2.html.includes('#f4efe6') && sourceB2.html.includes('gB-kicker'), {
        hasKicker: sourceB2.html.includes('KINETIC TYPOGRAPHY STUDY'),
        hasSub: sourceB2.html.includes('words measured in motion'),
        hasFooter: sourceB2.html.includes('KINETIC / SERIES 02'),
        hasBackground: sourceB2.html.includes('#f4efe6'),
      });

    // ─── 6. failure matrix: typed errors + revision/entry atomicity ────────
    const baselineRevision = revB2;
    const baselineHtml = modifiedB2.html;
    const variants = failureFixtures(fixtureB.html);
    console.log('[phase] failure matrix start (' + variants.length + ' variants)');
    let variantCount = 0;
    for (const variant of variants) {
      variantCount += 1;
      if (variantCount % 8 === 0) console.log('[phase] failure matrix progress ' + variantCount + '/' + variants.length);
      if (variant.id === 'empty-html') continue; // handled with malformed params below
      const call = await callTool(tool, {
        action: 'project.compose',
        projectId,
        expectedRevision: baselineRevision,
        operationId: opId('reject-' + variant.id),
        html: variant.html,
      }, sessionId);
      const codeOk = call.ok === false && (variant.expectedCode === '*' ? typeof call.code === 'string' : call.code === variant.expectedCode);
      const afterInspect = await invokeHttp(bridge, 'inspect', { projectId });
      const afterSource = await sourceThroughTool(tool, sessionId, projectId);
      const revisionUnchanged = afterInspect.revision === baselineRevision;
      const sourceUnchanged = afterSource.ok === true && afterSource.value.result.html === baselineHtml;
      checks.check('failure ' + variant.id + ' (' + variant.description + ') is rejected with ' + variant.expectedCode, codeOk, { expectedCode: variant.expectedCode, layer: variant.layer, actualCode: call.code, message: call.message.slice(0, 300) });
      checks.check('failure ' + variant.id + ' leaves the last valid revision untouched', revisionUnchanged, { baselineRevision, actualRevision: afterInspect.revision });
      checks.check('failure ' + variant.id + ' leaves the last valid composition byte-identical', sourceUnchanged, { reasons: { sourceOk: afterSource.ok, actualBytes: afterSource.ok && typeof afterSource.value.result.html === 'string' ? Buffer.byteLength(afterSource.value.result.html, 'utf8') : null, expectedBytes: Buffer.byteLength(baselineHtml, 'utf8') } });
      evidence.failureMatrix.push({ id: variant.id, description: variant.description, expectedLayer: variant.layer, expectedCode: variant.expectedCode, actualCode: call.code, actualStage: call.stage, message: call.message.slice(0, 300), revisionUnchanged, sourceUnchanged });
    }

    // ─── 7. idempotency / unchanged / stale revision ───────────────────────
    const modifiedB3 = modifyGenreBAgain(modifiedB2.html);
    const contractB3 = checkCompositionContract(modifiedB3.html, 'genreB-round3');
    checks.check('round-3 idempotency fixture satisfies the contract', contractB3.ok, contractB3.problems);
    const opB3 = opId('compose-b3');
    const historyBeforeB3 = await invokeHttp(bridge, 'history', { projectId, limit: 64 });
    const composeB3 = await callTool(tool, {
      action: 'project.compose',
      projectId,
      expectedRevision: revB2,
      operationId: opB3,
      html: modifiedB3.html,
    }, sessionId);
    const resultB3 = assertComposeResult(checks, 'genre B round-3', composeB3, modifiedB3.html, { ...fixtureB.meta, projectId });
    const revB3 = resultB3 === null ? null : resultB3.revision;
    evidence.composeRounds.push({ round: 4, genre: 'B-modified-2', revision: revB3, publishedRevision: resultB3?.publishedRevision, bytes: resultB3?.bytes, toolMs: composeB3.ms, replacements: modifiedB3.applied });
    const historyAfterB3 = await invokeHttp(bridge, 'history', { projectId, limit: 64 });
    checks.check('round-3 publish adds exactly one history entry', Array.isArray(historyAfterB3.entries) && Array.isArray(historyBeforeB3.entries) && historyAfterB3.entries.length === historyBeforeB3.entries.length + 1, { before: historyBeforeB3.entries?.length, after: historyAfterB3.entries?.length });

    const replayB3 = await callTool(tool, {
      action: 'project.compose',
      projectId,
      expectedRevision: revB2,
      operationId: opB3,
      html: modifiedB3.html,
    }, sessionId);
    const replayResult = replayB3.ok === true ? replayB3.value.result : null;
    const inspectAfterReplay = await invokeHttp(bridge, 'inspect', { projectId });
    const historyAfterReplay = await invokeHttp(bridge, 'history', { projectId, limit: 64 });
    checks.check('repeated operationId with the same payload is idempotent (same revision, cached result)', replayB3.ok === true && replayResult !== null && replayResult.revision === revB3, { ok: replayB3.ok, revision: replayResult?.revision, expected: revB3, written: replayResult?.written, unchanged: replayResult?.unchanged });
    checks.check('idempotent replay performs no second write (revision and history unchanged)', inspectAfterReplay.revision === revB3 && historyAfterReplay.entries.length === historyAfterB3.entries.length, { revision: inspectAfterReplay.revision, expectedRevision: revB3, historyBefore: historyAfterB3.entries.length, historyAfter: historyAfterReplay.entries.length });

    // A genuinely DIFFERENT body for the same operationId: the round-2 document
    // (TIDE/accent-2) differs from the round-3 payload (CURRENT/accent-3).
    const reusedPayloadB3 = { html: modifiedB2.html };
    const reused = await callTool(tool, {
      action: 'project.compose',
      projectId,
      expectedRevision: revB2,
      operationId: opB3,
      html: reusedPayloadB3.html,
    }, sessionId);
    checks.check('reusing one operationId with a different payload is E_OPERATION_REUSED', reused.ok === false && reused.code === 'E_OPERATION_REUSED', { actualCode: reused.code, message: String(reused.message || '').slice(0, 300) });

    const unchangedCall = await callTool(tool, {
      action: 'project.compose',
      projectId,
      expectedRevision: revB3,
      operationId: opId('unchanged'),
      html: modifiedB3.html,
    }, sessionId);
    const unchangedResult = unchangedCall.ok === true ? unchangedCall.value.result : null;
    const inspectAfterUnchanged = await invokeHttp(bridge, 'inspect', { projectId });
    checks.check('identical html returns unchanged:true, written:false, same revision, no history entry', unchangedCall.ok === true && unchangedResult !== null
      && unchangedResult.unchanged === true && unchangedResult.written === false && unchangedResult.revision === revB3
      && unchangedResult.history !== null && typeof unchangedResult.history === 'object' && unchangedResult.history.status === 'unchanged'
      && inspectAfterUnchanged.revision === revB3, { ok: unchangedCall.ok, unchanged: unchangedResult?.unchanged, written: unchangedResult?.written, revision: unchangedResult?.revision, expectedRevision: revB3, history: unchangedResult?.history ?? null });
    const historyAfterUnchanged = await invokeHttp(bridge, 'history', { projectId, limit: 64 });
    checks.check('unchanged publish records no history entry', historyAfterUnchanged.entries.length === historyAfterReplay.entries.length, { before: historyAfterReplay.entries.length, after: historyAfterUnchanged.entries.length });

    const staleTarget = modifyGenreB(fixtureB.html);
    const stale = await callTool(tool, {
      action: 'project.compose',
      projectId,
      expectedRevision: revB2,
      operationId: opId('stale'),
      html: staleTarget.html,
    }, sessionId);
    const inspectAfterStale = await invokeHttp(bridge, 'inspect', { projectId });
    const sourceAfterStale = await sourceThroughTool(tool, sessionId, projectId);
    checks.check('stale expectedRevision is rejected as E_REVISION_CONFLICT with stage compose', stale.ok === false && stale.code === 'E_REVISION_CONFLICT' && stale.stage === 'compose', { actualCode: stale.code, actualStage: stale.stage, message: stale.message.slice(0, 300) });
    checks.check('stale-revision rejection preserves the latest composition (revision + exact bytes)', inspectAfterStale.revision === revB3 && sourceAfterStale.ok === true && sourceAfterStale.value.result.html === modifiedB3.html, { revision: inspectAfterStale.revision, expectedRevision: revB3, sourceEqual: sourceAfterStale.ok === true && sourceAfterStale.value.result.html === modifiedB3.html });

    const finalRevision = revB3;
    const finalHtml = modifiedB3.html;

    // ─── 8. Tool scope enforcement (bound Agent Session only) ──────────────
    const unbound = await callTool(tool, { action: 'project.compose', projectId, expectedRevision: finalRevision, operationId: opId('unbound'), html: modifiedB2.html }, 'session-conv-chain-unbound-1');
    checks.check('compose from an unbound Agent Session is E_SESSION_NOT_BOUND', unbound.ok === false && unbound.code === 'E_SESSION_NOT_BOUND', { actualCode: unbound.code, message: unbound.message.slice(0, 240) });
    const noAgent = await callTool(tool, { action: 'project.compose', projectId, expectedRevision: finalRevision, operationId: opId('noagent'), html: modifiedB2.html }, null);
    checks.check('compose without a trusted Agent Session is E_AGENT_REQUIRED', noAgent.ok === false && noAgent.code === 'E_AGENT_REQUIRED', { actualCode: noAgent.code, message: noAgent.message.slice(0, 240) });
    const otherProject = await invokeHttp(bridge, 'project.create', { templateId: 'product-launch-v1', title: 'P3-012 Other Project' });
    const otherSession = await invokeHttp(bridge, 'session.create', { projectId: otherProject.projectId, requestId: opId('bind-other') });
    const crossFromMain = await callTool(tool, { action: 'project.compose', projectId: otherProject.projectId, expectedRevision: finalRevision, operationId: opId('cross-1'), html: modifiedB2.html }, sessionId);
    checks.check('compose targeting another project from the bound Session is E_PROJECT_SCOPE', crossFromMain.ok === false && crossFromMain.code === 'E_PROJECT_SCOPE', { actualCode: crossFromMain.code, message: crossFromMain.message.slice(0, 240) });
    const crossFromOther = await callTool(tool, { action: 'project.source', projectId }, otherSession.sessionId);
    checks.check('project.source from another project Session is E_PROJECT_SCOPE', crossFromOther.ok === false && crossFromOther.code === 'E_PROJECT_SCOPE', { actualCode: crossFromOther.code, message: crossFromOther.message.slice(0, 240) });
    evidence.scopeChecks = [
      { label: 'unbound-session-compose', code: unbound.code },
      { label: 'no-agent-session-compose', code: noAgent.code },
      { label: 'cross-project-compose', code: crossFromMain.code },
      { label: 'cross-project-source', code: crossFromOther.code },
    ];

    // ─── 9. malformed params through the Tool (host validation) ────────────
    const paramCases = [
      ['missing html', { action: 'project.compose', projectId, expectedRevision: finalRevision, operationId: opId('p-missing-html') }, 'E_PARAMS'],
      ['non-string html', { action: 'project.compose', projectId, expectedRevision: finalRevision, operationId: opId('p-number-html'), html: 42 }, 'E_PARAMS'],
      ['empty html', { action: 'project.compose', projectId, expectedRevision: finalRevision, operationId: opId('p-empty-html'), html: '' }, 'E_PARAMS'],
      ['malformed expectedRevision', { action: 'project.compose', projectId, expectedRevision: 'abc', operationId: opId('p-bad-revision'), html: modifiedB2.html }, 'E_PARAMS'],
      ['malformed operationId', { action: 'project.compose', projectId, expectedRevision: finalRevision, operationId: 'bad id!', html: modifiedB2.html }, 'E_PARAMS'],
      ['unexpected extra parameter', { action: 'project.compose', projectId, expectedRevision: finalRevision, operationId: opId('p-extra'), html: modifiedB2.html, template: {} }, 'E_PARAMS'],
      ['unknown action', { action: 'project.composex', projectId }, 'E_METHOD'],
    ];
    for (const [label, argsFor, expectedCode] of paramCases) {
      const call = await callTool(tool, argsFor, sessionId);
      checks.check('malformed params: ' + label + ' is ' + expectedCode, call.ok === false && call.code === expectedCode, { actualCode: call.code, message: call.message.slice(0, 240) });
      evidence.paramChecks.push({ label, expectedCode, actualCode: call.code });
    }
    const afterParamsInspect = await invokeHttp(bridge, 'inspect', { projectId });
    checks.check('malformed param attempts leave the project revision unchanged', afterParamsInspect.revision === finalRevision, { expected: finalRevision, actual: afterParamsInspect.revision });

    // ─── 10. prompt-context contract (model-facing, spec 4.3) ──────────────
    let contextText = null;
    try {
      contextText = bridge.sessions.contextText({ agent: { session: { id: sessionId } } });
    } catch (error) {
      contextText = null;
    }
    const contextChecks = {
      present: typeof contextText === 'string' && contextText.length > 0,
      boundLine: typeof contextText === 'string' && contextText.includes('This conversation is bound to the video project'),
      videoEngineLine: typeof contextText === 'string' && contextText.includes('Use the video_engine Tool for every project read or write'),
      inspectAction: typeof contextText === 'string' && contextText.includes('"action":"inspect"'),
      sourceAction: typeof contextText === 'string' && contextText.includes('"action":"project.source"'),
      composeAction: typeof contextText === 'string' && contextText.includes('"action":"project.compose"'),
      publishedRevisionLine: typeof contextText === 'string' && contextText.includes('publishedRevision'),
      byteContract: typeof contextText === 'string' && contextText.includes('49152'),
      timelineContract: typeof contextText === 'string' && contextText.includes('window.__timelines'),
      atomicContract: typeof contextText === 'string' && /reject(ed)? atomically|whole document is replaced atomically/i.test(contextText),
      noShellWrites: typeof contextText === 'string' && contextText.includes('Never write project files'),
      freeFormLine: typeof contextText === 'string' && /free-form composition/i.test(contextText),
      latestRevisionFact: typeof contextText === 'string' && contextText.includes(finalRevision),
      durationFact: typeof contextText === 'string' && /Project duration: 5s/.test(contextText),
      frameFact: typeof contextText === 'string' && /Frame: 720x1280/.test(contextText),
      noAbsoluteUserPath: typeof contextText === 'string' && /\/Users\//.test(contextText) === false && contextText.includes(stagingRoot) === false,
      bounded: typeof contextText === 'string' && contextText.length <= 4096,
    };
    for (const [name, ok] of Object.entries(contextChecks)) {
      checks.check('prompt context: ' + name, ok === true, name === 'present' ? { length: typeof contextText === 'string' ? contextText.length : null } : undefined);
    }
    evidence.promptContext = { length: typeof contextText === 'string' ? contextText.length : null, checks: contextChecks, text: typeof contextText === 'string' ? contextText.slice(0, 4200) : null };

    // ─── 11. preview snapshot for the final revision ───────────────────────
    const snapshotFinalCall = await invokeHttp(bridge, 'preview.snapshot', { projectId, revision: finalRevision, ttlMs: 900000 });
    const snapshotFinal = snapshotFinalCall;
    assert(typeof snapshotFinal.snapshotId === 'string' && typeof snapshotFinal.entryUrl === 'string', 'final revision preview snapshot did not return a snapshotId/entryUrl');
    registeredSnapshots.push(snapshotFinal);
    const bytesFinal = await verifySnapshotBytes(host, stateRoot, projectId, snapshotFinal, finalHtml, 'genre-b-final');
    evidence.snapshots.push(bytesFinal);
    checks.check('final-revision snapshot route serves the exact published entry bytes (runtime tag aside)', bytesFinal.entryStatus === 200 && bytesFinal.exactBytesAfterRuntimeStrip === true && bytesFinal.runtimeInjectedOnce === true, { entryStatus: bytesFinal.entryStatus, exact: bytesFinal.exactBytesAfterRuntimeStrip, runtimeInjectedOnce: bytesFinal.runtimeInjectedOnce, servedBytes: bytesFinal.servedBytes, expectedBytes: bytesFinal.expectedBytes });
    checks.check('final-revision snapshot response keeps the locked-down CSP and exact asset bytes', bytesFinal.cspHasConnectNone === true && bytesFinal.cspHasScriptSrc === true && bytesFinal.asset !== null && bytesFinal.asset.status === 200 && bytesFinal.asset.equal === true, { cspHasConnectNone: bytesFinal.cspHasConnectNone, cspHasScriptSrc: bytesFinal.cspHasScriptSrc, asset: bytesFinal.asset });
    const projectEntryBytes = await readFile(join(stateRoot.directories.projects, projectId, 'index.html'));
    checks.check('published entry on disk is byte-identical to the submitted document', sha256(projectEntryBytes) === sha256(Buffer.from(finalHtml, 'utf8')) && projectEntryBytes.length === Buffer.byteLength(finalHtml, 'utf8'), { diskBytes: projectEntryBytes.length, submittedBytes: Buffer.byteLength(finalHtml, 'utf8') });

    // ─── 12. real Chrome load of the final genre B snapshot ────────────────
    console.log('[phase] final snapshot verified; loading genre B in real Chrome');
    const chromeB = await runChromeSnapshot({
      browser,
      host,
      outRoot,
      runDirectory,
      snapshot: snapshotFinal,
      meta: { width: fixtureB.meta.width, height: fixtureB.meta.height, duration: fixtureB.meta.duration },
      seekTarget: 2.0,
      label: 'genre-b-kinetic-typography',
    });
    recordChromeSnapshot(checks, chromeEvidence, chromeB, 'genre-b-kinetic-typography');
    chromeEvidence.consoleErrors = chromeEvidence.snapshots.flatMap((entry) => entry.consoleErrors);
    chromeEvidence.pageErrors = chromeEvidence.snapshots.flatMap((entry) => entry.pageErrors);
    await browser.close();
    browser = null;

    // ─── 13. snapshot release removes every published route ────────────────
    for (const snapshot of registeredSnapshots) {
      const entryRoutePath = snapshot.entryUrl;
      await invokeHttp(bridge, 'preview.release', { snapshotId: snapshot.snapshotId });
      checks.check('preview.release removes the route for snapshot ' + snapshot.snapshotId.slice(0, 8), host.routes.every((route) => route.path !== entryRoutePath), { entryUrl: entryRoutePath });
    }

    // ─── 14. close/reopen persistence ──────────────────────────────────────
    const beforeCloseInspect = await invokeHttp(bridge, 'inspect', { projectId });
    console.log('[phase] close/reopen persistence');
    const closed = await invokeHttp(bridge, 'close', { projectId });
    const reopened = await invokeHttp(bridge, 'open', { projectId });
    const reopenedInspect = await invokeHttp(bridge, 'inspect', { projectId });
    const reopenedSourceCall = await sourceThroughTool(tool, sessionId, projectId);
    const reopenedSource = reopenedSourceCall.ok === true ? reopenedSourceCall.value.result : null;
    checks.check('close/reopen preserves the latest revision and exact composition bytes', reopenedInspect.revision === finalRevision
      && reopenedSource !== null && reopenedSource.html === finalHtml && reopenedSource.revision === finalRevision
      && closed !== null && typeof closed === 'object' && beforeCloseInspect.revision === finalRevision, {
      closed: closed && closed.closed === true,
      reopenedRevision: reopenedInspect.revision,
      expectedRevision: finalRevision,
      sourceEqual: reopenedSource !== null ? reopenedSource.html === finalHtml : null,
      openResultRevision: reopened !== null && typeof reopened === 'object' ? reopened.revision : null,
    });
    evidence.reopen = { revision: reopenedInspect.revision, sourceBytes: reopenedSource === null ? null : reopenedSource.bytes, sourceEqual: reopenedSource !== null ? reopenedSource.html === finalHtml : null };
    await invokeHttp(bridge, 'close', { projectId });

    // ─── 15. R1: publish settlement when the history stage fails ────────────
    // Separate temp project on the same real staged bridge/worker/Tool so the
    // normal-chain content assertions above stay untouched.
    console.log('[phase] R1 history-settlement regressions (separate temp project)');
    const r1Evidence = { projectId: null, sessionId: null, baselineRevision: null, historyEntriesBytes: null, degraded: null, recovered: null, steps: [] };
    evidence.r1 = r1Evidence;
    const r1Project = await invokeHttp(bridge, 'project.create', { templateId: 'product-launch-v1', title: 'P3-012 R1 Settlement' });
    const r1ProjectId = r1Project.projectId;
    const r1Session = await invokeHttp(bridge, 'session.create', { projectId: r1ProjectId, requestId: opId('r1-bind') });
    const r1SessionId = r1Session.sessionId;
    r1Evidence.projectId = r1ProjectId;
    r1Evidence.sessionId = r1SessionId;
    const r1Dir = join(stateRoot.directories.projects, r1ProjectId);
    const r1HistoryDir = join(r1Dir, '.dsh-video', 'history');
    const r1EntriesPath = join(r1HistoryDir, 'entries.jsonl');
    const r1EntryPath = join(r1Dir, 'index.html');
    let r1Inspect = await invokeHttp(bridge, 'inspect', { projectId: r1ProjectId });
    r1Evidence.baselineRevision = r1Inspect.revision;
    const r1FixtureA = genreA();
    const r1ComposeA = await callTool(tool, { action: 'project.compose', projectId: r1ProjectId, expectedRevision: r1Inspect.revision, operationId: opId('r1-compose-a'), html: r1FixtureA.html }, r1SessionId);
    const r1ResultA = r1ComposeA.ok === true ? r1ComposeA.value.result : null;
    checks.check('R1: baseline compose publishes normally with history recorded', r1ComposeA.ok === true && r1ResultA !== null && r1ResultA.history !== null && typeof r1ResultA.history === 'object' && r1ResultA.history.status === 'recorded' && Number.isInteger(r1ResultA.history.historyCursor), { ok: r1ComposeA.ok, code: r1ComposeA.code, history: r1ResultA?.history ?? null });
    if (r1ResultA === null) throw new Error('R1 baseline compose failed: ' + String(r1ComposeA.message || r1ComposeA.code));
    const r1RevA = r1ResultA.revision;
    const r1EntriesOriginal = await readFile(r1EntriesPath);
    r1Evidence.historyEntriesBytes = r1EntriesOriginal.length;
    checks.check('R1: baseline publish initialized the project history stage', r1EntriesOriginal.length > 0, { bytes: r1EntriesOriginal.length });
    // Break the history READ stage: entries.jsonl becomes a directory (EISDIR).
    await rm(r1EntriesPath, { force: true });
    await mkdir(r1EntriesPath, { recursive: true });
    r1Evidence.steps.push('history-entries-replaced-by-directory');
    const r1FixtureB = genreB();
    const r1DegradedOp = 'r1-degraded-op-' + randomUUID().replace(/-/g, '').slice(0, 10);
    const r1ComposeB = await callTool(tool, { action: 'project.compose', projectId: r1ProjectId, expectedRevision: r1RevA, operationId: r1DegradedOp, html: r1FixtureB.html }, r1SessionId);
    const r1ResultB = r1ComposeB.ok === true ? r1ComposeB.value.result : null;
    r1Evidence.degraded = { ok: r1ComposeB.ok, code: r1ComposeB.code ?? null, message: String(r1ComposeB.message || '').slice(0, 300), history: r1ResultB?.history ?? null, revision: r1ResultB?.revision ?? null, publishedRevision: r1ResultB?.publishedRevision ?? null };
    checks.check('R1: compose succeeds when the history stage fails (not an ordinary not-published failure)', r1ComposeB.ok === true && r1ResultB !== null, { code: r1ComposeB.code ?? null, message: r1Evidence.degraded.message, history: r1Evidence.degraded.history });
    checks.check('R1: degraded publish returns a real new publishedRevision (no stale marker)', r1ResultB !== null && typeof r1ResultB.publishedRevision === 'string' && SHA256.test(r1ResultB.publishedRevision) && r1ResultB.publishedRevision === r1ResultB.revision && r1ResultB.revision !== r1RevA, { revision: r1ResultB?.revision ?? null, publishedRevision: r1ResultB?.publishedRevision ?? null, previous: r1RevA });
    checks.check('R1: degraded settlement is structured (history.status=degraded + bounded stable code)', r1ResultB !== null && r1ResultB.history !== null && typeof r1ResultB.history === 'object' && r1ResultB.history.status === 'degraded' && typeof r1ResultB.history.code === 'string' && /^E_[A-Z0-9_]+$/.test(r1ResultB.history.code) && r1ResultB.history.code.length <= 64, { history: r1ResultB?.history ?? null });
    checks.check('R1: degraded result keeps truthful publish markers (written/unchanged/preview)', r1ResultB !== null && r1ResultB.written === true && r1ResultB.unchanged === false && r1ResultB.preview !== null && typeof r1ResultB.preview === 'object' && r1ResultB.preview.status === 'ready' && r1ResultB.preview.revision === r1ResultB.revision, { written: r1ResultB?.written ?? null, unchanged: r1ResultB?.unchanged ?? null, preview: r1ResultB?.preview ?? null });
    const r1InspectAfterDegraded = await invokeHttp(bridge, 'inspect', { projectId: r1ProjectId });
    const r1SourceAfterDegraded = await sourceThroughTool(tool, r1SessionId, r1ProjectId);
    const r1DegradedRevision = r1ResultB !== null && typeof r1ResultB.revision === 'string' ? r1ResultB.revision : r1InspectAfterDegraded.revision;
    checks.check('R1: after degraded publish inspect/source expose the real new revision and exact bytes', r1InspectAfterDegraded.revision === r1DegradedRevision && r1SourceAfterDegraded.ok === true && r1SourceAfterDegraded.value.result.html === r1FixtureB.html && r1SourceAfterDegraded.value.result.revision === r1DegradedRevision, { inspectRevision: r1InspectAfterDegraded.revision, expectedRevision: r1DegradedRevision, sourceOk: r1SourceAfterDegraded.ok, sourceEqual: r1SourceAfterDegraded.ok === true ? r1SourceAfterDegraded.value.result.html === r1FixtureB.html : null });
    const r1DiskAfterDegraded = await readFile(r1EntryPath);
    checks.check('R1: degraded publish actually wrote the new entry bytes to disk', sha256(r1DiskAfterDegraded) === sha256(Buffer.from(r1FixtureB.html, 'utf8')), { diskBytes: r1DiskAfterDegraded.length, expectedBytes: Buffer.byteLength(r1FixtureB.html, 'utf8') });
    // Pre-commit failures keep their normal classification even while the history
    // stage is broken (three-state semantics: clear failure preserves old state).
    const r1StaleWhileBroken = await callTool(tool, { action: 'project.compose', projectId: r1ProjectId, expectedRevision: r1RevA, operationId: opId('r1-stale-broken'), html: r1FixtureA.html }, r1SessionId);
    checks.check('R1: stale expectedRevision while history is broken is still E_REVISION_CONFLICT (not a degraded success)', r1StaleWhileBroken.ok === false && r1StaleWhileBroken.code === 'E_REVISION_CONFLICT', { actualCode: r1StaleWhileBroken.code ?? null });
    const r1InvalidWhileBroken = await callTool(tool, { action: 'project.compose', projectId: r1ProjectId, expectedRevision: r1DegradedRevision, operationId: opId('r1-invalid-broken'), html: '<div id="main" data-composition-id="x" data-width="320" data-height="180" data-duration="1">no timeline</div>' }, r1SessionId);
    checks.check('R1: invalid composition while history is broken is still E_COMPOSE_INVALID (not a degraded success)', r1InvalidWhileBroken.ok === false && r1InvalidWhileBroken.code === 'E_COMPOSE_INVALID', { actualCode: r1InvalidWhileBroken.code ?? null });
    const r1InspectAfterPreCommit = await invokeHttp(bridge, 'inspect', { projectId: r1ProjectId });
    checks.check('R1: pre-commit failures while history is broken leave the published revision/bytes untouched', r1InspectAfterPreCommit.revision === r1DegradedRevision, { revision: r1InspectAfterPreCommit.revision, expectedRevision: r1DegradedRevision });
    // Same operationId retry: identical payload -> identical cached result, no second write.
    const r1Retry = await callTool(tool, { action: 'project.compose', projectId: r1ProjectId, expectedRevision: r1RevA, operationId: r1DegradedOp, html: r1FixtureB.html }, r1SessionId);
    const r1RetryResult = r1Retry.ok === true ? r1Retry.value.result : null;
    const r1RetryInspect = await invokeHttp(bridge, 'inspect', { projectId: r1ProjectId });
    const r1RetryDisk = await readFile(r1EntryPath);
    checks.check('R1: same-operationId retry after a degraded publish returns the identical cached result (deep-equal)', r1Retry.ok === true && r1RetryResult !== null && JSON.stringify(r1RetryResult) === JSON.stringify(r1ResultB), { retryOk: r1Retry.ok, retryCode: r1Retry.code ?? null, history: r1RetryResult?.history ?? null });
    checks.check('R1: degraded retry performs no second write (revision and on-disk content unchanged)', r1RetryInspect.revision === r1DegradedRevision && sha256(r1RetryDisk) === sha256(r1DiskAfterDegraded), { revision: r1RetryInspect.revision, expectedRevision: r1DegradedRevision });
    const r1Reuse = await callTool(tool, { action: 'project.compose', projectId: r1ProjectId, expectedRevision: r1RevA, operationId: r1DegradedOp, html: r1FixtureA.html }, r1SessionId);
    checks.check('R1: a different payload on the degraded operationId is still E_OPERATION_REUSED', r1Reuse.ok === false && r1Reuse.code === 'E_OPERATION_REUSED', { actualCode: r1Reuse.code ?? null });
    // Restore history: the next publish must record again.
    await rm(r1EntriesPath, { recursive: true, force: true });
    await writeFile(r1EntriesPath, r1EntriesOriginal);
    const r1RestoredEntries = await readFile(r1EntriesPath);
    checks.check('R1: history entries restored byte-identically for the recovery probe', sha256(r1RestoredEntries) === sha256(r1EntriesOriginal), { bytes: r1RestoredEntries.length });
    const r1FixtureA2 = genreAModified();
    const r1RecoveredCall = await callTool(tool, { action: 'project.compose', projectId: r1ProjectId, expectedRevision: r1DegradedRevision, operationId: opId('r1-compose-recovered'), html: r1FixtureA2.html }, r1SessionId);
    const r1ResultRecovered = r1RecoveredCall.ok === true ? r1RecoveredCall.value.result : null;
    const r1RecordedHistory = r1ResultRecovered?.history ?? null;
    checks.check('R1: after history restore the next compose records history again (status=recorded)', r1RecoveredCall.ok === true && r1ResultRecovered !== null && r1RecordedHistory !== null && typeof r1RecordedHistory === 'object' && r1RecordedHistory.status === 'recorded' && Number.isInteger(r1RecordedHistory.historyCursor), { ok: r1RecoveredCall.ok, code: r1RecoveredCall.code ?? null, history: r1RecordedHistory });
    checks.check('R1: recovered publish returns a fresh real revision with publishedRevision marker', r1ResultRecovered !== null && typeof r1ResultRecovered.revision === 'string' && SHA256.test(r1ResultRecovered.revision) && r1ResultRecovered.revision !== r1DegradedRevision && r1ResultRecovered.publishedRevision === r1ResultRecovered.revision, { revision: r1ResultRecovered?.revision ?? null, previous: r1DegradedRevision });
    const r1SourceRecovered = await sourceThroughTool(tool, r1SessionId, r1ProjectId);
    const r1InspectRecovered = await invokeHttp(bridge, 'inspect', { projectId: r1ProjectId });
    checks.check('R1: recovered source/inspect are consistent with the recorded publish', r1SourceRecovered.ok === true && r1SourceRecovered.value.result.html === r1FixtureA2.html && r1InspectRecovered.revision === (r1ResultRecovered === null ? null : r1ResultRecovered.revision), { inspectRevision: r1InspectRecovered.revision, expectedRevision: r1ResultRecovered?.revision ?? null, sourceEqual: r1SourceRecovered.ok === true ? r1SourceRecovered.value.result.html === r1FixtureA2.html : null });
    r1Evidence.recovered = { revision: r1ResultRecovered?.revision ?? null, history: r1RecordedHistory };
    r1Evidence.steps.push('degraded-success', 'retry-cached-deep-equal', 'restore-history', 'recovered-recorded');

    // Adversarial R1 follow-up: the OTHER history stages must also settle as a
    // degraded success (never an ordinary not-published failure), and restoring
    // each stage must let the next publish record history again.
    const r1StageCases = [];
    const r1StageDocs = {
      snapshot: { degraded: genreB().html, recovered: genreA().html },
      entries: { degraded: modifyGenreB(genreB().html).html, recovered: genreAModified().html },
      ops: { degraded: modifyGenreBAgain(modifyGenreB(genreB().html).html).html, recovered: genreB().html },
    };
    let r1StageCurrentHtml = r1FixtureA2.html;
    let r1StageCurrentRevision = r1ResultRecovered !== null && typeof r1ResultRecovered.revision === 'string' ? r1ResultRecovered.revision : r1InspectRecovered.revision;
    async function r1HistoryStageCase(label, breakStage, restoreStage, docs) {
      const expectedRevision = (await invokeHttp(bridge, 'inspect', { projectId: r1ProjectId })).revision;
      const degradedOp = 'r1-stage-' + label + '-' + randomUUID().replace(/-/g, '').slice(0, 10);
      await breakStage();
      let degradedCall;
      try {
        degradedCall = await callTool(tool, { action: 'project.compose', projectId: r1ProjectId, expectedRevision, operationId: degradedOp, html: docs.degraded }, r1SessionId);
      } finally {
        await restoreStage();
      }
      const degradedResult = degradedCall.ok === true ? degradedCall.value.result : null;
      const inspectAfter = await invokeHttp(bridge, 'inspect', { projectId: r1ProjectId });
      const sourceAfter = await sourceThroughTool(tool, r1SessionId, r1ProjectId);
      const newRevision = degradedResult !== null && typeof degradedResult.revision === 'string' ? degradedResult.revision : inspectAfter.revision;
      checks.check('R1 stage ' + label + ': history-stage write failure settles as degraded success (not ordinary failure)', degradedCall.ok === true && degradedResult !== null && degradedResult.history !== null && typeof degradedResult.history === 'object' && degradedResult.history.status === 'degraded', { code: degradedCall.code ?? null, message: String(degradedCall.message || '').slice(0, 200), history: degradedResult?.history ?? null });
      checks.check('R1 stage ' + label + ': degraded publish really committed the new revision and source is consistent', inspectAfter.revision === newRevision && sourceAfter.ok === true && sourceAfter.value.result.html === docs.degraded, { inspectRevision: inspectAfter.revision, expectedRevision: newRevision, sourceEqual: sourceAfter.ok === true ? sourceAfter.value.result.html === docs.degraded : null });
      const recoveredCall = await callTool(tool, { action: 'project.compose', projectId: r1ProjectId, expectedRevision: newRevision, operationId: opId('r1-stage-recover-' + label), html: docs.recovered }, r1SessionId);
      const recoveredResult = recoveredCall.ok === true ? recoveredCall.value.result : null;
      checks.check('R1 stage ' + label + ': after restoring the history stage the next compose records history again', recoveredCall.ok === true && recoveredResult !== null && recoveredResult.history !== null && typeof recoveredResult.history === 'object' && recoveredResult.history.status === 'recorded', { code: recoveredCall.code ?? null, history: recoveredResult?.history ?? null });
      if (recoveredResult !== null && typeof recoveredResult.revision === 'string') {
        r1StageCurrentRevision = recoveredResult.revision;
        r1StageCurrentHtml = docs.recovered;
      }
      r1StageCases.push({ label, degradedRevision: newRevision, degradedHistory: degradedResult?.history ?? null, recoveredHistory: recoveredResult?.history ?? null });
    }
    try {
      await r1HistoryStageCase('snapshot-dir-write', async () => { await chmod(join(r1HistoryDir, 'snapshots'), 0o555); }, async () => { await chmod(join(r1HistoryDir, 'snapshots'), 0o755); }, r1StageDocs.snapshot);
      await r1HistoryStageCase('entries-write', async () => { await chmod(r1HistoryDir, 0o555); }, async () => { await chmod(r1HistoryDir, 0o755); }, r1StageDocs.entries);
      await r1HistoryStageCase('ops-append', async () => { await chmod(join(r1HistoryDir, 'ops.jsonl'), 0o444); }, async () => { await chmod(join(r1HistoryDir, 'ops.jsonl'), 0o644); }, r1StageDocs.ops);
    } finally {
      // Never leave the temp project dirs unwritable for teardown/report.
      try { await chmod(join(r1HistoryDir, 'snapshots'), 0o755); } catch (_error) { /* best effort */ }
      try { await chmod(r1HistoryDir, 0o755); } catch (_error) { /* best effort */ }
      try { await chmod(join(r1HistoryDir, 'ops.jsonl'), 0o644); } catch (_error) { /* best effort */ }
    }
    r1Evidence.stageCases = r1StageCases;
    r1Evidence.steps.push('history-stage-failures-degraded', 'history-stage-restored-recorded');
    await invokeHttp(bridge, 'close', { projectId: r1ProjectId });
    console.log('[phase] R1 history-settlement regressions done');

    console.log('[phase] all assertions done; building evidence');

    checks.check('every recorded acceptance check passed', true, { checks: checks.checks.length });
  } catch (error) {
    evidence.fatalError = {
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    };
    console.error('harness failed:', evidence.fatalError.message);
  } finally {
    if (browser !== null) await browser.close().catch(() => {});
    if (server !== null) {
      if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
      await new Promise((resolveClose) => server.close(resolveClose)).catch(() => {});
    }
    let teardown = null;
    if (bridge !== null) {
      const beforeDispose = bridge.state();
      try {
        await bridge.dispose();
      } catch (_error) {
        /* reported below */
      }
      const afterDispose = bridge.state();
      teardown = {
        bridgeBeforeDispose: beforeDispose,
        bridgeAfterDispose: afterDispose,
        routesAfterDispose: host === null ? null : host.routes.length,
        snapshotRecordsAfterDispose: bridge.snapshots.records.size,
        disposed: bridge.disposed === true,
      };
      teardown.ok = teardown.bridgeAfterDispose.inFlight === 0 && teardown.routesAfterDispose === 0 && teardown.snapshotRecordsAfterDispose === 0 && teardown.disposed === true;
    }
    checks.check('honest teardown: no in-flight bridge work, routes or snapshot records survive dispose', teardown !== null && teardown.ok === true, teardown);
    evidence.teardown = teardown;
    if (stagingBefore !== null && staged !== null) {
      try {
        const stagingAfter = await listStagingSources(staged.evidence.staging);
        evidence.stagingReadOnly = {
          ...compareStagingSources(stagingBefore, stagingAfter),
          note: 'Only immutable source/config files are compared; worker business dirs, node_modules, caches and evidence/ are excluded.',
        };
      } catch (error) {
        evidence.stagingReadOnly = { same: null, error: error instanceof Error ? error.message : String(error) };
      }
    }
    evidence.checks = checks.checks;
    evidence.summary = { total: checks.checks.length, passed: checks.passed(), failed: checks.checks.length - checks.passed() };
    evidence.ok = checks.ok() && evidence.fatalError === undefined && evidence.stagingReadOnly !== null && evidence.stagingReadOnly.same !== false;
    if (evidence.stagingReadOnly !== null && evidence.stagingReadOnly.same !== true) evidence.ok = false;
    evidence.finishedAt = new Date().toISOString();
    const evidenceFile = await writeEvidence(outRoot, runDirectory, 'conversation-chain', evidence);
    console.log(JSON.stringify({
      evidence: evidenceFile,
      ok: evidence.ok,
      checks: evidence.summary,
      failures: evidence.failureMatrix.length,
      composeRounds: evidence.composeRounds.map((round) => ({ round: round.round, genre: round.genre, revision: round.revision, width: round.width, height: round.height, duration: round.duration })),
      chrome: evidence.chrome === null ? null : evidence.chrome.snapshots.map((entry) => ({ label: entry.label, ready: entry.ready, seekTime: entry.seek && entry.seek.time, stateAfterPlay: entry.stateAfterPlay && entry.stateAfterPlay.time, assertions: entry.assertions })),
      r1: evidence.r1 === null ? null : evidence.r1.degraded,
      engineCommit: evidence.engineCommit,
      rootCommit: evidence.rootCommit,
    }, null, 2));
  }
  process.exitCode = evidence.ok === true ? 0 : 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
