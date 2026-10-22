/** Real Chrome + actual component + actual media Host/worker, temporary data only. */
import { closeTestBrowser } from './lib/browser-cleanup.mjs';
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { Readable } from "node:stream";
import { VideoBridge } from "../host/bridge.js";
import { createMediaRoute } from "../host/media-routes.js";
import { createRequestRoute } from "../host/routes.js";
import { loadStagedHost } from "./lib/staged-host.mjs";
import { pathToFileURL } from "node:url";
import { WorkerClient } from "../packages/video-engine-client/src/index.mjs";
const require = createRequire(
  resolve("packages/video-engine-worker/package.json"),
);
const puppeteer = require("puppeteer-core");
const stagingArg = process.argv.indexOf("--staging"),
  staging = stagingArg >= 0 ? resolve(process.argv[stagingArg + 1]) : null,
  staged = staging ? await loadStagedHost(staging) : null;
const Bridge = staged ? staged.VideoBridge : VideoBridge;
const requestRoute = staged
  ? (await import(pathToFileURL(join(staging, "bundle/host/routes.js")).href))
      .createRequestRoute
  : createRequestRoute;
const mediaRoute = staged
  ? (
      await import(
        pathToFileURL(join(staging, "bundle/host/media-routes.js")).href
      )
    ).createMediaRoute
  : createMediaRoute;

const root = await mkdtemp(join(tmpdir(), "m2-browser-"));
const out = resolve(process.argv[2] || "/tmp/m2-browser-evidence");
await mkdir(out, { recursive: true });
let bridge, browser, server;
const publicRoutes = new Map(),
  fetchRoutes = new Map();
const errors = [];
let checks = 0;
try {
  const config = staged
    ? {
        ...staged.config,
        dataRoot: join(root, "data"),
        legacyDataRoots: [staging],
        requestTimeoutMs: 120000,
      }
    : {
        workerNode: process.execPath,
        workerEntry: resolve("packages/video-engine-worker/src/worker.mjs"),
        workerCwd: root,
        registryPath: join(root, "old-registry.json"),
        artifactRoot: join(root, "old-output"),
        allowedProjects: ["demo"],
        dataRoot: join(root, "data"),
        legacyDataRoots: [],
        requestTimeoutMs: 120000,
      };
  bridge = new Bridge({
    ctx: {
      connection: {
        fetch: {
          register: (r) => {
            fetchRoutes.set(r.path, r);
            return () => fetchRoutes.delete(r.path);
          },
        },
      },
      webServer: {
        register: (r) => {
          publicRoutes.set(r.path, r);
          return () => publicRoutes.delete(r.path);
        },
      },
      logger: { warn() {} },
      subprocess: { resolveExecutable: async (command) => command },
    },
    rawConfig: config,
    ...(staged
      ? {}
      : {
          engineLoader: async () => ({
            WorkerClient,
            workerEntry: config.workerEntry,
            clientVersion: "0.8.0",
            workerVersion: "0.8.0",
          }),
        }),
  });
  bridge.snapshots.webServer = {
    register: (r) => {
      publicRoutes.set(r.path, r);
      return () => publicRoutes.delete(r.path);
    },
  };
  const created = await bridge.invoke(
    "project.create",
    { templateId: "product-launch-v1", title: "Media library test" },
    { source: "http" },
  );
  const projectId = created.projectId;
  const source = await readFile(
    staging ? join(staging, "bundle/client.js") : "client.js",
    "utf8",
  );
  const body = source.slice(
    source.indexOf("    //#region constants"),
    source.indexOf("    //#region plugin"),
  );
  const css = source.match(/const CSS = `([\s\S]*?)`;/)[1];
  const lite = (
    await readFile("scripts/lib/react-dom-lite.mjs", "utf8")
  ).replace(
    "export { React, createElement, createRoot, createPortal, flushSync, pendingWork };",
    "window.ReactLite={React,createElement,createRoot};",
  );
  const initial = await bridge.invoke(
    "timeline.inspect",
    { projectId },
    { source: "http" },
  );
  const video = join(root, "timeline.mp4");
  execFileSync("ffmpeg", [
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "testsrc2=s=320x180:r=30:d=20",
    "-c:v",
    "libx264",
    video,
  ]);
  const receipt = await bridge.uploadAsset(
    new Request(
      "http://local/api/dsh-video/asset-upload?projectId=" + projectId,
      {
        method: "POST",
        headers: {
          "content-type": "video/mp4",
          "x-dsh-project-id": projectId,
          "x-dsh-file-name": "timeline.mp4",
        },
        body: await readFile(video),
      },
    ),
  );
  const uploaded = await receipt.json();
  assert.equal(receipt.status, 200, JSON.stringify(uploaded));
  const imported = await bridge.invoke(
    "asset.importMedia",
    {
      projectId,
      operationId: "import",
      receiptId: uploaded.receiptId ?? uploaded.result?.receiptId,
    },
    { source: "http" },
  );
  await bridge.invoke(
    "timeline.apply",
    {
      projectId,
      expectedRevision: initial.revision,
      operationId: "insert",
      ops: [
        { op: "clip.delete", clipId: initial.tracks[0].clips[0].clipId },
        {
          op: "clip.insert",
          trackId: "tr_v1",
          assetId: imported.asset.assetId,
          startFrame: 0,
        },
      ],
    },
    { source: "http" },
  );
  const inspected = await bridge.invoke(
    "inspect",
    { projectId },
    { source: "http" },
  );
  const js = `const Module=(function(require){${body}\nreturn {CanvasWorkspace,ZH};})(()=>ReactLite.React);const h=ReactLite.createElement;function App(){const [project,setProject]=ReactLite.React.useState(${JSON.stringify(inspected)});window.seek=value=>{const input=document.querySelector('.dv-seek');input.value=value;input.dispatchEvent(new Event('input',{bubbles:true}));};return h(Module.CanvasWorkspace,{projectId:${JSON.stringify(projectId)},t:k=>Module.ZH[k]||k,inspected:project,previewOnly:true,onReload:async()=>{const response=await fetch('/api/dsh-video/request',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({method:'inspect',params:{projectId:${JSON.stringify(projectId)}}})});const value=await response.json();setProject(value.result);},onError:()=>{}});}const root=ReactLite.createRoot(document.getElementById('mount'));root.render(h(App));`;
  const referenceJs=`const Module=(function(require){${body}\nreturn {ReferencePanel,ZH};})(()=>ReactLite.React);const h=ReactLite.createElement;function App(){const [open,setOpen]=ReactLite.React.useState(true);return h('div',null,open?h(Module.ReferencePanel,{projectId:${JSON.stringify(projectId)},t:k=>Module.ZH[k]||k,onClose:()=>setOpen(false)}):null);}ReactLite.createRoot(document.getElementById('mount')).render(h(App));`;


  const routes = [
    requestRoute(bridge),
    mediaRoute(bridge),
    mediaRoute(bridge, true),
  ];
  server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, "http://127.0.0.1");
      if (url.pathname === "/" || url.pathname === "/references") {
        res.setHeader("content-type", "text/html");
        res.end(
          '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><style>body{margin:0;background:#19191b;color:#eee;font:14px -apple-system,sans-serif}#mount{position:relative;width:800px;height:700px}' +
            css +
            '</style><div class="dv-root" id="mount"></div><script src="/lite.js"></script><script src="'+(url.pathname==='/references'?'/reference-page.js':'/page.js')+'"></script></html>',
        );
        return;
      }
      if (url.pathname === "/lite.js" || url.pathname === "/page.js" || url.pathname === "/reference-page.js") {
        res.setHeader("content-type", "text/javascript");
        res.end(url.pathname === "/lite.js" ? lite : url.pathname === "/reference-page.js" ? referenceJs : js);
        return;
      }
      if (url.pathname === "/favicon.ico") {
        res.writeHead(204);
        res.end();
        return;
      }
      if (publicRoutes.has(url.pathname)) {
        await publicRoutes.get(url.pathname).handler(req, res);
        return;
      }
      const route =
        fetchRoutes.get(url.pathname) ||
        routes.find((r) => r.path === url.pathname);
      if (!route && url.pathname !== "/api/dsh-video/asset-upload") {
        res.writeHead(404);
        res.end();
        return;
      }
      const request = new Request("http://127.0.0.1" + req.url, {
        method: req.method,
        headers: req.headers,
        ...(["GET", "HEAD"].includes(req.method)
          ? {}
          : { body: Readable.toWeb(req), duplex: "half" }),
      });
      const response =
        url.pathname === "/api/dsh-video/asset-upload"
          ? await bridge.uploadAsset(request)
          : await route.fetch(request);
      res.writeHead(response.status, Object.fromEntries(response.headers));
      if (response.body) {
        const stream = Readable.fromWeb(response.body);
        res.on("close", () => stream.destroy());
        stream.on("error", (error) => {
          if (!["ABORT_ERR", "ERR_STREAM_PREMATURE_CLOSE"].includes(error.code))
            errors.push(error.message);
          res.destroy();
        });
        stream.pipe(res);
      } else res.end();
    } catch (e) {
      res.writeHead(500);
      res.end("test server error");
      errors.push(e.message);
    }
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  browser = await puppeteer.launch({
    executablePath:
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    headless: true,
    args: ["--no-sandbox"],
  });
  const page = await browser.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  if(process.env.M4_AUDIO==='1')page.on('console',msg=>{if(/AudioContext|autoplay|Permissions/.test(msg.text()))console.log('[audio-console]',msg.text());});
  await page.setViewport({ width: 900, height: 760 });
  await page.goto("http://127.0.0.1:" + server.address().port);
  await page.waitForSelector(".dv-canvas-shell[data-canvas-phase=ready]");
  await page.waitForSelector(".dv-timeline-clip");
  checks++;
  assert.equal(await page.$$eval('.dv-canvas-bar button',xs=>xs.some(x=>x.textContent==='素材')),false,'playback bar must not contain the media entry');
  assert.equal(await page.$eval('.dv-resource-bar button[aria-label="素材"]',e=>e.getAttribute('aria-expanded')),'false');
  assert.equal(await page.$eval('.dv-timeline-notice',e=>getComputedStyle(e).display).catch(()=> 'none'),'none','idle timeline has no permanent instruction footer');checks++;
  await page.click('.dv-timeline-clip');
  assert.equal(await page.$eval('.dv-clip-settings',e=>e.open),false,'clip properties stay collapsed after selection');
  await page.click('.dv-clip-settings summary');
  assert.equal(await page.$eval('.dv-timeline-inspector',e=>e.getBoundingClientRect().height>0),true);
  await page.focus('.dv-clip-settings summary');await page.keyboard.press('Escape');
  assert.equal(await page.$eval('.dv-clip-settings',e=>e.open),false);checks++;
  await page.setViewport({width:340,height:760});await page.evaluate(()=>document.getElementById('mount').style.width='100%');
  await page.waitForFunction(()=>{const el=document.querySelector('.dv-timeline-scroll');return el.scrollWidth<=el.clientWidth+1;});
  await page.click('.dv-clip-settings summary');
  assert.equal(await page.$eval('.dv-timeline-inspector',e=>{const r=e.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth;}),true);checks++;
  await page.click('.dv-clip-settings summary');
  await page.setViewport({width:900,height:760});await page.evaluate(()=>document.getElementById('mount').style.width='800px');

  const clickText = async (text) => {
    await page.waitForFunction(
      (text) => {
        const b = [...document.querySelectorAll("button")].find(
          (x) => x.textContent === text,
        );
        return b && !b.disabled;
      },
      {},
      text,
    );
    await page.evaluate(
      (text) =>
        [...document.querySelectorAll("button")]
          .find((x) => x.textContent === text)
          .click(),
      text,
    );
  };
  const count = async (n) =>
    page.waitForFunction(
      (n) => document.querySelectorAll(".dv-timeline-clip").length === n,
      {},
      n,
    );
  await page.click(".dv-timeline-clip");
  await page.evaluate(() => window.seek(5));
  await clickText("切分");
  await count(2);
  checks++;
  await page.waitForFunction(
    () =>
      document.querySelector(".dv-canvas-shell").dataset.previewPending ===
        "false" &&
      ![...document.querySelectorAll("button")].find(
        (x) => x.textContent === "切分",
      ).disabled,
  );
  await page.evaluate(() => window.seek(3));
  await clickText("切分");
  await count(3);
  checks++;
  const ids = await page.$$eval(".dv-timeline-clip", (els) =>
    els.map((x) => x.dataset.clipId),
  );
  await page.waitForFunction(
    () =>
      document.querySelector(".dv-timeline").getAttribute("aria-busy") ===
      "false",
  );
  const second = await (
      await page.$('[data-clip-id="' + ids[1] + '"]')
    ).boundingBox(),
    first = await (
      await page.$('[data-clip-id="' + ids[0] + '"]')
    ).boundingBox();
  await page.mouse.move(second.x + 15, second.y + second.height / 2);
  await page.mouse.down();
  await page.mouse.move(first.x + 15, first.y + first.height / 2, { steps: 8 });
  await page.mouse.up();
  await page.waitForFunction(
    (id) => document.querySelector(".dv-timeline-clip").dataset.clipId === id,
    {},
    ids[1],
  );
  checks++;
  await clickText("撤销");
  await page.waitForFunction(
    (id) => document.querySelector(".dv-timeline-clip").dataset.clipId === id,
    {},
    ids[0],
  );
  checks++;
  await page.click('[data-clip-id="' + ids[1] + '"]');
  await clickText("←");
  await page.waitForFunction(
    (id) => document.querySelector(".dv-timeline-clip").dataset.clipId === id,
    {},
    ids[1],
  );
  checks++;
  await clickText("撤销");
  await page.waitForFunction(
    (id) => document.querySelector(".dv-timeline-clip").dataset.clipId === id,
    {},
    ids[0],
  );
  checks++;
  await clickText("重做");
  await page.waitForFunction(
    (id) => document.querySelector(".dv-timeline-clip").dataset.clipId === id,
    {},
    ids[1],
  );
  checks++;
  await clickText("复制");
  await count(4);
  checks++;
  await clickText("删除");
  await count(3);
  checks++;
  await clickText("加轨");
  await page.waitForFunction(
    () => document.querySelectorAll(".dv-timeline-track").length === 2,
  );
  checks++;
  await page.waitForFunction(
    () =>
      document.querySelector(".dv-timeline").getAttribute("aria-busy") ===
      "false",
  );
  await page.click(".dv-timeline-clip");
  const trim = await page.$(".dv-timeline-edge-out");
  const oldTrim = await trim.evaluate((el) =>
    Number(el.getAttribute("aria-valuenow")),
  );
  await trim.focus();
  await page.keyboard.press("ArrowLeft");
  await page.waitForFunction(
    (value) =>
      Number(
        document
          .querySelector(".dv-timeline-edge-out")
          .getAttribute("aria-valuenow"),
      ) === value,
    {},
    oldTrim - 1,
  );
  checks++;
  await page.waitForFunction(
    () =>
      document.querySelector(".dv-timeline").getAttribute("aria-busy") ===
      "false",
  );
  const movingId = await page.$eval(
    ".dv-timeline-clip",
    (el) => el.dataset.clipId,
  );
  const from = await (await page.$(".dv-timeline-clip")).boundingBox();
  const dest = await (await page.$$(".dv-timeline-lane"))[1].boundingBox();
  await page.mouse.move(from.x + 15, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + 15, dest.y + dest.height / 2, { steps: 8 });
  await page.mouse.up();
  await page.waitForFunction(
    (id) =>
      document
        .querySelectorAll(".dv-timeline-lane")[1]
        .querySelector('[data-clip-id="' + id + '"]') !== null,
    {},
    movingId,
  );
  checks++;
  await page.waitForFunction(
    () =>
      [...document.querySelectorAll(".dv-timeline-toolbar button")].find(
        (x) => x.textContent === "撤销",
      ).disabled === false,
  );
  await clickText("撤销");
  await page.waitForFunction(
    (id) =>
      document
        .querySelectorAll(".dv-timeline-lane")[0]
        .querySelector('[data-clip-id="' + id + '"]') !== null,
    {},
    movingId,
  );
  checks++;
  await page.screenshot({ path: join(out, "timeline.png") });
  await page.waitForSelector(".dv-canvas-shell[data-canvas-phase=ready]");
  checks++;
  await page.screenshot({ path: join(out, "full-workspace.png") });
  await page.setViewport({ width: 340, height: 760 });
  await page.evaluate(
    () => (document.getElementById("mount").style.width = "100%"),
  );
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
  );
  checks++;
  await page.screenshot({ path: join(out, "full-narrow.png") });
  await page.waitForFunction(
    () =>
      document.querySelector(".dv-canvas-shell").dataset.previewPending ===
      "false",
  );
  const beforeAdd = await bridge.invoke("timeline.inspect", { projectId }),
    clipCount = beforeAdd.totalClips;
  await page.click('.dv-resource-bar button[aria-label="素材"]');
  await page.waitForSelector(".dv-media-tile");
  await page.click(".dv-media-tile");
  await clickText("加入时间线");
  await count(clipCount + 1);
  assert.equal(await page.$(".dv-media-library"), null);
  await page.waitForFunction(
    () =>
      document.querySelector(".dv-timeline").getAttribute("aria-busy") ===
      "false",
  );
  let afterAdd = await bridge.invoke("timeline.inspect", { projectId });
  assert.equal(afterAdd.tracks[0].clips.at(-1).durationFrames, 600);
  checks++;
  await clickText("撤销");
  await count(clipCount);
  await page.waitForFunction(
    () =>
      document.querySelector(".dv-timeline").getAttribute("aria-busy") ===
      "false",
  );
  await page.click('.dv-resource-bar button[aria-label="素材"]');
  await page.waitForSelector(".dv-media-tile");
  await page.evaluate(() => {
    const transfer = new DataTransfer(),
      tile = document.querySelector(".dv-media-tile"),
      lane = [...document.querySelectorAll(".dv-timeline-lane")].at(-1);
    tile.dispatchEvent(
      new DragEvent("dragstart", { dataTransfer: transfer, bubbles: true }),
    );
    const rect = lane.getBoundingClientRect();
    lane.dispatchEvent(
      new DragEvent("drop", {
        dataTransfer: transfer,
        bubbles: true,
        cancelable: true,
        clientX: rect.left + 2,
        clientY: rect.top + 10,
      }),
    );
  });
  await count(clipCount + 1);
  afterAdd = await bridge.invoke("timeline.inspect", { projectId });
  assert.equal(
    afterAdd.tracks.at(-1).clips[0].durationFrames,
    600,
    "Dropped video should use its complete source duration",
  );
  checks++;
  await page.click(".dv-media-library button[aria-label]");
  await clickText("撤销");
  await count(clipCount);
  await page.waitForFunction(
    () =>
      document.querySelector(".dv-canvas-shell").dataset.previewPending ===
        "false" &&
      document.querySelector(".dv-timeline").getAttribute("aria-busy") ===
        "false",
  );
  const timeBefore = await page.$eval(".dv-seek", (e) => Number(e.value));
  await page.click(".dv-play");
  await page.waitForFunction(
    (start) => Number(document.querySelector(".dv-seek").value) > start + 0.25,
    {},
    timeBefore,
  );
  const uiTime = await page.$eval(".dv-seek", (e) => Number(e.value)),
    activeFrame = await (
      await page.$('.dv-stage-frame[aria-hidden="false"]')
    ).contentFrame();
  const mediaError = await activeFrame.evaluate((time) => {
    const v = [...document.querySelectorAll("video")].find(
      (v) =>
        time >= Number(v.dataset.start) &&
        time < Number(v.dataset.start) + Number(v.dataset.duration),
    );
    return v
      ? Math.abs(
          v.currentTime -
            (Number(v.dataset.mediaStart) +
              (time - Number(v.dataset.start)) *
                Number(v.dataset.playbackRate)),
        )
      : Infinity;
  }, uiTime);
  assert.ok(mediaError <= 2 / 30, "Media drift " + mediaError);
  await page.click(".dv-play");
  checks++;
  await writeFile(
    join(out, "sync.json"),
    JSON.stringify(
      { uiTime, mediaErrorSeconds: mediaError, limitFrames: 2 },
      null,
      2,
    ),
  );
  if(process.env.M4_AUDIO==='1') {
    await page.setViewport({width:900,height:760});
    await page.evaluate(()=>document.getElementById('mount').style.width='100%');
    assert.equal(await page.$$('.dv-timeline').then(x=>x.length),1);
    await clickText('生成音频');
    await page.waitForSelector('.dv-audio-panel');
    await page.select('.dv-audio-field select',process.env.M4_CLOUD==='1'?'qianwen':'local');
    await page.type('.dv-audio-panel textarea','这是一段本地旁白，用于验证音频轨道。');
    await clickText('生成并加入素材');
    await page.waitForFunction(()=>document.querySelector('.dv-audio-job')?.textContent.includes('生成成功'),{timeout:60000});
    checks++;
    await page.screenshot({path:join(out,'audio-generation.png')});
    const beforeAudio=await bridge.invoke('timeline.inspect',{projectId});
    await clickText('加入音轨');
    await count(beforeAudio.totalClips+1);
    assert.equal(await page.$$('.dv-timeline').then(x=>x.length),1);checks++;
    await page.waitForFunction(()=>document.querySelector('.dv-timeline').getAttribute('aria-busy')==='false');
    let audioTimeline=await bridge.invoke('timeline.inspect',{projectId});
    const audioTrack=audioTimeline.tracks.find(x=>x.kind==='audio'),audioClip=audioTrack.clips[0];
    assert.ok(audioClip.durationFrames>30);checks++;
    await page.click('[data-clip-id="'+audioClip.clipId+'"]');
    await page.click('.dv-clip-settings summary');
    for(const [label,value]of [['音量','-6'],['淡入','0.3'],['淡出','0.4'],['轨道增益','-3']]) {
      const input=await page.$('.dv-timeline-inspector input[aria-label="'+label+'"]');
      await input.click();await input.evaluate(e=>e.select());await input.press('Backspace');await input.type(value);await input.press('Tab');
      await page.waitForFunction(()=>document.querySelector('.dv-timeline').getAttribute('aria-busy')==='false');
    }
    audioTimeline=await bridge.invoke('timeline.inspect',{projectId});
    const edited=audioTimeline.tracks.find(x=>x.kind==='audio');
    assert.equal(edited.clips[0].volumeDb,-6);assert.equal(edited.clips[0].fadeInFrames,9);assert.equal(edited.clips[0].fadeOutFrames,12);assert.equal(edited.gainDb,-3);checks++;
    await page.click('.dv-track-mute[aria-label$="'+audioTrack.name+'"]');
    await page.waitForFunction(()=>document.querySelector('.dv-timeline').getAttribute('aria-busy')==='false');
    assert.equal((await bridge.invoke('timeline.inspect',{projectId})).tracks.find(x=>x.kind==='audio').muted,true);
    await clickText('撤销');await page.waitForFunction(()=>document.querySelector('.dv-timeline').getAttribute('aria-busy')==='false');checks++;
    await page.waitForFunction(()=>document.querySelector('.dv-canvas-shell').dataset.previewPending==='false');
    const audibleFrame=await (await page.$('.dv-stage-frame[aria-hidden="false"]')).contentFrame();
    await audibleFrame.waitForSelector('button[aria-label="开启预览声音"]');
    const soundRect=await audibleFrame.$eval('button[aria-label="开启预览声音"]',e=>{const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};});
    const soundFrame=await page.$eval('.dv-stage-frame[aria-hidden="false"]',e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,scale:r.width/parseFloat(e.style.width)};});
    await page.mouse.click(soundFrame.x+soundRect.x*soundFrame.scale,soundFrame.y+soundRect.y*soundFrame.scale);
    await audibleFrame.waitForFunction(()=>document.querySelector('button[aria-label="开启预览声音"]')?.dataset.audioState==='enabled',{timeout:5000}).catch(async e=>{console.log('sound-button',await audibleFrame.$eval('button[aria-label="开启预览声音"]',e=>({text:e.textContent,state:e.dataset.audioState})));throw e;});
    await page.evaluate(()=>window.seek(.5));await page.click('.dv-play');
    await page.waitForFunction(()=>Number(document.querySelector('.dv-seek').value)>.8);
    const audioTime=await page.$eval('.dv-seek',e=>Number(e.value));
    const audioState=await audibleFrame.evaluate(time=>{const a=document.querySelector('audio');return {exists:!!a,muted:a?.muted,paused:a?.paused,delta:Math.abs(a.currentTime-time),volume:a?.dataset.volume,rate:a?.playbackRate};},audioTime);
    assert.equal(audioState.muted,false,JSON.stringify(audioState));assert.equal(audioState.paused,false);assert.ok(audioState.delta<=2/30,JSON.stringify(audioState));await page.click('.dv-play');checks++;
    await writeFile(join(out,'audio-preview.json'),JSON.stringify(audioState,null,2));
    const oldPreview=await page.$eval('.dv-canvas-shell',e=>e.dataset.canvasRevision);
    const input=await page.$('.dv-timeline-inspector input[aria-label="音量"]');await input.click();await input.evaluate(e=>e.select());await input.press('Backspace');await input.type('-8');await input.press('Tab');
    await page.waitForFunction(old=>document.querySelector('.dv-canvas-shell').dataset.canvasRevision!==old&&document.querySelector('.dv-canvas-shell').dataset.previewPending==='false',{},oldPreview);
    const nextFrame=await (await page.$('.dv-stage-frame[aria-hidden="false"]')).contentFrame();
    await nextFrame.waitForFunction(()=>document.querySelector('audio')?.muted===false,{timeout:5000});checks++;
    await page.waitForFunction(()=>[...document.querySelectorAll('.dv-clip-waveform')].some(x=>x.naturalWidth>0));checks++;
    await page.screenshot({path:join(out,'audio-timeline.png')});
    await (await page.$('.dv-timeline')).screenshot({path:join(out,'timeline-detail.png')});
    await page.setViewport({width:340,height:760});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    await page.screenshot({path:join(out,'audio-narrow.png')});checks++;
  }
  if(process.env.M5_COLLAB==='1'){
    await page.setViewport({width:900,height:760});
    await page.waitForFunction(()=>document.querySelector('.dv-timeline').getAttribute('aria-busy')==='false');
    await page.click('.dv-timeline-clip');
    await page.waitForSelector('.dv-clip-reference');
    const text=await page.$eval('.dv-clip-reference',e=>e.value);assert(text.startsWith('`dshvideo:v1/'));checks++;
    const before=await bridge.invoke('timeline.inspect',{projectId});
    const cid=await page.$eval('.dv-timeline-clip',e=>e.dataset.clipId);
    bridge.sessions.projectForSession=async id=>id==='m5-fixture'?projectId:null;
    const targets=await bridge.invoke('timeline.references',{projectId},{source:'tool',agentSessionId:'m5-fixture'});
    const token=targets.items.find(x=>x.kind==='clip'&&x.clipId===cid).token;
    await bridge.invoke('timeline.resolve',{projectId,revision:before.revision,refs:[{kind:'token',token}]},{source:'tool',agentSessionId:'m5-fixture'});
    await bridge.invoke('timeline.apply',{projectId,expectedRevision:before.revision,operationId:'ai-concurrent',ops:[{op:'clip.set',clipId:cid,patch:{label:'AI 保留的片段'}}]},{source:'tool',agentSessionId:'m5-fixture'});
    await page.evaluate(()=>{const original=window.fetch;let drop=true;window.fetch=async(url,init)=>{const request=init?.body?JSON.parse(init.body):{};if(drop&&request.method==='timeline.inspect'){drop=false;return new Response(JSON.stringify({ok:false,error:{code:'E_NETWORK',message:'temporary inspect failure'}}),{headers:{'content-type':'application/json'}});}return original(url,init);};});
    const edge=await page.$('.dv-timeline-edge-out');await edge.focus();await page.keyboard.press('ArrowLeft');
    await page.waitForSelector('.dv-change-recovery[data-recovery=conflict]');
    assert.equal((await bridge.invoke('timeline.inspect',{projectId})).lastChange.operationId,'ai-concurrent');checks++;
    await clickText('预演此修改');await page.waitForSelector('.dv-change-recovery[data-recovery=preview]');
    assert.equal((await bridge.invoke('timeline.inspect',{projectId})).lastChange.operationId,'ai-concurrent');checks++;
    await clickText('确认应用');await page.waitForFunction(()=>!document.querySelector('.dv-change-recovery')&&document.querySelector('.dv-timeline').getAttribute('aria-busy')==='false');
    let current=await bridge.invoke('timeline.inspect',{projectId});assert.equal(current.tracks.flatMap(x=>x.clips).find(x=>x.clipId===cid).label,'AI 保留的片段');checks++;
    await clickText('撤销这次修改');await page.waitForFunction(()=>document.querySelector('.dv-timeline').getAttribute('aria-busy')==='false');
    current=await bridge.invoke('timeline.inspect',{projectId});assert.equal(current.tracks.flatMap(x=>x.clips).find(x=>x.clipId===cid).label,'AI 保留的片段');checks++;
    await page.evaluate(()=>{const original=window.fetch;let drop=true;window.__attempts=[];window.fetch=async function(url,init){const request=init?.body?JSON.parse(init.body):{};if(request.method==='timeline.apply'){window.__attempts.push(request);const response=await original(url,init);if(drop){drop=false;await response.text();throw new TypeError('simulated lost response');}return response;}return original(url,init);};});
    await page.click('.dv-timeline-clip');const uncertain=await page.$('.dv-timeline-edge-out');await uncertain.focus();await page.keyboard.press('ArrowLeft');
    await page.waitForSelector('.dv-change-recovery[data-recovery=retry]');
    const committed=await bridge.invoke('timeline.inspect',{projectId});
    await clickText('重试原请求');await page.waitForFunction(()=>!document.querySelector('.dv-change-recovery')&&document.querySelector('.dv-timeline').getAttribute('aria-busy')==='false');
    const retried=await bridge.invoke('timeline.inspect',{projectId});assert.equal(retried.revision,committed.revision);assert.equal(retried.historyCursor,committed.historyCursor);
    const attempts=await page.evaluate(()=>window.__attempts);assert.deepEqual(attempts[0],attempts[1]);checks++;
    // A new asset selected during conflict recovery must remain queued.
    const queuedBefore=await bridge.invoke('timeline.inspect',{projectId});
    await bridge.invoke('timeline.apply',{projectId,expectedRevision:queuedBefore.revision,operationId:'queue-conflict',ops:[{op:'clip.set',clipId:cid,patch:{label:'保留排队素材'}}]});
    await page.click('.dv-timeline-clip');await (await page.$('.dv-timeline-edge-out')).focus();await page.keyboard.press('ArrowLeft');
    await page.waitForSelector('.dv-change-recovery[data-recovery=conflict]');
    await page.click('.dv-resource-bar button[aria-label="素材"]');await page.waitForSelector('.dv-media-tile');await page.click('.dv-media-tile');await clickText('加入时间线');
    assert.equal((await bridge.invoke('timeline.inspect',{projectId})).totalClips,queuedBefore.totalClips);
    await page.click('.dv-change-recovery button:last-child');
    await count(queuedBefore.totalClips+1);checks++;
    const referencePage=await browser.newPage();referencePage.on('pageerror',e=>errors.push(e.message));await referencePage.setViewport({width:360,height:600});await referencePage.goto('http://127.0.0.1:'+server.address().port+'/references');await referencePage.evaluate(()=>document.getElementById('mount').style.width='100%');await referencePage.waitForSelector('.dv-reference-item');
    await (await referencePage.$('.dv-reference-item')).focus();await referencePage.keyboard.press('Enter');await referencePage.waitForSelector('.dv-reference-token input');
    assert((await referencePage.$eval('.dv-reference-token input',e=>e.value)).startsWith('`dshvideo:v1/'));checks++;
    await (await referencePage.$('.dv-reference-panel')).screenshot({path:join(out,'references.png')});
    await referencePage.setViewport({width:340,height:760});await referencePage.evaluate(()=>document.getElementById('mount').style.width='100%');assert.equal(await referencePage.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);checks++;
    await referencePage.screenshot({path:join(out,'collaboration-narrow.png')});
    await referencePage.keyboard.press('Escape');await referencePage.waitForFunction(()=>!document.querySelector('.dv-reference-panel'));checks++;
  }
  if (process.env.M3_RENDER === "1") {
    const timeline = await bridge.invoke("timeline.inspect", { projectId });
    const job = await bridge.invoke("render", {
      projectId,
      revision: timeline.revision,
    });
    let result = job;
    while (
      !["succeeded", "failed", "cancelled", "timed_out"].includes(result.state)
    ) {
      await new Promise((r) => setTimeout(r, 500));
      result = await bridge.invoke("status", { jobId: job.jobId });
    }
    assert.equal(result.state, "succeeded", JSON.stringify(result));
    const artifact = await bridge.readArtifact(job.jobId);
    await writeFile(join(out, "render.mp4"), artifact.bytes);
    await writeFile(
      join(out, "render-result.json"),
      JSON.stringify(result, null, 2),
    );
    checks++;
  }
  assert.deepEqual(errors, []);
  await writeFile(
    join(out, "result.json"),
    JSON.stringify({ ok: true, checks, errors, staging }, null, 2),
  );
  console.log(JSON.stringify({ ok: true, checks, out }));
} catch (error) {
  console.error(error.stack||error);
  if (browser) {
    const page = (await browser.pages()).at(-1);
    await page.screenshot({ path: join(out, "failure.png") });
    await writeFile(
      join(out, "failure.json"),
      JSON.stringify(
        await page.evaluate(() => ({
          text: document.body.innerText,
          focused: document.activeElement?.outerHTML,
          clips: [...document.querySelectorAll(".dv-timeline-clip")].map(
            (x) => x.outerHTML,
          ),
          phase: document
            .querySelector(".dv-canvas-shell")
            ?.outerHTML.slice(0, 700),
        })),
        null,
        2,
      ),
    );
  }
  throw error;
} finally {
  if (browser) await closeTestBrowser(browser);
  if (server) await new Promise((r) => server.close(r));
  if (bridge) await bridge.dispose();
  await rm(root, { recursive: true, force: true });
  if (staged) await loadStagedHost(staging);
}
