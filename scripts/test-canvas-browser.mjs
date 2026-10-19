#!/usr/bin/env node
/**
 * P3-008 real-browser preview-runtime check.
 *
 * Loads the staged Host snapshot routes through a local authenticated toy bridge
 * (same staged VideoBridge/dispatcher plus in-memory Fetch routes) in real
 * Chrome, sandboxes the snapshot document, and verifies ready/seek/play/hit from
 * the fixed runtime. This is a development-page runtime/component check, not a
 * DSH activation or a real model request.
 *
 * Usage: node scripts/test-canvas-browser.mjs --staging <absolute staging dir>
 */

import { createServer } from 'node:http';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { loadStagedHost } from './lib/staged-host.mjs';

const INSTANCE = 'p3008browser1';
const NONCE = '0123456789abcdef0123456789abcdef';
// Real DSH delivers plugin Fetch-route requests with the bridge's internal
// sentinel origin (http://dsh.internal); the browser document/iframe origin is
// the actual Web GUI origin. The toy server keeps serving on 127.0.0.1 while
// forwarding requests with this internal origin so the CSP regression is
// exercised exactly as it is in the installed Host (P3-015).
const BRIDGE_REQUEST_ORIGIN = 'http://dsh.internal';

function usage(message) {
  if (message) console.error(message);
  console.error('usage: node scripts/test-canvas-browser.mjs --staging <absolute staging dir>');
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

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function resolveExecutable(command, env) {
  if (isAbsolute(command)) {
    await access(command, constants.X_OK);
    return command;
  }
  for (const directory of ((env && env.PATH) || process.env.PATH || '').split(':')) {
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
      tools: { register() { return () => {}; } },
      effect() { return () => {}; },
      get(name) { return services[name]; },
    },
  };
}

function pageSource(entryPath) {
  return `<!doctype html>
<html><head><meta charset="utf-8"><style>
body{margin:0;background:#111;color:#eee;font:14px sans-serif}
#stage{width:640px;height:360px;position:relative;margin:20px;background:#000;overflow:hidden}
iframe{position:absolute;inset:0;width:1280px;height:720px;border:0;transform:scale(.5);transform-origin:top left}
</style></head><body>
<div id="stage"></div>
<script>
const result={started:Date.now(),events:[],done:false};
window.__RESULT__=result;
try{
  const instance=${JSON.stringify(INSTANCE)};
  const nonce=${JSON.stringify(NONCE)};
  const frame=document.createElement('iframe');
  frame.sandbox='allow-scripts';
  frame.referrerPolicy='no-referrer';
  document.getElementById('stage').appendChild(frame);
  let seq=0; const pending=new Map();
  function command(type,payload){
    return new Promise(function(resolve){
      const id=++seq;
      const timer=setTimeout(function(){pending.delete(id);resolve(null);},4000);
      pending.set(id,{resolve:resolve,timer:timer});
      frame.contentWindow.postMessage({v:1,kind:'cmd',instanceId:instance,nonce:nonce,seq:id,type:type,payload:payload||{}},'*');
    });
  }
  window.addEventListener('message',function(event){
    if(event.source!==frame.contentWindow) return;
    const data=event.data;
    if(!data || data.kind!=='evt' || data.instanceId!==instance || data.nonce!==nonce) return;
    result.events.push(data.type);
    if(data.replyTo && pending.has(data.replyTo)){
      const item=pending.get(data.replyTo); pending.delete(data.replyTo); clearTimeout(item.timer); item.resolve(data.payload);
    }
    if(data.type==='ready'){
      result.ready=data.payload;
      (async function(){
        const seek=await command('seek',{time:3});
        result.seek=seek;
        const list=await command('getElements');
        result.elementCount=list&&list.elements?list.elements.length:0;
        const title=list&&list.elements?list.elements.find(function(e){return e.stableId==='scene-1-title';}):null;
        if(title){
          const hit=await command('hitTest',{x:title.rect.x+title.rect.width/2,y:title.rect.y+title.rect.height/2});
          result.hit=hit&&hit.hit?{stableId:hit.hit.stableId,rect:hit.hit.rect}:null;
        }
        await command('play');
        await new Promise(function(r){setTimeout(r,450);});
        await command('pause');
        result.state=await command('state');
        result.done=true;
      })().catch(function(error){result.error=String(error);result.done=true;});
    }
    if(data.type==='error'){result.error=data.payload&&data.payload.message;}
  });
  frame.src=${JSON.stringify(entryPath)} + '?instance=' + encodeURIComponent(instance) + '&nonce=' + nonce;
  setTimeout(function(){if(!result.done){result.timeout=true;result.done=true;}},12000);
}catch(error){result.error=String(error);result.done=true;}
</script></body></html>`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const staging = resolve(args.staging);
  const staged = await loadStagedHost(staging);
  const config = staged.config;
  const integrity = staged.integrity;
  const browserPath = integrity.browser;
  assert(typeof browserPath === 'string' && isAbsolute(browserPath), 'staging has no absolute browser path');
  const puppeteer = createRequire(join(staging, 'engine-worker', 'package.json'))('puppeteer-core');
  const host = fakeCtx();
  const bridge = new staged.VideoBridge({ ctx: host.ctx, rawConfig: config });
  const evidence = {
    kind: 'p3-008-browser-canvas-runtime',
    startedAt: new Date().toISOString(),
    staging,
    engineCommit: integrity.engineCommit,
    rootCommit: integrity.rootCommit,
    versions: integrity.versions,
    browser: browserPath,
  };
  let server = null;
  let browser = null;
  let entryCsp = null;
  try {
    const created = await bridge.invoke('project.create', { templateId: 'product-launch-v1', title: 'P3-008 Browser Canvas' }, { source: 'http' });
    const inspected = await bridge.invoke('inspect', { projectId: created.projectId }, { source: 'http' });
    const snapshot = await bridge.invoke('preview.snapshot', { projectId: created.projectId, revision: inspected.revision, ttlMs: 120000 }, { source: 'http' });
    evidence.projectId = created.projectId;
    evidence.revision = inspected.revision;
    evidence.snapshot = { snapshotId: snapshot.snapshotId, entryUrl: snapshot.entryUrl, files: snapshot.files.length };

    const routes = new Map(host.routes.map((route) => [route.path, route]));
    server = createServer(async (req, res) => {
      try {
        const url = new URL(req.url, 'http://127.0.0.1');
        if (url.pathname === '/') {
          res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
          res.end(pageSource(snapshot.entryUrl));
          return;
        }
        if (url.pathname === '/favicon.ico') {
          res.writeHead(204, { 'cache-control': 'no-store' });
          res.end();
          return;
        }
        const route = routes.get(url.pathname);
        if (route === undefined) {
          res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
          res.end('not found');
          return;
        }
        const request = new Request(`${BRIDGE_REQUEST_ORIGIN}${req.url}`, {
          method: req.method,
          headers: req.headers,
          body: req.method === 'GET' || req.method === 'HEAD' ? undefined : req,
          duplex: 'half',
        });
        const response = await route.fetch(request);
        const headers = {};
        response.headers.forEach((value, key) => {
          headers[key] = value;
        });
        if (url.pathname === snapshot.entryUrl) {
          entryCsp = headers['content-security-policy'] || null;
        }
        res.writeHead(response.status, headers);
        const buffer = Buffer.from(await response.arrayBuffer());
        res.end(buffer);
      } catch (error) {
        res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
        res.end('bridge error');
      }
    });
    await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
    const origin = `http://127.0.0.1:${server.address().port}`;
    evidence.origin = origin;
    evidence.hostRequestOrigin = BRIDGE_REQUEST_ORIGIN;

    browser = await puppeteer.launch({
      executablePath: browserPath,
      headless: true,
      args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
    });
    const page = await browser.newPage();
    const requests = [];
    const consoleErrors = [];
    page.on('request', (request) => requests.push(request.url()));
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });
    await page.goto(`${origin}/`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction('window.__RESULT__ && window.__RESULT__.done === true', { timeout: 20000 });
    const result = await page.evaluate('window.__RESULT__');
    evidence.result = {
      ready: result.ready,
      elementCount: result.elementCount,
      hit: result.hit,
      seek: result.seek,
      state: result.state,
      events: result.events,
      error: result.error || null,
      timeout: result.timeout === true,
    };
    evidence.network = {
      requests,
      external: requests.filter((url) => url.startsWith(origin) === false && url.startsWith('data:') === false),
    };
    evidence.consoleErrors = consoleErrors;
    assert(result.error === undefined && result.timeout !== true, `runtime failed: ${result.error || 'timeout'}`);
    assert(result.ready && result.ready.width === 1280 && result.ready.height === 720 && result.ready.duration === 5, `unexpected ready payload: ${JSON.stringify(result.ready)}`);
    assert(result.hit && result.hit.stableId === 'scene-1-title', `hit test did not select the title: ${JSON.stringify(result.hit)}`);
    assert(result.seek && Math.abs(result.seek.time - 3) < 0.01, `seek did not land at 3s: ${JSON.stringify(result.seek)}`);
    assert(result.state && result.state.time >= 3.05, `play did not advance the playhead: ${JSON.stringify(result.state)}`);
    assert(evidence.network.external.length === 0, `external network request(s): ${evidence.network.external.join(', ')}`);
    evidence.entryCsp = entryCsp;
    assert(typeof evidence.entryCsp === 'string', 'snapshot entry CSP was not observed');
    for (const directive of ["script-src 'self'", "style-src 'self'", "img-src 'self'", "font-src 'self'"]) {
      assert(evidence.entryCsp.includes(directive), `snapshot CSP is missing ${directive}: ${evidence.entryCsp}`);
    }
    assert(evidence.entryCsp.includes('sha256-'), 'snapshot CSP is missing the inline script hash');
    assert(evidence.entryCsp.includes('dsh.internal') === false, `snapshot CSP leaked the bridge origin: ${evidence.entryCsp}`);
    evidence.ok = true;
    evidence.finishedAt = new Date().toISOString();
  } catch (error) {
    evidence.ok = false;
    evidence.error = { message: error instanceof Error ? error.message : String(error), stack: error instanceof Error ? error.stack : undefined };
    throw error;
  } finally {
    if (browser !== null) await browser.close().catch(() => {});
    if (server !== null) await new Promise((resolveClose) => server.close(resolveClose)).catch(() => {});
    try {
      await bridge.dispose();
    } catch (_error) {
      /* teardown is reported by the runner */
    }
    const directory = join(dirname(staging), 'evidence');
    await mkdir(directory, { recursive: true });
    const file = join(directory, `canvas-browser-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
    await writeFile(file, JSON.stringify(evidence, null, 2) + '\n');
    console.log(JSON.stringify({ evidence: file, ok: evidence.ok, engineCommit: evidence.engineCommit, rootCommit: evidence.rootCommit }, null, 2));
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
