#!/usr/bin/env node
// BUG-001 evidence: reproduce the old MP4 bottom black band on the same
// revision that the fixed worker now renders fully. Produces committed PNGs and
// JSON under spikes/editor-canvas/evidence/bug-001/ without touching the old
// P3-006-B evidence (which still records the original failure).
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFile, cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { base, client, managed, waitJob } from "../../../packages/video-engine-worker/test/helpers.mjs";
import { decodePng, diffImages } from "../../../packages/video-engine-worker/test/png-decode.mjs";
import { buildDocumentHtml, defaultScene } from "../../../packages/video-engine-worker/src/scenes.mjs";
import { REPO_ROOT, SPIKE_ROOT } from "./lib/worker-harness.mjs";

const execFileAsync = promisify(execFile);
const OUT = resolve(SPIKE_ROOT, "evidence", "bug-001");
const CLI = resolve(REPO_ROOT, "packages/video-engine-worker/node_modules/hyperframes/dist/cli.js");
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const SCENE_COLOR = [29, 78, 216];
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

function cliEnv(temp) {
  return {
    ...process.env,
    TMPDIR: resolve(temp, "tmp"),
    HYPERFRAMES_BROWSER_PATH: CHROME,
    PRODUCER_BROWSER_GPU_MODE: "software",
    HYPERFRAMES_NO_TELEMETRY: "1",
    DO_NOT_TRACK: "1",
    HEYGEN_CONFIG_DIR: resolve(temp, "auth"),
    XDG_STATE_HOME: resolve(temp, "state"),
    HYPERFRAMES_FONT_CACHE_DIR: resolve(temp, "fonts"),
    HYPERFRAMES_EXTRACT_CACHE_DIR: "off",
  };
}

async function renderWithCli(projectDir, outPath) {
  const temp = await mkdtemp(resolve(tmpdir(), "bug001-before-"));
  await mkdir(resolve(temp, "tmp"), { recursive: true });
  const started = Date.now();
  try {
    await execFileAsync(
      process.execPath,
      [CLI, "render", projectDir, "-c", "index.html", "-o", outPath, "--fps", "30", "--format", "mp4", "--quality", "standard", "--workers", "1", "--no-browser-gpu"],
      { env: cliEnv(temp), cwd: resolve(REPO_ROOT, "packages/video-engine-worker"), maxBuffer: 64 * 1024 * 1024 },
    );
    return { elapsedMs: Date.now() - started };
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}

async function renderWithWorker(f, projectId, revision, outDir, label) {
  const started = Date.now();
  const job = await f.c.call("render", { projectId, revision, timeoutMs: 120000 });
  const done = await waitJob(f.c, job.result.jobId);
  const elapsedMs = Date.now() - started;
  if (done.state !== "succeeded") throw new Error(`worker render ${label}: ${JSON.stringify(done)}`);
  return {
    elapsedMs,
    mp4: resolve(f.outputRoot, done.artifact.name),
    metadata: done.artifact.metadata,
  };
}

async function extractFrame(mp4, time, outPath) {
  await execFileAsync("ffmpeg", ["-y", "-v", "error", "-ss", String(time), "-i", mp4, "-frames:v", "1", outPath]);
  return readFile(outPath);
}

function bottomBlackRows(image) {
  const { width, height, channels, data } = image;
  let rows = 0;
  for (let y = height - 1; y >= 0; y--) {
    let black = true;
    for (let x = 0; x < width; x += 4) {
      const i = (y * width + x) * channels;
      if (data[i] > 8 || data[i + 1] > 8 || data[i + 2] > 8) {
        black = false;
        break;
      }
    }
    if (!black) break;
    rows += 1;
  }
  return rows;
}

function bottomColor(image) {
  const { width, height, channels, data } = image;
  const i = ((height - 4) * width + Math.floor(width / 2)) * channels;
  return [data[i], data[i + 1], data[i + 2]];
}

function colorDistance(left, right) {
  return Math.max(...left.map((value, index) => Math.abs(value - right[index])));
}

async function captureSet(f, projectId, revision, times, label) {
  const frames = {};
  for (const time of times) {
    const frame = await f.c.call("frame", { projectId, revision, time, timeoutMs: 120000 });
    const done = await waitJob(f.c, frame.result.jobId);
    if (done.state !== "succeeded") throw new Error(`worker frame ${label} ${time}: ${JSON.stringify(done)}`);
    const path = resolve(OUT, `worker-${label}-${time}s.png`);
    const bytes = await readFile(resolve(f.outputRoot, done.artifact.name));
    await writeFile(path, bytes);
    frames[time] = { path, sha256: sha256(bytes), image: decodePng(bytes) };
  }
  return frames;
}

async function runManagedProject(managedFixture, projectTitle, overrides, times, label, evidence) {
  const f = managedFixture;
  const created = await f.c.call("project.create", {
    templateId: "product-launch-v1",
    title: projectTitle,
    assets: [{ inboxName: "logo.png", name: "logo.png" }],
  });
  const projectId = created.result.projectId;
  let revision = created.result.revision;
  const scene = await f.c.call("scene.update", {
    projectId,
    expectedRevision: revision,
    operationId: `${label}-scene`,
    sceneId: "scene-1",
    template: { title: projectTitle, duration: 5, subtitle: "副标题", badge: "AI", logo: "assets/logo.png" },
  });
  revision = scene.result.revision;
  if (overrides) {
    const edit = await f.c.call("edit", {
      projectId,
      expectedRevision: revision,
      operationId: `${label}-layout`,
      ops: overrides,
    });
    revision = edit.result.revision;
  }
  const beforeProjectDir = resolve(f.dir, `before-project-${label}`);
  await cp(resolve(f.projectsRoot, projectId), beforeProjectDir, { recursive: true });

  const workerFrames = await captureSet(f, projectId, revision, times, label);

  // Old behavior: same revision HTML and render options, but static-frame
  // dedup left at its default (the fix only changes the worker render env).
  const beforeMp4 = resolve(OUT, `before-${label}.mp4`);
  const beforeRender = await renderWithCli(beforeProjectDir, beforeMp4);
  const afterRender = await renderWithWorker(f, projectId, revision, OUT, label);
  const afterMp4 = resolve(OUT, `after-${label}.mp4`);
  await copyFile(afterRender.mp4, afterMp4);

  evidence.projects[label] = {
    projectId,
    revision,
    duration: 5,
    before: { mp4: beforeMp4, elapsedMs: beforeRender.elapsedMs },
    after: { mp4: afterMp4, elapsedMs: afterRender.elapsedMs, metadata: afterRender.metadata },
    times: {},
  };
  for (const time of times) {
    const beforeBytes = await extractFrame(beforeMp4, time, resolve(OUT, `before-${label}-${time}s.png`));
    const afterBytes = await extractFrame(afterMp4, time, resolve(OUT, `after-${label}-${time}s.png`));
    const before = decodePng(beforeBytes);
    const after = decodePng(afterBytes);
    const worker = workerFrames[time].image;
    const beforeDiff = diffImages(worker, before, 24);
    const afterDiff = diffImages(worker, after, 24);
    evidence.projects[label].times[time] = {
      workerFrame: `worker-${label}-${time}s.png`,
      before: {
        file: `before-${label}-${time}s.png`,
        bottomBlackRows: bottomBlackRows(before),
        bottomColor: bottomColor(before),
        bottomColorDistanceToScene: colorDistance(bottomColor(before), SCENE_COLOR),
        diffVsWorker: { changedPct: beforeDiff.changedPct, mae: beforeDiff.mae },
      },
      after: {
        file: `after-${label}-${time}s.png`,
        bottomBlackRows: bottomBlackRows(after),
        bottomColor: bottomColor(after),
        bottomColorDistanceToScene: colorDistance(bottomColor(after), SCENE_COLOR),
        diffVsWorker: { changedPct: afterDiff.changedPct, mae: afterDiff.mae },
      },
    };
  }
  return revision;
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const evidence = {
    kind: "bug-001-render-bottom-band",
    startedAt: new Date().toISOString(),
    engine: null,
    rootCause: {
      summary:
        "HyperFrames static-frame-dedup opens a second verification page; after it closes the primary capture page loses its page.setViewport(1280x720) device-metrics override (window.innerHeight: 720 -> 633), while captureBeyondViewport had already been downgraded to false because the document scrollHeight fits 720. CDP then paints only 633 viewport rows; the remaining 87 rows are black.",
      observations: [
        "worker snapshot/frame path has no static-dedup page and always rendered the full 720p frame",
        "first static-dedup verification captures reported innerHeight 720 and were full",
        "after verification, streaming captures reported viewport 1280x720 but innerHeight 633 and were black from y=633/634",
        "HF_STATIC_DEDUP=false removes the second page and the band; forcing captureBeyondViewport also removes it",
        "upstream version 0.8.167, node_modules not modified",
      ],
      adapterFix:
        "worker render job env sets HF_STATIC_DEDUP=false (render only; frame/snapshot unchanged). Same revision/HTML, full 720p composition, no crop/stretch/fill. Performance tradeoff recorded below.",
    },
    oldEvidence: "spikes/editor-canvas/evidence/p3-006b/rendered-1.5s.png (86 black rows) preserved unchanged",
    projects: {},
    ratio: {},
    failures: [],
  };
  const f = await managed("bug001-evidence");
  try {
    const workerPkg = JSON.parse(await readFile(resolve(REPO_ROOT, "packages/video-engine-worker/package.json"), "utf8"));
    evidence.engine = { worker: `${workerPkg.name}@${workerPkg.version}`, tools: { node: process.version, chromePath: CHROME } };
    // Baseline without manual layout, then a bottom logo + style edit.
    await runManagedProject(f, "BUG-001 基线", null, [0.5, 1.5], "baseline", evidence);
    await runManagedProject(
      f,
      "BUG-001 人工布局",
      [
        { type: "layout", target: "scene-1-logo", unit: "composition-px", box: { left: 900, top: 580, width: 200, height: 120 } },
        { type: "style", target: "scene-1-title", styles: { color: "#ff0000" } },
        { type: "layout", target: "scene-1-title", unit: "composition-px", box: { left: 120, top: 220, width: 700 } },
      ],
      [0.5, 1.5],
      "edited",
      evidence,
    );

    // 4:3 static project (960x720) through the same render path.
    const ratioDir = await mkdtemp(resolve(SPIKE_ROOT, "artifacts/bug001-ratio-"));
    try {
      const scenes = [{ ...defaultScene(0), duration: 5, title: "4:3 画布", subtitle: "底部背景", badge: "4:3", color: "#1d4ed8", accent: "#bfdbfe" }];
      await mkdir(resolve(ratioDir, "project/assets"), { recursive: true });
      await writeFile(resolve(ratioDir, "project/index.html"), buildDocumentHtml({ width: 960, height: 720, scenes }));
      await copyFile(resolve(base, "node_modules/gsap/dist/gsap.min.js"), resolve(ratioDir, "project/assets/gsap.min.js"));
      await writeFile(resolve(ratioDir, "project/project.json"), JSON.stringify({ entry: "index.html", assets: ["assets/gsap.min.js"] }));
      const configPath = resolve(ratioDir, "registry.json");
      await writeFile(configPath, JSON.stringify({ root: ratioDir, projects: { ratio: resolve(ratioDir, "project") }, outputRoot: resolve(ratioDir, "output") }));
      const ratioClient = client(configPath);
      try {
        const opened = await ratioClient.call("open", { projectId: "ratio" });
        const ratioF = { c: ratioClient, outputRoot: resolve(ratioDir, "output"), dir: ratioDir };
        const times = [0.5, 1.5];
        const workerFrames = {};
        for (const time of times) {
          const frame = await ratioClient.call("frame", { projectId: "ratio", revision: opened.result.revision, time, timeoutMs: 120000 });
          const done = await waitJob(ratioClient, frame.result.jobId);
          const bytes = await readFile(resolve(ratioF.outputRoot, done.artifact.name));
          await writeFile(resolve(OUT, `worker-ratio-${time}s.png`), bytes);
          workerFrames[time] = decodePng(bytes);
        }
        const after = await renderWithWorker(ratioF, "ratio", opened.result.revision, OUT, "ratio");
        const afterMp4 = resolve(OUT, "after-ratio.mp4");
        await copyFile(after.mp4, afterMp4);
        const beforeProjectDir = resolve(ratioDir, "before-project");
        await cp(resolve(ratioDir, "project"), beforeProjectDir, { recursive: true });
        const beforeMp4 = resolve(OUT, "before-ratio.mp4");
        const beforeRender = await renderWithCli(beforeProjectDir, beforeMp4);
        evidence.ratio = { width: 960, height: 720, beforeElapsedMs: beforeRender.elapsedMs, afterElapsedMs: after.elapsedMs, metadata: after.metadata, times: {} };
        for (const time of times) {
          const beforeBytes = await extractFrame(beforeMp4, time, resolve(OUT, `before-ratio-${time}s.png`));
          const afterBytes = await extractFrame(afterMp4, time, resolve(OUT, `after-ratio-${time}s.png`));
          const before = decodePng(beforeBytes);
          const afterImage = decodePng(afterBytes);
          evidence.ratio.times[time] = {
            before: { file: `before-ratio-${time}s.png`, bottomBlackRows: bottomBlackRows(before) },
            after: {
              file: `after-ratio-${time}s.png`,
              bottomBlackRows: bottomBlackRows(afterImage),
              diffVsWorker: (() => {
                const diff = diffImages(workerFrames[time], afterImage, 24);
                return { changedPct: diff.changedPct, mae: diff.mae };
              })(),
            },
          };
        }
      } finally {
        await ratioClient.stop();
      }
    } finally {
      await rm(ratioDir, { recursive: true, force: true });
    }
    evidence.summary = {
      baselineBeforeBlackRows: evidence.projects.baseline.times[1.5].before.bottomBlackRows,
      baselineAfterBlackRows: evidence.projects.baseline.times[1.5].after.bottomBlackRows,
      editedAfterBlackRows: evidence.projects.edited.times[1.5].after.bottomBlackRows,
      editedBottomColorDistance: evidence.projects.edited.times[1.5].after.bottomColorDistanceToScene,
      afterDiffVsWorkerPct: evidence.projects.edited.times[1.5].after.diffVsWorker.changedPct,
      ratioBeforeBlackRows: evidence.ratio.times[1.5].before.bottomBlackRows,
      ratioAfterBlackRows: evidence.ratio.times[1.5].after.bottomBlackRows,
    };
  } catch (error) {
    evidence.failures.push(String(error?.stack ?? error));
    process.exitCode = 1;
  } finally {
    await f.cleanup().catch(() => {});
    evidence.finishedAt = new Date().toISOString();
    const sanitized = JSON.parse(
      JSON.stringify(evidence).replaceAll(REPO_ROOT, "<repo>").replaceAll(SPIKE_ROOT, "<spike>").replaceAll(OUT, "<evidence>"),
    );
    sanitized.evidenceFile = "evidence/bug-001/render-band-evidence.json";
    await writeFile(resolve(OUT, "render-band-evidence.json"), JSON.stringify(sanitized, null, 2) + "\n");
    console.log(JSON.stringify({ summary: evidence.summary, failures: evidence.failures.map((entry) => entry.split("\n")[0]), evidence: resolve(OUT, "render-band-evidence.json") }));
  }
}

main();
