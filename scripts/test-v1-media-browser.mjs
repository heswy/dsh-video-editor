/** Real Chrome + actual component + actual media Host/worker, temporary data only. */
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { Readable } from 'node:stream';
import { VideoBridge } from '../host/bridge.js';
import { createMediaRoute } from '../host/media-routes.js';
import { createRequestRoute } from '../host/routes.js';
import { WorkerClient } from '../packages/video-engine-client/src/index.mjs';
const require = createRequire(resolve('packages/video-engine-worker/package.json'));
const puppeteer = require('puppeteer-core');
const root = await mkdtemp(join(tmpdir(), 'm2-browser-'));
const out = resolve(process.argv[2] || '/tmp/m2-browser-evidence');
await mkdir(out, { recursive: true });
let bridge, browser, server;
const errors = [];
let checks = 0;
try {
  const config = {
    workerNode: process.execPath,
    workerEntry: resolve('packages/video-engine-worker/src/worker.mjs'),
    workerCwd: root,
    registryPath: join(root, 'old-registry.json'),
    artifactRoot: join(root, 'old-output'),
    allowedProjects: ['demo'],
    dataRoot: join(root, 'data'),
    legacyDataRoots: [],
    requestTimeoutMs: 120000,
  };
  bridge = new VideoBridge({
    ctx: { logger: { warn() {} }, subprocess: { resolveExecutable: async (command) => command } },
    rawConfig: config,
    engineLoader: async () => ({
      WorkerClient,
      workerEntry: config.workerEntry,
      clientVersion: '0.4.0',
      workerVersion: '0.4.0',
    }),
  });
  const created = await bridge.invoke(
    'project.create',
    { templateId: 'product-launch-v1', title: 'Media library test' },
    { source: 'http' },
  );
  const projectId = created.projectId;
  const source = await readFile('client.js', 'utf8');
  const body = source.slice(source.indexOf('    //#region constants'), source.indexOf('    //#region plugin'));
  const css = source.match(/const CSS = `([\s\S]*?)`;/)[1];
  const lite = (await readFile('scripts/lib/react-dom-lite.mjs', 'utf8')).replace(
    'export { React, createElement, createRoot, createPortal, flushSync, pendingWork };',
    'window.ReactLite={React,createElement,createRoot};',
  );
  const js = `const Module=(function(require){${body}\nreturn {MediaLibraryPanel,ZH};})(()=>ReactLite.React); const h=ReactLite.createElement;const root=ReactLite.createRoot(document.getElementById('mount'));root.render(h(Module.MediaLibraryPanel,{projectId:${JSON.stringify(projectId)},t:k=>Module.ZH[k]||k,onClose:()=>{}}));`;
  const routes = [createRequestRoute(bridge), createMediaRoute(bridge), createMediaRoute(bridge, true)];
  server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://127.0.0.1');
      if (url.pathname === '/') {
        res.setHeader('content-type', 'text/html');
        res.end(
          '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><style>body{margin:0;background:#19191b;color:#eee;font:14px -apple-system,sans-serif}#mount{position:relative;width:640px;height:700px}' +
            css +
            '</style><div class="dv-root" id="mount"></div><script src="/lite.js"></script><script src="/page.js"></script></html>',
        );
        return;
      }
      if (url.pathname === '/lite.js' || url.pathname === '/page.js') {
        res.setHeader('content-type', 'text/javascript');
        res.end(url.pathname === '/lite.js' ? lite : js);
        return;
      }
      if (url.pathname === '/favicon.ico') {
        res.writeHead(204);
        res.end();
        return;
      }
      const route = routes.find((r) => r.path === url.pathname);
      if (!route && url.pathname !== '/api/dsh-video/asset-upload') {
        res.writeHead(404);
        res.end();
        return;
      }
      const request = new Request('http://127.0.0.1' + req.url, {
        method: req.method,
        headers: req.headers,
        ...(['GET', 'HEAD'].includes(req.method) ? {} : { body: Readable.toWeb(req), duplex: 'half' }),
      });
      const response =
        url.pathname === '/api/dsh-video/asset-upload' ? await bridge.uploadAsset(request) : await route.fetch(request);
      res.writeHead(response.status, Object.fromEntries(response.headers));
      if (response.body) Readable.fromWeb(response.body).pipe(res);
      else res.end();
    } catch (e) {
      res.writeHead(500);
      res.end('test server error');
      errors.push(e.message);
    }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  browser = await puppeteer.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: true,
    args: ['--no-sandbox'],
  });
  const page = await browser.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  await page.setViewport({ width: 900, height: 760 });
  await page.goto('http://127.0.0.1:' + server.address().port);
  await page.waitForSelector('input[type=file]');
  checks++;
  const video = join(root, '视频测试.mp4'),
    audio = join(root, '配乐.wav');
  execFileSync('ffmpeg', [
    '-v',
    'error',
    '-f',
    'lavfi',
    '-i',
    'color=c=blue:s=64x64:r=30:d=2',
    '-c:v',
    'libx264',
    video,
  ]);
  execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', audio]);
  const picker = await page.$('input[type=file]');
  await picker.uploadFile(video, audio);
  await page.waitForFunction(() => document.querySelectorAll('.dv-media-tile').length === 2, { timeout: 30000 });
  checks++;
  await page.waitForFunction(() => document.querySelectorAll('.dv-media-tile img').length === 2, { timeout: 30000 });
  checks++;
  await page.screenshot({ path: join(out, '01-library.png') });
  await page.evaluate(() => {
    [...document.querySelectorAll('.dv-media-tile')].find((e) => e.textContent.includes('视频')).click();
  });
  await page.waitForSelector('video');
  await page.waitForFunction(() => document.querySelector('video').readyState >= 1);
  checks++;
  assert.equal(await page.$eval('video', (v) => Math.round(v.duration)), 2);
  await page.$eval('video', (v) => {
    v.currentTime = 1;
  });
  await page.waitForFunction(() => {
    const v = document.querySelector('video');
    return Math.abs(v.currentTime - 1) < 0.1 && !v.seeking && v.readyState >= 2;
  });
  checks++;
  await page.$eval('video', async (v) => {
    await v.play();
  });
  await page.waitForFunction(() => document.querySelector('video').currentTime > 1.1);
  await page.$eval('video', (v) => v.pause());
  checks++;
  await page.screenshot({ path: join(out, '02-video-detail.png') });
  await page.type('input[type=search]', '配乐');
  await page.waitForFunction(
    () =>
      document.querySelectorAll('.dv-media-tile').length === 1 &&
      document.querySelector('.dv-media-tile').textContent.includes('配乐'),
  );
  checks++;
  await page.click('.dv-media-tile');
  await page.waitForSelector('audio');
  checks++;
  await page.reload();
  await page.waitForFunction(() => document.querySelectorAll('.dv-media-tile').length === 2);
  checks++;
  await page.setViewport({ width: 340, height: 760 });
  await page.evaluate(() => {
    document.getElementById('mount').style.width = '100%';
  });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  checks++;
  await page.screenshot({ path: join(out, '03-narrow.png') });
  assert.deepEqual(errors, []);
  await writeFile(join(out, 'result.json'), JSON.stringify({ ok: true, checks, errors }, null, 2));
  console.log(JSON.stringify({ ok: true, checks, out }));
} finally {
  if (browser) await browser.close();
  if (server) await new Promise((r) => server.close(r));
  if (bridge) await bridge.dispose();
  await rm(root, { recursive: true, force: true });
}
