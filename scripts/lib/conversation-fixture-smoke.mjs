#!/usr/bin/env node
/**
 * P3-012 verifier interim fixture smoke (Lead-requested de-risking step).
 *
 * The P3-012 composition `project.compose` path does not exist in any staging
 * snapshot yet. This helper proves the verifier's two genre fixtures are real,
 * renderable and playable on the currently installed immutable staging snapshot
 * (engine 0.3.2) by exercising only pre-existing Host/worker/browser paths:
 *
 *   - create a managed project through the real staged Host bridge with ALL
 *     mutable bridge/worker state redirected into a fresh OS temp dir;
 *   - replace that TEMP project's entry with the fixture index.html (the staged
 *     demo project supplies assets/gsap.min.js when project.create did not);
 *   - close/reopen so the real worker re-reads the fixture from disk;
 *   - inspect -> assert parsed width/height/duration/elements/entry digest;
 *   - frame at t=0 and t=2.5 -> assert succeeded jobs + non-empty changing PNGs;
 *   - preview.snapshot -> assert the entry route (with instance/nonce params)
 *     serves the exact fixture bytes (only the fixed runtime tag injected) with
 *     the locked CSP, and the declared asset is served byte-exact;
 *   - load that snapshot URL in real Chrome through the fixed canvas runtime ->
 *     assert ready (width/height/duration), seek lands, play advances; screenshot
 *     both genres.
 *
 * The installed staging tree is READ ONLY: nothing inside it is written; only
 * verified modules are imported and the demo asset is read. Evidence goes to
 * artifacts/p3-012/evidence/, never staging.
 *
 * Usage:
 *   node scripts/lib/conversation-fixture-smoke.mjs --staging <absolute staging dir> [--out <abs evidence dir>]
 */

import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { loadStagedHost } from './staged-host.mjs';
import {
  DEFAULT_EVIDENCE_ROOT,
  UsageError,
  assert,
  compareStagingSources,
  createChecks,
  fakeCtx,
  invokeHttp,
  listStagingSources,
  parseCli,
  prepareStateRoot,
  sha256,
  sleep,
  stamp,
  writeEvidence,
} from './conversation-harness.mjs';
import { checkCompositionContract, genreA, genreB } from './conversation-fixtures.mjs';

const KIND = 'p3-012-fixture-smoke';
const INSTANCE = 'p3012fixture1';
const NONCE = '0123456789abcdef0123456789abcdef';
const TERMINAL = new Set(['succeeded', 'failed', 'cancelled', 'timed_out']);

function runtimePageSource(entryUrl, composition, seekTarget) {
  const scale = Math.min(560 / composition.width, 640 / composition.height, 1);
  const stageWidth = Math.round(composition.width * scale * 100) / 100;
  const stageHeight = Math.round(composition.height * scale * 100) / 100;
  return `<!doctype html>
<html><head><meta charset="utf-8"><style>
html,body{margin:0;background:#111;color:#eee;font:13px sans-serif}
#stage{position:relative;width:${stageWidth}px;height:${stageHeight}px;margin:16px;background:#000;overflow:hidden}
iframe{position:absolute;left:0;top:0;width:${composition.width}px;height:${composition.height}px;border:0;transform:scale(${scale});transform-origin:top left}
</style></head><body><div id="stage"></div><script>
var result={started:Date.now(),events:[],done:false};window.__RESULT__=result;
try{
  var instance=${JSON.stringify(INSTANCE)},nonce=${JSON.stringify(NONCE)},seekTarget=${JSON.stringify(seekTarget)};
  var frame=document.createElement('iframe');
  frame.sandbox='allow-scripts';frame.referrerPolicy='no-referrer';
  document.getElementById('stage').appendChild(frame);
  var seq=0,pending=new Map();
  function command(type,payload){return new Promise(function(resolveCommand){
    var id=++seq;var timer=setTimeout(function(){pending.delete(id);resolveCommand(null);},5000);
    pending.set(id,{resolve:resolveCommand,timer:timer});
    frame.contentWindow.postMessage({v:1,kind:'cmd',instanceId:instance,nonce:nonce,seq:id,type:type,payload:payload||{}},'*');
  });}
  window.addEventListener('message',function(event){
    if(event.source!==frame.contentWindow)return;
    var data=event.data;
    if(!data||data.kind!=='evt'||data.instanceId!==instance||data.nonce!==nonce)return;
    result.events.push(data.type);
    if(data.replyTo&&pending.has(data.replyTo)){var item=pending.get(data.replyTo);pending.delete(data.replyTo);clearTimeout(item.timer);item.resolve(data.payload);}
    if(data.type==='ready'){
      result.ready=data.payload;
      (async function(){
        result.seek=await command('seek',{time:seekTarget});
        result.stateAtSeek=await command('state');
        await command('play');
        await new Promise(function(r){setTimeout(r,520);});
        result.stateAfterPlay=await command('state');
        await command('pause');
        result.done=true;
      })().catch(function(error){result.error=String(error);result.done=true;});
    }
    if(data.type==='error'){result.error=data.payload&&data.payload.message;}
  });
  frame.src=${JSON.stringify(entryUrl)}+'?instance='+encodeURIComponent(instance)+'&nonce='+nonce;
  setTimeout(function(){if(!result.done){result.timeout=true;result.done=true;}},20000);
}catch(error){result.error=String(error);result.done=true;}
</script></body></html>`;
}

async function waitJob(bridge, jobId, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    last = await invokeHttp(bridge, 'status', { jobId });
    if (TERMINAL.has(last.state)) return last;
    await sleep(300);
  }
  throw new Error('job ' + jobId + ' did not settle; last state ' + (last === null ? 'unknown' : last.state));
}

async function captureFrame(bridge, evidenceDirectory, projectId, revision, time, label) {
  const started = await invokeHttp(bridge, 'frame', { projectId, revision, time });
  const settled = await waitJob(bridge, started.jobId, 180000);
  assert(settled.state === 'succeeded' && settled.artifact !== null && settled.artifact !== undefined, 'frame ' + label + ' did not succeed: ' + settled.state);
  const artifact = await bridge.readArtifact(started.jobId);
  const bytes = Buffer.from(artifact.bytes);
  assert(bytes.length > 8 && bytes[0] === 0x89 && bytes.toString('ascii', 1, 4) === 'PNG', 'frame artifact is not a PNG');
  const pngPath = join(evidenceDirectory, 'frame-' + label + '.png');
  await writeFile(pngPath, bytes);
  return { label, jobId: started.jobId, state: settled.state, bytes: bytes.length, sha256: sha256(bytes), pngPath, artifact: settled.artifact };
}

async function main() {
  const startedAt = new Date();
  let args;
  try {
    args = parseCli(process.argv.slice(2), { allowOut: true });
  } catch (error) {
    if (error instanceof UsageError) {
      console.error(error.message);
      console.error('usage: node scripts/lib/conversation-fixture-smoke.mjs --staging <absolute staging directory> [--out <absolute evidence dir>]');
      process.exit(2);
    }
    throw error;
  }
  const staging = resolve(args.staging);
  const outRoot = args.out !== undefined ? resolve(args.out) : DEFAULT_EVIDENCE_ROOT;
  const runDirectory = 'fixture-smoke-' + stamp(startedAt);
  const evidenceDirectory = join(outRoot, runDirectory);
  await mkdir(evidenceDirectory, { recursive: true });
  const evidence = {
    kind: KIND,
    startedAt: startedAt.toISOString(),
    command: 'node scripts/lib/conversation-fixture-smoke.mjs ' + process.argv.slice(2).join(' '),
    staging,
    note: 'Interim read-only fixture de-risking run on the pre-P3-012 engine snapshot (no project.compose exists there). It proves the verifier fixtures inspect/frame/snapshot/play correctly; it is NOT the P3-012 acceptance run. The installed staging tree is never written; all mutable bridge state lives in an OS temp dir.',
    checks: null,
    fixtures: [],
    frames: [],
    snapshots: [],
    chrome: [],
    teardown: null,
    stagingReadOnly: null,
  };
  const checks = createChecks();
  let staged = null;
  let bridge = null;
  let host = null;
  let stateRoot = null;
  let browser = null;
  let server = null;
  let stagingBefore = null;

  try {
    staged = await loadStagedHost(staging);
    const stagingRoot = staged.evidence.staging;
    stagingBefore = await listStagingSources(stagingRoot);
    evidence.host = staged.evidence;
    evidence.engineCommit = staged.integrity.engineCommit;
    evidence.rootCommit = staged.integrity.rootCommit;
    evidence.versions = staged.integrity.versions;
    checks.check('staging snapshot verified by INTEGRITY digests (read-only run)', true, { rootCommit: staged.integrity.rootCommit, engineCommit: staged.integrity.engineCommit, versions: staged.integrity.versions });
    assert(typeof staged.integrity.browser === 'string', 'staging INTEGRITY has no browser path');

    const cases = [
      { label: 'genre-a-inline-svg', built: genreA(), seekTarget: 2.4 },
      { label: 'genre-b-kinetic-typography', built: genreB(), seekTarget: 2.0 },
    ];
    for (const fixtureCase of cases) {
      const contract = checkCompositionContract(fixtureCase.built.html, fixtureCase.label);
      evidence.fixtures.push({ label: fixtureCase.label, bytes: Buffer.byteLength(fixtureCase.built.html, 'utf8'), meta: fixtureCase.built.meta, contractOk: contract.ok, problems: contract.problems, facts: contract.facts });
      checks.check('fixture ' + fixtureCase.label + ' satisfies the frozen composition contract', contract.ok, contract.problems);
    }

    stateRoot = await prepareStateRoot(stagingRoot, staged.config, 'dsh-p3012-fixture-smoke-');
    evidence.stateRoot = stateRoot.base;
    host = fakeCtx('fixture-smoke');
    bridge = new staged.VideoBridge({ ctx: host.ctx, rawConfig: stateRoot.config });

    const created = await invokeHttp(bridge, 'project.create', { templateId: 'product-launch-v1', title: 'P3-012 Fixture Smoke' });
    const projectId = created.projectId;
    evidence.projectId = projectId;
    const projectDirectory = join(stateRoot.directories.projects, projectId);
    const demoGsap = await readFile(join(stagingRoot, 'projects', 'demo', 'assets', 'gsap.min.js')).catch(() => null);
    assert(demoGsap !== null, 'staged demo project has no assets/gsap.min.js to copy');
    checks.check('staged demo project supplies the declared GSAP asset used by the fixtures', demoGsap.length > 0, { bytes: demoGsap.length });

    const puppeteer = createRequire(join(stagingRoot, 'engine-worker', 'package.json'))('puppeteer-core');
    browser = await puppeteer.launch({
      executablePath: staged.integrity.browser,
      headless: true,
      defaultViewport: { width: 900, height: 800, deviceScaleFactor: 1 },
      args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--hide-scrollbars'],
    });

    // One toy snapshot server is (re)used per case; `activeEntry` changes per run.
    let activeEntry = null;
    let activeComposition = { width: 1280, height: 720 };
    let activeSeek = 0;
    server = createServer(async (request, response) => {
      try {
        const url = new URL(request.url, 'http://127.0.0.1');
        const origin = 'http://127.0.0.1:' + server.address().port;
        if (url.pathname === '/') {
          response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
          response.end(runtimePageSource(activeEntry, activeComposition, activeSeek));
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
    evidence.origin = origin;

    for (const fixtureCase of cases) {
      const { label, built, seekTarget } = fixtureCase;
      const html = built.html;
      const meta = built.meta;
      const fixtureIndex = evidence.fixtures.findIndex((entry) => entry.label === label);
      await invokeHttp(bridge, 'close', { projectId });
      await writeFile(join(projectDirectory, 'index.html'), html, 'utf8');
      const opened = await invokeHttp(bridge, 'open', { projectId });
      const revision = opened.revision;
      checks.check(label + ': worker reopens the fixture composition from disk', typeof revision === 'string' && /^[a-f0-9]{64}$/.test(revision), { revision });
      checks.check(label + ': inspect parses width/height/duration from the composition', Number(opened.width) === meta.width && Number(opened.height) === meta.height && Math.abs(Number(opened.duration) - meta.duration) < 0.001, { expected: { width: meta.width, height: meta.height, duration: meta.duration }, actual: { width: opened.width, height: opened.height, duration: opened.duration } });
      const elements = Array.isArray(opened.elements) ? opened.elements : [];
      checks.check(label + ': inspect exposes the composition elements', elements.length >= 1, { elements: elements.map((element) => ({ stableId: element.stableId, capabilities: element.capabilities })).slice(0, 12) });
      const files = Array.isArray(opened.files) ? opened.files : [];
      const entryFile = files.find((file) => file.path === 'index.html');
      checks.check(label + ': inspect reports the entry digest matching the fixture bytes', entryFile !== undefined && entryFile.bytes === Buffer.byteLength(html, 'utf8') && entryFile.sha256 === sha256(Buffer.from(html, 'utf8')), { entryFile, expectedBytes: Buffer.byteLength(html, 'utf8') });
      evidence.fixtures[fixtureIndex] = {
        ...evidence.fixtures[fixtureIndex],
        revision,
        inspected: { width: opened.width, height: opened.height, duration: opened.duration, elements: elements.length, scenes: Array.isArray(opened.scenes) ? opened.scenes.length : null, stableIds: elements.map((element) => element.stableId).slice(0, 12) },
      };

      const frame0 = await captureFrame(bridge, evidenceDirectory, projectId, revision, 0, label + '-t0');
      const frame25 = await captureFrame(bridge, evidenceDirectory, projectId, revision, 2.5, label + '-t2.5');
      evidence.frames.push(frame0, frame25);
      checks.check(label + ': frame at t=0 and t=2.5 both succeed with non-empty, different PNG artifacts', frame0.bytes > 0 && frame25.bytes > 0 && frame0.sha256 !== frame25.sha256, { t0: { bytes: frame0.bytes, sha256: frame0.sha256.slice(0, 16) }, t25: { bytes: frame25.bytes, sha256: frame25.sha256.slice(0, 16) } });

      const snapshot = await invokeHttp(bridge, 'preview.snapshot', { projectId, revision, ttlMs: 900000 });
      const entryPathWithParams = snapshot.entryUrl + '?instance=' + INSTANCE + '&nonce=' + NONCE;
      const entryRoute = host.routes.find((candidate) => candidate.path === snapshot.entryUrl);
      assert(entryRoute !== undefined, 'snapshot entry route is not registered');
      const entryResponse = await entryRoute.fetch(new Request(origin + entryPathWithParams, { method: 'GET' }));
      const entryHtml = await entryResponse.text();
      const assetRoute = host.routes.find((candidate) => typeof candidate.path === 'string' && candidate.path.endsWith('/assets/gsap.min.js'));
      const assetResponse = assetRoute === undefined ? null : await assetRoute.fetch(new Request(origin + assetRoute.path));
      const csp = entryResponse.headers.get('content-security-policy') || '';
      const servedAsset = assetResponse === null ? null : Buffer.from(await assetResponse.arrayBuffer());
      const snapshotFacts = {
        label,
        revision,
        snapshotId: snapshot.snapshotId,
        entryUrl: snapshot.entryUrl,
        entryStatus: entryResponse.status,
        contentType: entryResponse.headers.get('content-type'),
        exactBytesAfterRuntimeStrip: null,
        runtimeInjectedOnce: (entryHtml.match(/canvas-runtime\.js/g) || []).length === 1,
        cspHasConnectNone: /connect-src\s+'none'/.test(csp),
        cspHasScriptSrc: /script-src/.test(csp),
        assetStatus: assetResponse === null ? null : assetResponse.status,
        assetBytes: servedAsset === null ? null : servedAsset.length,
        assetEqual: servedAsset === null ? null : sha256(servedAsset) === sha256(demoGsap),
      };
      // Recover the exact entry bytes: the Host injects exactly one
      // `<script src="...canvas-runtime.js?...."></script>\n` before </body>.
      const injected = /<script src="[^"]*canvas-runtime\.js[^"]*"><\/script>\n/.exec(entryHtml);
      if (injected !== null) {
        snapshotFacts.exactBytesAfterRuntimeStrip = entryHtml.slice(0, injected.index) + entryHtml.slice(injected.index + injected[0].length) === html;
        snapshotFacts.injectedTag = injected[0].slice(0, 160);
      }
      evidence.snapshots.push(snapshotFacts);
      checks.check(label + ': preview snapshot entry serves the exact fixture bytes (only the fixed runtime tag injected)', snapshotFacts.entryStatus === 200 && snapshotFacts.exactBytesAfterRuntimeStrip === true && snapshotFacts.runtimeInjectedOnce === true, snapshotFacts);
      checks.check(label + ': preview snapshot keeps the locked CSP and serves the declared asset byte-exact', snapshotFacts.cspHasConnectNone === true && snapshotFacts.cspHasScriptSrc === true && snapshotFacts.assetEqual === true && snapshotFacts.assetBytes > 0, { cspHasConnectNone: snapshotFacts.cspHasConnectNone, cspHasScriptSrc: snapshotFacts.cspHasScriptSrc, assetEqual: snapshotFacts.assetEqual, assetBytes: snapshotFacts.assetBytes });

      activeEntry = snapshot.entryUrl;
      activeComposition = { width: meta.width, height: meta.height };
      activeSeek = seekTarget;
      const page = await browser.newPage();
      const requests = [];
      const pageErrors = [];
      const consoleErrors = [];
      page.on('request', (pageRequest) => requests.push(pageRequest.url()));
      page.on('pageerror', (error) => pageErrors.push(String(error && error.message ? error.message : error)));
      page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });
      await page.goto(origin + '/?case=' + encodeURIComponent(label), { waitUntil: 'domcontentloaded' });
      await page.waitForFunction('window.__RESULT__ && window.__RESULT__.done === true', { timeout: 40000 });
      const result = await page.evaluate('window.__RESULT__');
      const external = requests.filter((url) => url.startsWith(origin) === false && url.startsWith('data:') === false && url.startsWith('about:') === false);
      const ready = result.ready || null;
      const readyOk = ready !== null && Number(ready.width) === meta.width && Number(ready.height) === meta.height && Math.abs(Number(ready.duration) - meta.duration) < 0.01;
      const seekOk = result.seek !== null && result.seek !== undefined && Math.abs(Number(result.seek.time) - seekTarget) < 0.02;
      const playOk = result.stateAfterPlay !== null && result.stateAfterPlay !== undefined && Number(result.stateAfterPlay.time) >= seekTarget + 0.2;
      const screenshot = join(evidenceDirectory, 'runtime-' + label + '.png');
      const stage = await page.$('#stage');
      if (stage !== null) await stage.screenshot({ path: screenshot });
      await page.close();
      evidence.chrome.push({ label, revision, ready, seek: result.seek, stateAtSeek: result.stateAtSeek, stateAfterPlay: result.stateAfterPlay, events: result.events, error: result.error || null, externalRequests: external, pageErrors, consoleErrors, screenshot });
      checks.check(label + ': real Chrome fixed-runtime load reaches ready with the composition frame', readyOk && result.error === undefined && result.timeout !== true, { ready, error: result.error || null });
      checks.check(label + ': real Chrome fixed-runtime seek + play work on the fixture', seekOk && playOk, { seek: result.seek, stateAfterPlay: result.stateAfterPlay, seekTarget });
      checks.check(label + ': real Chrome fixed-runtime load stays same-origin (no external requests, no page errors)', external.length === 0 && pageErrors.length === 0, { external, pageErrors });

      await invokeHttp(bridge, 'preview.release', { snapshotId: snapshot.snapshotId });
      checks.check(label + ': preview.release removes its published routes', host.routes.every((candidate) => candidate.path !== snapshot.entryUrl), { entryUrl: snapshot.entryUrl });
    }
    await invokeHttp(bridge, 'close', { projectId });
    checks.check('every fixture quality gate passed', true, { checks: checks.checks.length });
  } catch (error) {
    evidence.fatalError = { message: error instanceof Error ? error.message : String(error), stack: error instanceof Error ? error.stack : undefined };
    console.error('fixture smoke failed:', evidence.fatalError.message);
  } finally {
    if (browser !== null) await browser.close().catch(() => {});
    if (server !== null) await new Promise((resolveClose) => server.close(resolveClose)).catch(() => {});
    let teardown = null;
    if (bridge !== null) {
      const beforeDispose = bridge.state();
      try {
        await bridge.dispose();
      } catch (_error) { /* reported */ }
      const afterDispose = bridge.state();
      teardown = { bridgeBeforeDispose: beforeDispose, bridgeAfterDispose: afterDispose, routesAfterDispose: host === null ? null : host.routes.length, disposed: bridge.disposed === true };
      teardown.ok = afterDispose.inFlight === 0 && teardown.routesAfterDispose === 0 && teardown.disposed === true;
    }
    checks.check('honest teardown after the fixture smoke run', teardown !== null && teardown.ok === true, teardown);
    evidence.teardown = teardown;
    if (stagingBefore !== null && staged !== null) {
      try {
        evidence.stagingReadOnly = { ...compareStagingSources(stagingBefore, await listStagingSources(staged.evidence.staging)), note: 'Immutable staging sources only; worker business dirs/node_modules/evidence excluded.' };
      } catch (error) {
        evidence.stagingReadOnly = { same: null, error: error instanceof Error ? error.message : String(error) };
      }
    }
    evidence.checks = checks.checks;
    evidence.summary = { total: checks.checks.length, passed: checks.passed(), failed: checks.checks.length - checks.passed() };
    evidence.ok = checks.ok() && evidence.fatalError === undefined && evidence.stagingReadOnly !== null && evidence.stagingReadOnly.same === true;
    evidence.finishedAt = new Date().toISOString();
    const evidenceFile = await writeEvidence(outRoot, runDirectory, 'conversation-fixture-smoke', evidence);
    console.log(JSON.stringify({
      evidence: evidenceFile,
      ok: evidence.ok,
      checks: evidence.summary,
      fixtures: evidence.fixtures.map((entry) => ({ label: entry.label, revision: entry.revision, inspected: entry.inspected })),
      frames: evidence.frames.map((entry) => ({ label: entry.label, bytes: entry.bytes, sha256: entry.sha256.slice(0, 16) })),
      chrome: evidence.chrome.map((entry) => ({ label: entry.label, ready: entry.ready, seek: entry.seek && entry.seek.time, stateAfterPlay: entry.stateAfterPlay && entry.stateAfterPlay.time })),
      stagingReadOnly: evidence.stagingReadOnly && evidence.stagingReadOnly.same,
      engineCommit: evidence.engineCommit,
    }, null, 2));
  }
  process.exitCode = evidence.ok === true ? 0 : 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
