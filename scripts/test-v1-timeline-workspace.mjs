/** Real Chrome + actual component + actual media Host/worker, temporary data only. */
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
            clientVersion: "0.6.0",
            workerVersion: "0.6.0",
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

  const routes = [
    requestRoute(bridge),
    mediaRoute(bridge),
    mediaRoute(bridge, true),
  ];
  server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, "http://127.0.0.1");
      if (url.pathname === "/") {
        res.setHeader("content-type", "text/html");
        res.end(
          '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><style>body{margin:0;background:#19191b;color:#eee;font:14px -apple-system,sans-serif}#mount{position:relative;width:800px;height:700px}' +
            css +
            '</style><div class="dv-root" id="mount"></div><script src="/lite.js"></script><script src="/page.js"></script></html>',
        );
        return;
      }
      if (url.pathname === "/lite.js" || url.pathname === "/page.js") {
        res.setHeader("content-type", "text/javascript");
        res.end(url.pathname === "/lite.js" ? lite : js);
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
      if (response.body) Readable.fromWeb(response.body).pipe(res);
      else res.end();
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
  await page.setViewport({ width: 900, height: 760 });
  await page.goto("http://127.0.0.1:" + server.address().port);
  await page.waitForSelector(".dv-canvas-shell[data-canvas-phase=ready]");
  await page.waitForSelector(".dv-timeline-clip");
  checks++;
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
  if (browser) await browser.close();
  if (server) await new Promise((r) => server.close(r));
  if (bridge) await bridge.dispose();
  await rm(root, { recursive: true, force: true });
  if (staged) await loadStagedHost(staging);
}
