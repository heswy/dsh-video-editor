#!/usr/bin/env node
// P3-005-B evidence runner: real Chrome, sandboxed snapshot preview, playback
// and seek vs worker frames, selection/letterbox/hit tests, in-place text edit
// write-back (cancel/commit/conflict/failure/restart), and the transient
// drag/resize capability gap. This is a dev-only spike runner; it is not the
// DSH plugin and does not install anything.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { CanvasHostServer } from "./lib/host-server.mjs";
import {
  REPO_ROOT,
  SPIKE_ROOT,
  createHarness,
  sha256,
} from "./lib/worker-harness.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = resolve(SPIKE_ROOT, "public");
const RUNTIME_PATH = resolve(PUBLIC_DIR, "preview-runtime.js");
const DEFAULT_CHROME =
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const require = createRequire(resolve(REPO_ROOT, "packages/video-engine-worker/package.json"));
const puppeteer = require("puppeteer-core");

function parseArgs(argv) {
  const args = { chrome: DEFAULT_CHROME, out: resolve(SPIKE_ROOT, "evidence") };
  for (let index = 0; index < argv.length; index++) {
    const key = argv[index];
    if (key === "--chrome") args.chrome = argv[++index];
    else if (key === "--out") args.out = resolve(argv[++index]);
    else if (key === "--headed") args.headed = true;
    else {
      console.error(`unknown argument ${key}`);
      process.exit(2);
    }
  }
  return args;
}

function sleep(ms) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  await mkdir(args.out, { recursive: true });
  const evidence = {
    kind: "p3-005b-editor-canvas-spike",
    startedAt: new Date().toISOString(),
    independence:
      "standalone test page driven by puppeteer-core; not the DSH plugin and not a real DSH page",
    versions: {
      node: process.version,
      platform: process.platform,
      puppeteer: require("puppeteer-core/package.json").version,
      contract: 1,
      runtime: "p3-005b-runtime.1",
      chrome: "system Chrome (path passed via --chrome)",
    },
    project: null,
    host: null,
    isolation: null,
    requests: { externalBlocked: [], hostCategories: {}, console: [], pageErrors: [] },
    playback: { seeks: [], playPause: null, hiddenObject: null, sceneBoundary: null, overlap: null },
    comparisons: [],
    selection: {},
    letterbox: [],
    textEdit: {},
    gap: {},
    contractProbes: {},
    cleanup: {},
    checks: [],
    failures: [],
  };
  const startedAt = Date.now();
  let chrome = null;
  let page = null;
  let server = null;
  let harness = null;
  const checks = [];
  const check = async (name, fn) => {
    try {
      const value = await fn();
      checks.push({ name, ok: true });
      evidence.checks.push({ name, ok: true });
      return value;
    } catch (error) {
      checks.push({ name, ok: false, error: String(error?.stack ?? error) });
      evidence.checks.push({ name, ok: false, error: String(error?.message ?? error) });
      throw error;
    }
  };
  const screenshot = async (name, options = {}) => {
    const path = resolve(args.out, name);
    await page.screenshot({ path, ...options });
    return path;
  };
  try {
    harness = await createHarness({ chromePath: args.chrome });
    await harness.createProject();
    const initial = await harness.inspect();
    evidence.versions.worker = harness.doctor;
    const workerPackage = JSON.parse(
      await readFile(
        resolve(REPO_ROOT, "packages/video-engine-worker/package.json"),
        "utf8",
      ),
    );
    const clientPackage = JSON.parse(
      await readFile(
        resolve(REPO_ROOT, "packages/video-engine-client/package.json"),
        "utf8",
      ),
    );
    evidence.versions.engine = {
      worker: `${workerPackage.name}@${workerPackage.version}`,
      client: `${clientPackage.name}@${clientPackage.version}`,
      reviewedCommit: "df4b74f",
      deliveryHead: "e364017",
    };
    evidence.project = {
      projectId: harness.project.projectId,
      initialRevision: initial.revision,
      duration: initial.duration,
      width: initial.width,
      height: initial.height,
      scenes: initial.scenes.map((scene) => ({
        sceneId: scene.sceneId,
        start: scene.start,
        duration: scene.duration,
      })),
      catalogue: harness.buildCatalogue(initial),
      assets: initial.files,
    };
    let currentSession = await harness.currentSession();

    server = new CanvasHostServer({
      publicDir: PUBLIC_DIR,
      runtimePath: RUNTIME_PATH,
    });
    const started = await server.start();
    const register = async (session) =>
      server.registerSnapshot({
        project: session.project,
        snapshot: session.snapshot,
        previewRoot: harness.previewRoot,
      });
    await register(currentSession);

    chrome = await puppeteer.launch({
      executablePath: args.chrome,
      headless: args.headed !== true,
      args: [
        "--disable-gpu",
        "--no-sandbox",
        "--disable-dev-shm-usage",
        "--autoplay-policy=no-user-gesture-required",
      ],
    });
    evidence.versions.chrome = await chrome.version();
    evidence.versions.userAgent = await chrome.userAgent();
    page = await chrome.newPage();
    await page.setViewport({ width: 1900, height: 1100, deviceScaleFactor: 1 });
    page.on("console", (message) => {
      if (evidence.requests.console.length < 100)
        evidence.requests.console.push({
          type: message.type(),
          text: message.text().slice(0, 500),
        });
    });
    page.on("pageerror", (error) => {
      if (evidence.requests.pageErrors.length < 40)
        evidence.requests.pageErrors.push(String(error).slice(0, 500));
    });
    await page.setRequestInterception(true);
    page.on("request", (request) => {
      let host = "";
      try {
        host = new URL(request.url()).hostname;
      } catch {
        host = "";
      }
      if (host === "127.0.0.1" || host === "localhost" || host === "") {
        request.continue();
        return;
      }
      evidence.requests.externalBlocked.push(request.url());
      request.abort();
    });
    await page.exposeFunction("dshHostRequest", async ({ op, payload } = {}) => {
      try {
        if (op === "session") {
          currentSession = await harness.currentSession();
          await register(currentSession);
          return { ok: true, result: { session: currentSession } };
        }
        if (op === "edit") {
          const response = await harness.applyEdit(payload);
          if (!response.ok) return response;
          currentSession = response.result.session;
          await register(currentSession);
          return { ok: true, result: { session: currentSession } };
        }
        return {
          ok: false,
          error: { code: "E_UNKNOWN_BRIDGE_OP", message: `unknown op ${String(op)}` },
        };
      } catch (error) {
        return {
          ok: false,
          error: { code: error.code ?? "E_HOST_BRIDGE", message: String(error.message ?? error) },
        };
      }
    });
    const canvasState = () => page.evaluate(() => window.__canvas.state());
    const diagnostics = () => page.evaluate(() => window.__canvas.diagnostics());
    const elements = () => page.evaluate(() => window.__canvas.elements());
    const waitSelection = async (stableId) => {
      await page.waitForFunction(
        (id) => window.__canvas.state().selection?.stableId === id,
        { timeout: 8000 },
        stableId,
      );
    };
    const screenPoint = (x, y) =>
      page.evaluate(
        ([px, py]) => window.__canvas.screenPoint(px, py),
        [x, y],
      );
    const clickComposition = async (x, y) => {
      const point = await screenPoint(x, y);
      await page.mouse.click(point.x, point.y);
      return point;
    };
    const doubleClickComposition = async (x, y) => {
      const point = await screenPoint(x, y);
      await page.mouse.click(point.x, point.y, { count: 2 });
      return point;
    };
    const selectionCenter = async () => {
      const state = await canvasState();
      assert.ok(state.selection, "no selection");
      const { rect } = state.selection;
      return screenPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
    };
    const setStageSize = async (width, height) => {
      await page.evaluate(
        ([w, h]) => window.__canvas.setStageSize(w, h),
        [width, height],
      );
      await sleep(120);
    };
    const waitRevisionChange = (revision) =>
      page.waitForFunction(
        (old) => {
          const value = window.__canvas.state();
          return value.revision && value.revision !== old;
        },
        { timeout: 20000 },
        revision,
      );
    const waitCommitSettled = () =>
      page.waitForFunction(
        () => {
          const value = window.__canvas.state();
          return (
            value.editing === null &&
            value.loading === false &&
            value.ready === true
          );
        },
        { timeout: 20000 },
      );
    const setOffline = (offline) => page.setOfflineMode(offline);

    await page.goto(started.url, { waitUntil: "load", timeout: 30000 });
    await page.waitForFunction(() => window.__canvas?.ready === true, {
      timeout: 30000,
    });
    await page.waitForFunction(
      () => window.__canvas.state().snapshotId !== null,
      { timeout: 30000 },
    );
    await sleep(300);
    evidence.host = {
      url: started.url,
      origin: started.origin,
      entryCachedCsp: null,
      inlineScriptHashes: null,
    };
    await screenshot("canvas-boot.png", { fullPage: false });
    await check("preview runtime ready", async () => {
      const state = await canvasState();
      assert.equal(state.ready, true);
      assert.match(state.instanceId, /^inst-[a-z0-9]{6,}$/);
      assert.ok(state.snapshotId);
      assert.ok(state.revision);
      return { instanceId: state.instanceId, snapshotId: state.snapshotId };
    });

    // ── isolation + request surface ──────────────────────────────────────
    const isolation = await page.evaluate(() => {
      const frame = document.querySelector("iframe");
      const info = {
        sandbox: frame?.getAttribute("sandbox") ?? null,
        referrerPolicy: frame?.getAttribute("referrerpolicy") ?? null,
      };
      try {
        info.contentDocument = frame.contentDocument === null ? "null" : "accessible";
      } catch (error) {
        info.contentDocument = `throws:${error.name}`;
      }
      try {
        info.contentWindowDocument = frame.contentWindow.document
          ? "accessible"
          : "null";
      } catch (error) {
        info.contentWindowDocument = `throws:${error.name}`;
      }
      return info;
    });
    await sleep(200);
    const hostStats = await diagnostics();
    evidence.isolation = {
      ...isolation,
      originOfRuntimeMessages: hostStats.metrics.lastEventOrigin,
      bridgeHealth: await page.evaluate(() => window.__canvas.bridgeHealth()),
    };
    await check("sandbox iframe is opaque and has no host access", async () => {
      assert.equal(isolation.sandbox, "allow-scripts");
      assert.equal(isolation.referrerPolicy, "no-referrer");
      assert.notEqual(isolation.contentDocument, "accessible");
      assert.notEqual(isolation.contentWindowDocument, "accessible");
      assert.equal(hostStats.metrics.lastEventOrigin, "null");
      return evidence.isolation;
    });
    // Inspect the exact entry response: CSP, inline-script hashes, injected runtime.
    const instanceId = (await canvasState()).instanceId;
    const nonceProbe = await page.evaluate(() => {
      const state = window.__canvas.state();
      return { instanceId: state.instanceId };
    });
    void nonceProbe;
    const entryResponse = await fetch(
      `${started.origin}${currentSession.entryUrl}?instance=${instanceId}&nonce=${"a".repeat(32)}`,
    );
    evidence.host.entryCachedCsp = entryResponse.headers.get("content-security-policy");
    evidence.host.inlineScriptHashes = (evidence.host.entryCachedCsp.match(/sha256-/g) ?? []).length;
    await entryResponse.arrayBuffer();
    await check("entry CSP blocks network and hashes inline scripts", async () => {
      assert.match(evidence.host.entryCachedCsp, /default-src 'none'/);
      assert.match(evidence.host.entryCachedCsp, /connect-src 'none'/);
      assert.match(evidence.host.entryCachedCsp, /frame-ancestors 'self'/);
      assert.ok(evidence.host.inlineScriptHashes >= 1);
      return { csp: evidence.host.entryCachedCsp, inlineHashes: evidence.host.inlineScriptHashes };
    });
    const categories = {};
    for (const entry of server.requests)
      categories[entry.category] = (categories[entry.category] ?? 0) + 1;
    evidence.requests.hostCategories = categories;
    await check("only Host routes are requested", async () => {
      const allowed = new Set([
        "host-page",
        "host-asset",
        "favicon",
        "runtime",
        "snapshot-entry",
        "snapshot-asset",
        "session",
      ]);
      for (const category of Object.keys(categories))
        assert.ok(allowed.has(category), `unexpected route category ${category}`);
      assert.equal(evidence.requests.externalBlocked.length, 0);
      return categories;
    });

    // Put the browser offline before playback/seek/selection: the snapshot and
    // runtime are already loaded, and no product operation may need network.
    await setOffline(true);
    evidence.playback.offline = await page.evaluate(() => ({
      onLine: navigator.onLine,
    }));

    // ── pixel-size phase: fixed 1280×720 stage at page origin ────────────
    await page.evaluate(() => {
      const stage = document.getElementById("stage");
      stage.style.position = "fixed";
      stage.style.left = "0";
      stage.style.top = "0";
      stage.style.zIndex = "9999";
      stage.style.width = "1280px";
      stage.style.height = "720px";
    });
    await sleep(200);
    const pixelStage = await canvasState();
    await check("composition renders at 1:1 for pixel comparison", async () => {
      assert.equal(Math.round(pixelStage.stage.scale * 1000) / 1000, 1);
      const frameBox = await page.evaluate(() => {
        const frame = document.querySelector("iframe");
        const rect = frame.getBoundingClientRect();
        return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
      });
      assert.equal(frameBox.x, 0);
      assert.equal(frameBox.y, 0);
      assert.equal(frameBox.width, 1280);
      assert.equal(frameBox.height, 720);
      return frameBox;
    });

    // ── playback / seek ──────────────────────────────────────────────────
    const seekTimes = [0, 0.5, 1.5, 2.75, 4.99, 5.0, 6.5, 9.0, 10.99];
    for (const requested of seekTimes) {
      const actual = await page.evaluate((time) => window.__canvas.seek(time), requested);
      evidence.playback.seeks.push({ requested, actual });
      await check(`seek ${requested}s`, async () => {
        assert.ok(Math.abs(actual - requested) < 1e-3, `${actual} != ${requested}`);
      });
    }
    await page.evaluate(() => window.__canvas.seek(2.0));
    await page.evaluate(() => window.__canvas.play());
    const playStart = await canvasState();
    await sleep(800);
    const playingState = await canvasState();
    const pauseAt = await page.evaluate(() => window.__canvas.pause());
    await sleep(250);
    const pausedState = await canvasState();
    evidence.playback.playPause = {
      startTime: playStart.time,
      after800ms: playingState.time,
      playingFlag: playingState.playing,
      pauseReturned: pauseAt,
      afterPause250ms: pausedState.time,
    };
    await check("real play advances timeline and pause holds it", async () => {
      assert.ok(playingState.time - playStart.time > 0.4, "timeline did not advance");
      assert.equal(playingState.playing, true);
      assert.ok(Math.abs(pausedState.time - pauseAt) < 0.05, "timeline advanced after pause");
      return evidence.playback.playPause;
    });

    // Hidden (time-window) object: scene-2 subtitle starts 0.4s into scene 2.
    const initialElements = await elements();
    const subtitle = initialElements.find((element) => element.stableId === "scene-2-subtitle");
    assert.ok(subtitle, "scene-2-subtitle is missing from the document");
    await page.evaluate(() => window.__canvas.seek(5.1));
    const hiddenHit = await page.evaluate(
      ([x, y]) => window.__canvas.hit(x, y),
      [subtitle.rect.x + 20, subtitle.rect.y + subtitle.rect.height / 2],
    );
    await page.evaluate(() => window.__canvas.seek(5.6));
    const visibleHit = await page.evaluate(
      ([x, y]) => window.__canvas.hit(x, y),
      [subtitle.rect.x + 20, subtitle.rect.y + subtitle.rect.height / 2],
    );
    evidence.playback.hiddenObject = {
      subtitleRect: subtitle.rect,
      at_5_1: hiddenHit?.stableId ?? null,
      at_5_6: visibleHit?.stableId ?? null,
    };
    await check("time-window hidden objects are not selectable", async () => {
      assert.notEqual(hiddenHit?.stableId, "scene-2-subtitle");
      assert.equal(visibleHit?.stableId, "scene-2-subtitle");
      return evidence.playback.hiddenObject;
    });

    // Multi-scene boundary and overlap stacks.
    await page.evaluate(() => window.__canvas.seek(4.99));
    const beforeBoundary = await page.evaluate(() => window.__canvas.hit(120, 210));
    await page.evaluate(() => window.__canvas.seek(5.01));
    const justAfterBoundary = await page.evaluate(() => window.__canvas.hit(120, 210));
    await page.evaluate(() => window.__canvas.seek(6.5));
    const afterBoundary = await page.evaluate(() => window.__canvas.hit(120, 210));
    // At 6.5s the scene-2 rule has finished its scaleX tween (starts 5.2s,
    // duration 1.2s), so it overlaps the shot at (900, 561).
    const overlapHit = await page.evaluate(() => window.__canvas.hit(900, 561));
    evidence.playback.sceneBoundary = {
      at_4_99: beforeBoundary?.stableId ?? null,
      just_after_5_0_during_intro: justAfterBoundary?.stableId ?? null,
      at_6_5: afterBoundary?.stableId ?? null,
    };
    evidence.playback.overlap = {
      at_900_561: overlapHit?.stableId ?? null,
      stack: overlapHit?.stack ?? [],
    };
    await check("scene boundary switches the hit-tested object", async () => {
      assert.equal(beforeBoundary?.stableId, "scene-1-title");
      assert.equal(afterBoundary?.stableId, "scene-2-title");
      // At 5.01s the scene-2 title intro tween has just started (opacity≈0);
      // it is intentionally not selectable yet and the structural container is
      // reported instead.
      assert.equal(justAfterBoundary?.stableId, "scene-2-section");
      return evidence.playback.sceneBoundary;
    });
    await check("overlap returns topmost visible object with a stack", async () => {
      assert.equal(overlapHit?.stableId, "scene-2-shot");
      assert.ok(overlapHit.stack.includes("scene-2-shot"));
      assert.ok(overlapHit.stack.includes("scene-2-rule"), "overlap stack should expose the rule underneath");
      assert.ok(overlapHit.stack.length >= 2);
      return evidence.playback.overlap;
    });

    // Worker-frame comparison at three times.
    for (const time of [1.5, 5.5, 9.0]) {
      await page.evaluate((value) => window.__canvas.seek(value), time);
      const workerFrame = await harness.frame(currentSession.project.revision, time);
      const screenshotPath = resolve(args.out, `frame-${time.toFixed(1)}-preview.png`);
      await page.screenshot({
        path: screenshotPath,
        clip: { x: 0, y: 0, width: 1280, height: 720 },
      });
      const workerPath = resolve(args.out, `frame-${time.toFixed(1)}-worker.png`);
      await writeFile(workerPath, workerFrame.bytes);
      const comparison = await page.evaluate(
        async ({ workerBase64, previewBase64 }) => {
          const load = (base64) =>
            new Promise((resolveLoad, rejectLoad) => {
              const image = new Image();
              image.onload = () => resolveLoad(image);
              image.onerror = () => rejectLoad(new Error("image decode failed"));
              image.src = `data:image/png;base64,${base64}`;
            });
          const [workerImage, previewImage] = await Promise.all([
            load(workerBase64),
            load(previewBase64),
          ]);
          if (
            workerImage.naturalWidth !== previewImage.naturalWidth ||
            workerImage.naturalHeight !== previewImage.naturalHeight
          )
            return {
              sizeMismatch: true,
              worker: [workerImage.naturalWidth, workerImage.naturalHeight],
              preview: [previewImage.naturalWidth, previewImage.naturalHeight],
            };
          const width = workerImage.naturalWidth;
          const height = workerImage.naturalHeight;
          const canvasOf = (image) => {
            const canvas = document.createElement("canvas");
            canvas.width = width;
            canvas.height = height;
            const context = canvas.getContext("2d");
            context.drawImage(image, 0, 0);
            return context.getImageData(0, 0, width, height).data;
          };
          const a = canvasOf(workerImage);
          const b = canvasOf(previewImage);
          let sum = 0;
          let maxDelta = 0;
          let identical = 0;
          const pixels = width * height;
          for (let index = 0; index < a.length; index += 4) {
            const delta = Math.max(
              Math.abs(a[index] - b[index]),
              Math.abs(a[index + 1] - b[index + 1]),
              Math.abs(a[index + 2] - b[index + 2]),
            );
            sum += delta;
            if (delta > maxDelta) maxDelta = delta;
            if (delta <= 2) identical += 1;
          }
          return {
            width,
            height,
            pixels,
            mae: sum / pixels,
            maxDelta,
            identicalPct: identical / pixels,
          };
        },
        {
          workerBase64: workerFrame.bytes.toString("base64"),
          previewBase64: (
            await readFile(screenshotPath)
          ).toString("base64"),
        },
      );
      evidence.comparisons.push({
        time,
        workerSha256: workerFrame.sha256,
        previewSha256: sha256(await readFile(screenshotPath)),
        ...comparison,
      });
      await check(`preview matches worker frame at ${time}s`, async () => {
        assert.ok(!comparison.sizeMismatch, "size mismatch");
        assert.ok(comparison.identicalPct > 0.85, `identicalPct ${comparison.identicalPct}`);
        assert.ok(comparison.mae < 4, `mae ${comparison.mae}`);
        return comparison;
      });
    }

    // ── selection with real mouse, normal stage layout ───────────────────
    await page.evaluate(() => {
      const stage = document.getElementById("stage");
      stage.style.position = "";
      stage.style.left = "";
      stage.style.top = "";
      stage.style.zIndex = "";
    });
    await page.evaluate(() => window.__canvas.setStageSize(1280, 720));
    await sleep(200);
    await page.evaluate(() => window.__canvas.seek(1.0));
    const layoutElements = await elements();
    const title = layoutElements.find((element) => element.stableId === "scene-1-title");
    assert.ok(title, "scene-1-title is missing");
    const titlePoint = {
      x: title.rect.x + title.rect.width / 2,
      y: title.rect.y + title.rect.height / 2,
    };
    await clickComposition(titlePoint.x, titlePoint.y);
    await waitSelection("scene-1-title");
    const afterSelectElements = await elements();
    const selected = await canvasState();
    evidence.selection = {
      titleHit: await page.evaluate(
        ([x, y]) => window.__canvas.hit(x, y),
        [titlePoint.x, titlePoint.y],
      ),
      selected: selected.selection,
      elementsUnchanged:
        JSON.stringify(afterSelectElements) === JSON.stringify(layoutElements),
      overlayOnlyInHost: await page.evaluate(() => {
        const selection = document.getElementById("selection");
        return {
          selectionVisible: !selection.classList.contains("hidden"),
          frameCount: document.querySelectorAll("iframe").length,
        };
      }),
    };
    await screenshot("selection-title.png", { fullPage: false });
    await check("real click selects the exact stableId; overlay is Host-only", async () => {
      assert.equal(selected.selection.stableId, "scene-1-title");
      assert.equal(evidence.selection.elementsUnchanged, true);
      assert.equal(evidence.selection.overlayOnlyInHost.selectionVisible, true);
      assert.equal(evidence.selection.overlayOnlyInHost.frameCount, 1);
      return evidence.selection;
    });

    // Non-text object: selectable, no text editor.
    await page.evaluate(() => window.__canvas.seek(5.6));
    const shot = (await elements()).find((element) => element.stableId === "scene-2-shot");
    await clickComposition(shot.rect.x + shot.rect.width / 2, shot.rect.y + shot.rect.height / 2);
    await waitSelection("scene-2-shot");
    await doubleClickComposition(
      shot.rect.x + shot.rect.width / 2,
      shot.rect.y + shot.rect.height / 2,
    );
    await sleep(200);
    const afterLogoDoubleClick = await canvasState();
    evidence.selection.nonText = {
      selection: afterLogoDoubleClick.selection,
      editing: afterLogoDoubleClick.editing,
    };
    await check("non-text object is selectable but has no in-place text editor", async () => {
      assert.equal(afterLogoDoubleClick.selection.editableText, false);
      assert.equal(afterLogoDoubleClick.editing, null);
      return evidence.selection.nonText;
    });

    // Structural / unknown object: not in the editable selection scope.
    await page.evaluate(() => {
      const selection = document.getElementById("selection");
      selection.classList.add("hidden");
    });
    const structuralHit = await page.evaluate(() => window.__canvas.hit(10, 10));
    evidence.selection.structural = {
      hit: structuralHit?.stableId ?? null,
      inCatalogue: harness.buildCatalogue(initial).some(
        (entry) => entry.stableId === structuralHit?.stableId,
      ),
    };
    await check("structural containers are outside the selectable scope", async () => {
      assert.ok(structuralHit);
      assert.equal(evidence.selection.structural.inCatalogue, false);
      return evidence.selection.structural;
    });

    // ── letterbox / scale mapping ────────────────────────────────────────
    for (const [width, height] of [
      [1100, 700],
      [760, 640],
    ]) {
      await setStageSize(width, height);
      await page.evaluate(() => window.__canvas.seek(1.0));
      const state = await canvasState();
      const element = (await elements()).find(
        (entry) => entry.stableId === "scene-1-title",
      );
      const point = await screenPoint(
        element.rect.x + element.rect.width / 2,
        element.rect.y + element.rect.height / 2,
      );
      await page.mouse.click(point.x, point.y);
      await waitSelection("scene-1-title");
      const marginPoint = {
        x: state.stage.stageRect.left + state.stage.stageRect.width / 2,
        y:
          state.stage.top > 0
            ? state.stage.stageRect.top + 4
            : state.stage.stageRect.top + state.stage.stageRect.height / 2,
      };
      await page.mouse.click(marginPoint.x, marginPoint.y);
      await sleep(120);
      const afterMargin = await canvasState();
      if (width === 1100) await screenshot("letterbox-1100x700.png", { fullPage: false });
      evidence.letterbox.push({
        stageSize: [width, height],
        scale: state.stage.scale,
        letterbox: { left: state.stage.left, top: state.stage.top },
        clickPoint: point,
        hitStableId: "scene-1-title",
        marginPoint,
        selectionAfterMargin: afterMargin.selection?.stableId ?? null,
      });
      await check(`letterbox mapping at ${width}×${height}`, async () => {
        assert.ok(Math.abs(state.stage.scale - Math.min(width / 1280, height / 720)) < 1e-6);
        assert.equal(afterMargin.selection, null, "letterbox margin must not hit content");
        return evidence.letterbox.at(-1);
      });
    }
    await setStageSize(1280, 720);
    await page.evaluate(() => window.__canvas.seek(1.0));

    await setOffline(false);
    evidence.playback.offline.restoredOnline = await page.evaluate(
      () => navigator.onLine,
    );
    await check("playback/seek/selection ran with the browser offline", async () => {
      assert.equal(evidence.playback.offline.onLine, false);
      assert.equal(evidence.playback.offline.restoredOnline, true);
      return evidence.playback.offline;
    });

    // ── in-place text edit: cancel / commit / persistence ────────────────
    const beforeEditState = await canvasState();
    await page.evaluate(() => window.__canvas.seek(1.0));
    const textElements = await elements();
    const editTitle = textElements.find((element) => element.stableId === "scene-1-title");
    const editPoint = {
      x: editTitle.rect.x + editTitle.rect.width / 2,
      y: editTitle.rect.y + editTitle.rect.height / 2,
    };
    await clickComposition(editPoint.x, editPoint.y);
    await waitSelection("scene-1-title");
    await doubleClickComposition(editPoint.x, editPoint.y);
    await page.waitForFunction(() => window.__canvas.state().editing !== null, {
      timeout: 8000,
    });
    const editorOriginal = await page.evaluate(
      () => document.getElementById("text-editor").textContent,
    );
    await screenshot("text-editor-open.png", { fullPage: false });
    await page.keyboard.type("取消不应保存");
    await page.keyboard.press("Escape");
    await sleep(250);
    const afterCancel = await page.evaluate(() => ({
      state: window.__canvas.state(),
      editorHidden: document.getElementById("text-editor").classList.contains("hidden"),
    }));
    const inspectAfterCancel = await harness.inspect();
    evidence.textEdit.cancel = {
      editorOriginal,
      afterCancel: {
        editing: afterCancel.state.editing,
        revision: afterCancel.state.revision,
        editorHidden: afterCancel.editorHidden,
      },
      workerRevision: inspectAfterCancel.revision,
      workerText: inspectAfterCancel.elements.find(
        (element) => element.stableId === "scene-1-title",
      )?.text,
    };
    await check("Esc restores text without writing", async () => {
      assert.equal(afterCancel.state.editing, null);
      assert.equal(afterCancel.state.revision, beforeEditState.revision);
      assert.equal(inspectAfterCancel.revision, beforeEditState.revision);
      assert.equal(afterCancel.editorHidden, true);
      return evidence.textEdit.cancel;
    });

    const commitFrom = await canvasState();
    await doubleClickComposition(editPoint.x, editPoint.y);
    await page.waitForFunction(() => window.__canvas.state().editing !== null, {
      timeout: 8000,
    });
    await page.keyboard.type("画布原位修改");
    await page.keyboard.press("Enter");
    await waitRevisionChange(commitFrom.revision);
    await waitCommitSettled();
    const afterCommit = await canvasState();
    const inspectAfterCommit = await harness.inspect();
    await screenshot("text-committed.png", { fullPage: false });
    evidence.textEdit.commit = {
      beforeRevision: commitFrom.revision,
      afterRevision: afterCommit.revision,
      workerText: inspectAfterCommit.elements.find(
        (element) => element.stableId === "scene-1-title",
      )?.text,
      snapshotId: afterCommit.snapshotId,
      historyCursor: null,
    };
    await check("Enter commits through worker edit and reloads a new snapshot", async () => {
      assert.notEqual(afterCommit.revision, commitFrom.revision);
      assert.equal(evidence.textEdit.commit.workerText, "画布原位修改");
      assert.notEqual(afterCommit.snapshotId, commitFrom.snapshotId);
      return evidence.textEdit.commit;
    });

    // Invalid states required by the task: stale revision, released/old
    // snapshot, and worker-exit cleanup.
    let stalePreviewCode = null;
    try {
      await harness.client.previewSnapshot({
        projectId: harness.project.projectId,
        revision: commitFrom.revision,
      });
    } catch (error) {
      stalePreviewCode = error.code;
    }
    const oldSnapshotRoute = await fetch(
      `${started.origin}/preview/${commitFrom.snapshotId}/${currentSession.snapshot.entry}`,
    );
    await oldSnapshotRoute.arrayBuffer();
    const oldSnapshotRelease = await harness.client
      .previewRelease({ snapshotId: commitFrom.snapshotId })
      .then(() => ({ code: null }))
      .catch((error) => ({ code: error.code }));
    evidence.host.snapshotLifecycle = {
      staleRevision: {
        requested: commitFrom.revision,
        current: afterCommit.revision,
        code: stalePreviewCode,
      },
      oldSnapshotAfterSwitch: {
        snapshotId: commitFrom.snapshotId,
        hostRouteStatus: oldSnapshotRoute.status,
        releaseCode: oldSnapshotRelease.code,
      },
    };
    await check("snapshot lifecycle rejects stale revisions and invalidated snapshots", async () => {
      assert.equal(stalePreviewCode, "E_REVISION_CONFLICT");
      assert.equal(oldSnapshotRoute.status, 404);
      assert.equal(oldSnapshotRelease.code, "E_SNAPSHOT_NOT_FOUND");
      return evidence.host.snapshotLifecycle;
    });

    // Persistence across close/reopen and a full worker restart.
    await harness.reopenProject();
    let persistenceSession = await harness.currentSession();
    await register(persistenceSession);
    await page.evaluate(
      async (session) => {
        const bridge = window.dshHostRequest;
        void bridge;
        void session;
      },
      persistenceSession,
    );
    await page.evaluate(() => window.__canvas.refreshAndRetry());
    await page.waitForFunction(() => window.__canvas.state().ready === true && window.__canvas.state().loading === false, {
      timeout: 20000,
    });
    const persistenceElements = await elements();
    const persistenceTitle = persistenceElements.find(
      (element) => element.stableId === "scene-1-title",
    );
    evidence.textEdit.persistence = {
      reopenRevision: persistenceSession.project.revision,
      reopenText: persistenceTitle?.text ?? null,
    };
    await harness.restartWorker();
    persistenceSession = await harness.currentSession();
    await register(persistenceSession);
    await page.evaluate(() => window.__canvas.refreshAndRetry());
    await page.waitForFunction(() => window.__canvas.state().ready === true && window.__canvas.state().loading === false, {
      timeout: 20000,
    });
    const restartedTitle = (await elements()).find(
      (element) => element.stableId === "scene-1-title",
    );
    evidence.textEdit.persistence.afterWorkerRestart = {
      revision: persistenceSession.project.revision,
      text: restartedTitle?.text ?? null,
      previewsAfterWorkerExit: harness.previewsAfterWorkerExit ?? null,
    };
    await check("text edit persists across close/reopen and worker restart", async () => {
      assert.equal(evidence.textEdit.persistence.reopenText, "画布原位修改");
      assert.equal(evidence.textEdit.persistence.afterWorkerRestart.text, "画布原位修改");
      assert.deepEqual(evidence.textEdit.persistence.afterWorkerRestart.previewsAfterWorkerExit, []);
      return evidence.textEdit.persistence;
    });

    // ── conflict: another writer commits first; UI must not overwrite ────
    const staleState = await canvasState();
    const external = await harness.applyEdit({
      expectedRevision: staleState.revision,
      operationId: "external-writer-1",
      ops: [{ type: "text", target: "scene-1-title", text: "外部 AI 修改" }],
    });
    assert.equal(external.ok, true, JSON.stringify(external));
    const afterExternal = await harness.inspect();
    evidence.textEdit.conflict = {
      staleRevision: staleState.revision,
      externalRevision: external.result.session.project.revision,
      externalText: afterExternal.elements.find(
        (element) => element.stableId === "scene-1-title",
      )?.text,
    };
    // The page still shows the stale snapshot; open editor and submit.
    await page.evaluate(() => window.__canvas.seek(1.0));
    const staleTitle = (await elements()).find(
      (element) => element.stableId === "scene-1-title",
    );
    await clickComposition(
      staleTitle.rect.x + staleTitle.rect.width / 2,
      staleTitle.rect.y + staleTitle.rect.height / 2,
    );
    await waitSelection("scene-1-title");
    await doubleClickComposition(
      staleTitle.rect.x + staleTitle.rect.width / 2,
      staleTitle.rect.y + staleTitle.rect.height / 2,
    );
    await page.waitForFunction(() => window.__canvas.state().editing !== null, {
      timeout: 8000,
    });
    await page.keyboard.type("冲突提交不应覆盖");
    await page.keyboard.press("Enter");
    await page.waitForFunction(
      () => {
        const value = window.__canvas.state();
        return value.pendingEdit !== null;
      },
      { timeout: 15000 },
    );
    const conflictState = await canvasState();
    const afterConflictInspect = await harness.inspect();
    evidence.textEdit.conflict.ui = {
      pendingEdit: conflictState.pendingEdit,
      revision: conflictState.revision,
      workerRevision: afterConflictInspect.revision,
      workerText: afterConflictInspect.elements.find(
        (element) => element.stableId === "scene-1-title",
      )?.text,
    };
    await check("stale revision commit fails without overwriting the human/AI text", async () => {
      assert.match(conflictState.pendingEdit.code, /E_REVISION_CONFLICT/);
      assert.equal(afterConflictInspect.revision, external.result.session.project.revision);
      assert.equal(
        evidence.textEdit.conflict.ui.workerText,
        "外部 AI 修改",
        "conflict must not overwrite",
      );
      return evidence.textEdit.conflict;
    });
    // Refresh then retry succeeds.
    await page.evaluate(() => window.__canvas.refreshAndRetry());
    await page.waitForFunction(() => window.__canvas.state().ready === true && window.__canvas.state().loading === false, {
      timeout: 20000,
    });
    await page.evaluate(() => window.__canvas.seek(1.0));
    const retryTitle = (await elements()).find(
      (element) => element.stableId === "scene-1-title",
    );
    await doubleClickComposition(
      retryTitle.rect.x + retryTitle.rect.width / 2,
      retryTitle.rect.y + retryTitle.rect.height / 2,
    );
    await page.waitForFunction(() => window.__canvas.state().editing !== null, {
      timeout: 8000,
    });
    const retryFrom = await canvasState();
    await page.keyboard.type("冲突后重试");
    await page.keyboard.press("Enter");
    await waitRevisionChange(retryFrom.revision);
    await waitCommitSettled();
    const retryInspect = await harness.inspect();
    evidence.textEdit.conflict.retry = {
      revision: retryInspect.revision,
      text: retryInspect.elements.find(
        (element) => element.stableId === "scene-1-title",
      )?.text,
    };
    await check("refresh-then-retry commits the draft", async () => {
      assert.equal(evidence.textEdit.conflict.retry.text, "冲突后重试");
      return evidence.textEdit.conflict.retry;
    });

    // ── failure injection: read-only project dir -> E_PERSIST -> retry ───
    await page.evaluate(() => window.__canvas.seek(1.0));
    const failTitle = (await elements()).find(
      (element) => element.stableId === "scene-1-title",
    );
    await doubleClickComposition(
      failTitle.rect.x + failTitle.rect.width / 2,
      failTitle.rect.y + failTitle.rect.height / 2,
    );
    await page.waitForFunction(() => window.__canvas.state().editing !== null, {
      timeout: 8000,
    });
    const failFrom = await canvasState();
    await harness.chmodProject(0o555);
    try {
      await page.keyboard.type("持久失败重试");
      await page.keyboard.press("Enter");
      await page.waitForFunction(
        () => window.__canvas.state().pendingEdit !== null,
        { timeout: 15000 },
      );
    } finally {
      await harness.chmodProject(0o755);
    }
    const persistFail = await canvasState();
    const persistInspect = await harness.inspect();
    evidence.textEdit.failure = {
      pendingEdit: persistFail.pendingEdit,
      revision: persistInspect.revision,
      text: persistInspect.elements.find(
        (element) => element.stableId === "scene-1-title",
      )?.text,
    };
    await check("persistence failure keeps the draft and does not change the project", async () => {
      assert.match(persistFail.pendingEdit.code, /E_PERSIST/);
      assert.equal(persistInspect.revision, failFrom.revision);
      return evidence.textEdit.failure;
    });
    await page.evaluate(() => window.__canvas.refreshAndRetry());
    await page.waitForFunction(() => window.__canvas.state().ready === true && window.__canvas.state().loading === false, {
      timeout: 20000,
    });
    await page.evaluate(() => window.__canvas.seek(1.0));
    const retryFailTitle = (await elements()).find(
      (element) => element.stableId === "scene-1-title",
    );
    await doubleClickComposition(
      retryFailTitle.rect.x + retryFailTitle.rect.width / 2,
      retryFailTitle.rect.y + retryFailTitle.rect.height / 2,
    );
    await page.waitForFunction(() => window.__canvas.state().editing !== null, {
      timeout: 8000,
    });
    const failureRetryFrom = await canvasState();
    await page.keyboard.type("持久失败后重试");
    await page.keyboard.press("Enter");
    await waitRevisionChange(failureRetryFrom.revision);
    await waitCommitSettled();
    const failureRetryInspect = await harness.inspect();
    evidence.textEdit.failure.retry = {
      revision: failureRetryInspect.revision,
      text: failureRetryInspect.elements.find(
        (element) => element.stableId === "scene-1-title",
      )?.text,
    };
    await check("retry after restoring permissions succeeds", async () => {
      assert.equal(evidence.textEdit.failure.retry.text, "持久失败后重试");
      return evidence.textEdit.failure.retry;
    });

    // ── capability gap: transient drag / resize, no write path ──────────
    await page.evaluate(() => window.__canvas.seek(1.0));
    const gapTitle = (await elements()).find(
      (element) => element.stableId === "scene-1-title",
    );
    const beforeDragRect = { ...gapTitle.rect };
    await clickComposition(
      gapTitle.rect.x + gapTitle.rect.width / 2,
      gapTitle.rect.y + gapTitle.rect.height / 2,
    );
    await waitSelection("scene-1-title");
    const center = await selectionCenter();
    await page.mouse.move(center.x, center.y);
    await page.mouse.down();
    await page.mouse.move(center.x + 120, center.y + 40, { steps: 8 });
    await page.mouse.move(center.x + 120, center.y + 40);
    await page.mouse.up();
    await page.waitForFunction(() => window.__canvas.state().gapProposal !== null, {
      timeout: 5000,
    });
    const dragProposal = await canvasState();
    const afterDragElements = await elements();
    const afterDragTitle = afterDragElements.find(
      (element) => element.stableId === "scene-1-title",
    );
    await screenshot("transient-drag.png", { fullPage: false });
    const dragWriteback = await page.evaluate(() =>
      window.__canvas.attemptGapWriteback("move"),
    );
    const afterDragSession = await harness.currentSession();
    evidence.gap.drag = {
      beforeRect: beforeDragRect,
      proposal: dragProposal.gapProposal,
      documentRectAfterDrag: afterDragTitle.rect,
      overlayRect: dragProposal.selection.rect,
      writeback: dragWriteback,
      revisionAfterWriteback: afterDragSession.project.revision,
      revisionStable: afterDragSession.project.revision === currentSession.project.revision,
    };
    await check("drag is transient only and the worker rejects the layout op", async () => {
      assert.equal(dragProposal.gapProposal.kind, "move");
      assert.equal(
        JSON.stringify(afterDragTitle.rect),
        JSON.stringify(beforeDragRect),
        "snapshot document must not move",
      );
      assert.notDeepEqual(dragProposal.selection.rect, beforeDragRect);
      assert.equal(dragWriteback.workerError?.code, "E_PARAMS");
      assert.equal(evidence.gap.drag.revisionStable, true);
      return evidence.gap.drag;
    });
    await page.evaluate(() => window.__canvas.reloadSession());
    await page.waitForFunction(
      () => window.__canvas.state().gapProposal === null && window.__canvas.state().ready === true,
      { timeout: 20000 },
    );
    await page.evaluate(() => window.__canvas.seek(1.0));
    const reloadedTitle = (await elements()).find(
      (element) => element.stableId === "scene-1-title",
    );
    evidence.gap.drag.afterReloadRect = reloadedTitle.rect;

    // Resize handle: transient too.
    await page.evaluate(() => window.__canvas.seek(1.0));
    const resizeTitle = (await elements()).find(
      (element) => element.stableId === "scene-1-title",
    );
    await clickComposition(
      resizeTitle.rect.x + resizeTitle.rect.width / 2,
      resizeTitle.rect.y + resizeTitle.rect.height / 2,
    );
    await waitSelection("scene-1-title");
    const handleBox = await page.evaluate(() => {
      const handle = document.querySelector("#selection .handle-se");
      const rect = handle.getBoundingClientRect();
      return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    });
    await page.mouse.move(handleBox.x, handleBox.y);
    await page.mouse.down();
    await page.mouse.move(handleBox.x + 80, handleBox.y + 30, { steps: 8 });
    await page.mouse.up();
    await page.waitForFunction(() => window.__canvas.state().gapProposal !== null, {
      timeout: 5000,
    });
    const resizeProposal = await canvasState();
    const resizeWriteback = await page.evaluate(() =>
      window.__canvas.attemptGapWriteback("resize"),
    );
    evidence.gap.resize = {
      proposal: resizeProposal.gapProposal,
      writeback: resizeWriteback,
    };
    await check("resize is transient only and the worker rejects the layout op", async () => {
      assert.equal(resizeProposal.gapProposal.kind, "resize");
      assert.equal(resizeWriteback.workerError?.code, "E_PARAMS");
      return evidence.gap.resize;
    });

    // Playback guard: dragging during playback must not start.
    await page.evaluate(() => window.__canvas.reloadSession());
    await page.waitForFunction(
      () => window.__canvas.state().ready === true && window.__canvas.state().loading === false,
      { timeout: 20000 },
    );
    await page.evaluate(() => window.__canvas.seek(1.5));
    const guardTitle = (await elements()).find(
      (element) => element.stableId === "scene-1-title",
    );
    await clickComposition(
      guardTitle.rect.x + guardTitle.rect.width / 2,
      guardTitle.rect.y + guardTitle.rect.height / 2,
    );
    await waitSelection("scene-1-title");
    await page.evaluate(() => window.__canvas.play());
    await sleep(250);
    const guardCenter = await selectionCenter();
    await page.mouse.move(guardCenter.x, guardCenter.y);
    await page.mouse.down();
    await page.mouse.move(guardCenter.x + 90, guardCenter.y + 30, { steps: 4 });
    await page.mouse.up();
    await sleep(150);
    const playGuard = await canvasState();
    await page.evaluate(() => window.__canvas.pause());
    const guardLog = await diagnostics();
    evidence.gap.playbackGuard = {
      gapProposalAfterDrag: playGuard.gapProposal,
      blockedDiagnostics: guardLog.log.filter(
        (entry) => entry.type === "drag-blocked-while-playing",
      ),
    };
    await check("dragging during playback is blocked", async () => {
      const current = await canvasState();
      const hasBlocked = guardLog.log.some(
        (entry) => entry.type === "drag-blocked-while-playing",
      );
      assert.equal(hasBlocked, true);
      assert.notEqual(current.gapProposal?.kind, "move");
      return evidence.gap.playbackGuard;
    });

    // ── contract probes in the real page ────────────────────────────────
    const oldInstanceId = (await canvasState()).instanceId;
    const beforeProbeMetrics = (await diagnostics()).metrics;
    await page.evaluate(() => {
      const state = window.__canvas.state();
      const frame = document.querySelector("iframe");
      frame.contentWindow.postMessage(
        {
          v: 1,
          kind: "cmd",
          instanceId: state.instanceId,
          nonce: "f".repeat(32),
          seq: 999,
          type: "state",
          payload: {},
        },
        "*",
      );
    });
    await sleep(350);
    const afterWrongNonce = (await diagnostics()).metrics;
    await page.evaluate(() => window.__canvas.foreignMessageProbe());
    await sleep(150);
    const afterForeign = (await diagnostics()).metrics;
    // A new session revokes the old instance; commands to it must fail.
    await page.evaluate(() => window.__canvas.refreshAndRetry());
    await page.waitForFunction(() => window.__canvas.state().ready === true && window.__canvas.state().loading === false, {
      timeout: 20000,
    });
    const revokedResult = await page.evaluate(async (instanceId) => {
      try {
        await window.__canvas.sendTo(instanceId, "state");
        return { ok: true };
      } catch (error) {
        return { ok: false, code: error.code };
      }
    }, oldInstanceId);
    const finalDiagnostics = await diagnostics();
    evidence.contractProbes = {
      runtimeMessageOrigin: finalDiagnostics.metrics.lastEventOrigin,
      wrongNonce: {
        commandsSentDelta: afterWrongNonce.commandsSent - beforeProbeMetrics.commandsSent,
        eventsAcceptedDelta:
          afterWrongNonce.eventsAccepted - beforeProbeMetrics.eventsAccepted,
        droppedDelta: afterWrongNonce.eventsDropped - beforeProbeMetrics.eventsDropped,
      },
      foreignSourceDelta:
        afterForeign.foreignSourceMessages - beforeProbeMetrics.foreignSourceMessages,
      revokedInstance: {
        oldInstanceId,
        result: revokedResult,
        revokedRejections: finalDiagnostics.metrics.revokedRejections,
        liveInstanceCount: finalDiagnostics.metrics.instancesCreated - finalDiagnostics.metrics.instancesRevoked,
      },
    };
    await check("wrong nonce is ignored; foreign sources are counted; revoked instance rejects", async () => {
      assert.equal(evidence.contractProbes.wrongNonce.eventsAcceptedDelta, 0);
      assert.equal(evidence.contractProbes.foreignSourceDelta, 1);
      assert.equal(revokedResult.ok, false);
      assert.ok(["E_INSTANCE_NOT_FOUND", "E_INSTANCE_REVOKED"].includes(revokedResult.code));
      return evidence.contractProbes;
    });

    // ── cleanup ─────────────────────────────────────────────────────────
    const finalSnapshotId = (await canvasState()).snapshotId;
    const destroy = await page.evaluate(() => window.__canvas.destroyAll());
    const metricsAfterDestroy = (await diagnostics()).metrics;
    await sleep(300);
    const metricsSettled = (await diagnostics()).metrics;
    evidence.cleanup.destroy = destroy;
    evidence.cleanup.runtimeEventsAfterDestroy = {
      commandsDelta: metricsSettled.commandsSent - metricsAfterDestroy.commandsSent,
      eventsDelta: metricsSettled.eventsAccepted - metricsAfterDestroy.eventsAccepted,
    };
    await check("all preview instances destroyed and frames removed", async () => {
      assert.equal(destroy.remainingInstances, 0);
      assert.equal(destroy.frames, 0);
      for (const result of destroy.results) assert.equal(result.destroyed, true);
      assert.equal(evidence.cleanup.runtimeEventsAfterDestroy.commandsDelta, 0);
      assert.equal(evidence.cleanup.runtimeEventsAfterDestroy.eventsDelta, 0);
      return destroy;
    });
    // Host revocation follows canvas teardown: the snapshot route must stop
    // serving bytes once the Host drops its registration.
    server.revokeAll();
    const revokedEntry = await fetch(
      `${started.origin}${currentSession.entryUrl}?instance=inst-deadbeef&nonce=${"a".repeat(32)}`,
    );
    evidence.cleanup.hostRouteAfterCleanup = revokedEntry.status;
    await revokedEntry.arrayBuffer();
    await server.close();
    server = null;
    await harness.releaseSnapshot(finalSnapshotId);
    const previewEntries = await harness.previewDirectoryEntries();
    await harness.cleanup();
    harness = null;
    await chrome.close();
    chrome = null;
    await check("preview snapshot, worker run dir and browser are cleaned up", async () => {
      assert.equal(evidence.cleanup.hostRouteAfterCleanup, 404);
      assert.deepEqual(previewEntries, []);
      return { previewEntries, hostRouteAfterCleanup: evidence.cleanup.hostRouteAfterCleanup };
    });
  } catch (error) {
    evidence.failures.push(String(error?.stack ?? error));
    process.exitCode = 1;
    try {
      if (page)
        evidence.failureDebug = {
          state: await page.evaluate(() => window.__canvas?.state?.() ?? null),
          diagnostics: await page.evaluate(() => window.__canvas?.diagnostics?.() ?? null),
        };
    } catch {
      // page may be closed
    }
  } finally {
    try {
      if (page) await page.evaluate(() => window.__canvas?.destroyAll?.()).catch(() => {});
    } catch {
      // best effort
    }
    if (chrome) await chrome.close().catch(() => {});
    if (server) await server.close().catch(() => {});
    if (harness) await harness.cleanup().catch(() => {});
    evidence.finishedAt = new Date().toISOString();
    evidence.elapsedMs = Date.now() - startedAt;
    evidence.checks = evidence.checks.length ? evidence.checks : checks;
    evidence.summary = {
      total: evidence.checks.length,
      passed: evidence.checks.filter((entry) => entry.ok).length,
      failed: evidence.checks.filter((entry) => !entry.ok).length,
      evidence: "evidence/canvas-evidence.json",
    };
    // Keep committed evidence free of machine-specific absolute paths.
    const sanitized = JSON.parse(
      JSON.stringify(evidence)
        .replaceAll(REPO_ROOT, "<repo>")
        .replaceAll(SPIKE_ROOT, "<spike>")
        .replaceAll(resolve(args.out), "<evidence>"),
    );
    await writeFile(
      resolve(args.out, "canvas-evidence.json"),
      JSON.stringify(sanitized, null, 2) + "\n",
    );
    console.log(
      JSON.stringify({
        summary: evidence.summary,
        failures: evidence.failures.map((failure) => failure.split("\n")[0]),
        evidence: resolve(args.out, "canvas-evidence.json"),
      }),
    );
  }
}

main();
