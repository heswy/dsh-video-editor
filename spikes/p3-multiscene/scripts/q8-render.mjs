import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import {
  artifacts,
  evidenceDir,
  ffprobe,
  resetDir,
  samplePixel,
  sha256,
  writeJson,
} from "./lib/util.mjs";
import { scenesFixture, renderSingleDoc } from "./lib/scene-templates.mjs";
import { generateTestImages, installProjectAssets, LOGO_COLOR, SHOT_COLORS } from "./lib/assets.mjs";
import {
  createClient,
  prepareRuntime,
  waitStatus,
  writeRegistry,
} from "./lib/worker.mjs";

const work = resolve(artifacts, "q8");
await resetDir(work);
const runtime = await prepareRuntime(work);
const { images } = await generateTestImages(resolve(work, "images"));
const scenes = scenesFixture();
const demoDir = resolve(runtime.projectsRoot, "demo");
await mkdir(demoDir, { recursive: true });
const assets = await installProjectAssets(demoDir, images);
await writeFile(resolve(demoDir, "index.html"), renderSingleDoc(scenes));
await writeFile(
  resolve(demoDir, "project.json"),
  JSON.stringify({ entry: "index.html", assets }, null, 2),
);
const registryPath = await writeRegistry(runtime, { demo: demoDir });

const report = {
  generatedAt: new Date().toISOString(),
  node: process.version,
  runtime: {
    node: process.version,
    chrome: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    ffmpeg: execFileSync("ffmpeg", ["-version"], { encoding: "utf8" }).split("\n")[0],
  },
  expected: {
    sceneColors: Object.fromEntries(scenes.map((scene) => [scene.sceneId, scene.color])),
    logoColor: LOGO_COLOR,
    shotColors: SHOT_COLORS,
  },
  frames: {},
  assets: {},
  render: {},
  cancel: {},
  seek: {},
};

function close(a, b, tolerance = 16) {
  return a.every((value, index) => Math.abs(value - b[index]) <= tolerance);
}

async function sampleWorkerFrame(client, revision, time, { label } = {}) {
  const started = performance.now();
  const job = await client.frame({ projectId: "demo", revision, time });
  const done = await waitStatus(client, job.jobId);
  const file = resolve(runtime.outputRoot, done.artifact.name);
  const bytes = await readFile(file);
  return {
    label: label ?? String(time),
    state: done.state,
    jobId: job.jobId,
    ms: Math.round(performance.now() - started),
    file: done.artifact.name,
    bytes: bytes.length,
    sha256: sha256(bytes),
    metadata: done.artifact.metadata,
    background: samplePixel(file, { x: 40, y: 40 }),
    logo: samplePixel(file, { x: 1100, y: 158 }),
    shot: samplePixel(file, { x: 925, y: 505 }),
    time: done.time,
  };
}

const times = [0.5, 3.9, 4, 4.1, 6, 7.9, 8, 8.1, 9.5, 11.9, 12, 12.1, 13.5];
const client = createClient(runtime, registryPath);
try {
  await client.start();
  const opened = await client.open("demo");
  let revision = opened.revision;
  report.open = {
    revision,
    duration: opened.duration,
    width: opened.width,
    height: opened.height,
    fps: 30,
    elementCount: opened.elements.length,
  };

  // Q4: declared assets participate in the revision. Changing logo bytes must
  // change the revision; restoring the bytes restores the content hash.
  const logoPath = resolve(demoDir, "assets", "logo.png");
  const logoBefore = await readFile(logoPath);
  const redLogo = resolve(work, "red-logo.png");
  execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "color=c=#ef4444:s=140x140", "-frames:v", "1", redLogo]);
  await cp(redLogo, logoPath);
  const inspectAfterLogo = await client.inspect("demo");
  await writeFile(logoPath, logoBefore);
  const inspectRestored = await client.inspect("demo");
  report.assets = {
    logoPath: logoPath.replace(work, "<work>"),
    logoBytes: logoBefore.length,
    logoSha256: sha256(logoBefore),
    assetEntries: inspectAfterLogo.files.map((file) => ({
      path: file.path,
      bytes: file.bytes,
      sha256: file.sha256,
    })),
    revisionBefore: revision,
    revisionAfterLogoReplace: inspectAfterLogo.revision,
    revisionRestored: inspectRestored.revision,
    revisionChangedOnAssetBytes: inspectAfterLogo.revision !== revision,
    revisionRestoredAfterRestore: inspectRestored.revision === revision,
    limits: {
      observedMaxDeclaredAssets: inspectAfterLogo.files.length,
      workerLimits: "manifest assets <=64, single file <=64MiB, project <=128MiB (accepted worker)",
      proposal: "PNG/JPEG only, logo <=8MiB, screenshots <=8MiB each, <=16 assets, total <=64MiB",
    },
  };

  for (const time of times)
    report.frames[time] = await sampleWorkerFrame(client, revision, time, {
      label: `frame@${time}`,
    });

  // Q8: 15s H.264 render through the accepted worker.
  const renderStarted = performance.now();
  const renderJob = await client.render({ projectId: "demo", revision });
  const renderDone = await waitStatus(client, renderJob.jobId);
  const mp4 = resolve(runtime.outputRoot, renderDone.artifact.name);
  const mp4Bytes = await readFile(mp4);
  report.render = {
    state: renderDone.state,
    jobId: renderJob.jobId,
    ms: Math.round(performance.now() - renderStarted),
    file: renderDone.artifact.name,
    bytes: mp4Bytes.length,
    sha256: sha256(mp4Bytes),
    metadata: renderDone.artifact.metadata,
    probe: ffprobe(mp4),
    sample: Object.fromEntries(
      [0.5, 2, 3.9, 4.1, 6, 7.9, 8.1, 9.5, 11.9, 12.1, 13.5].map((time) => [
        time,
        {
          background: samplePixel(mp4, { x: 40, y: 40, time }),
          logo: samplePixel(mp4, { x: 1100, y: 158, time }),
          shot: samplePixel(mp4, { x: 925, y: 505, time }),
        },
      ]),
    ),
    note: "ffprobe validates dimensions/fps/duration/frame count; scene colours are sampled from decoded MP4 bytes",
  };
} finally {
  await client.dispose();
}

// Seek consistency: shuffled requests in a fresh worker and reopen after a
// second restart must return byte-identical PNGs for the same revision/time.
const orderedTimes = times;
{
  const shuffledClient = createClient(runtime, registryPath);
  try {
    await shuffledClient.start();
    const opened = await shuffledClient.open("demo");
    const order = [13.5, 0.5, 8.1, 4.1, 12.1, 6, 3.9, 9.5, 12, 7.9, 4, 11.9];
    report.seek.shuffled = {};
    for (const time of order)
      report.seek.shuffled[time] = await sampleWorkerFrame(
        shuffledClient,
        opened.revision,
        time,
        { label: `shuffled@${time}` },
      );
    report.seek.ordered = {};
    for (const time of orderedTimes)
      report.seek.ordered[time] = await sampleWorkerFrame(
        shuffledClient,
        opened.revision,
        time,
        { label: `ordered@${time}` },
      );
  } finally {
    await shuffledClient.dispose();
  }

  const reopenedClient = createClient(runtime, registryPath);
  try {
    await reopenedClient.start();
    const opened = await reopenedClient.open("demo");
    report.seek.reopen = {};
    for (const time of [6, 13.5])
      report.seek.reopen[time] = await sampleWorkerFrame(
        reopenedClient,
        opened.revision,
        time,
        { label: `reopen@${time}` },
      );
  } finally {
    await reopenedClient.dispose();
  }
  report.seek.consistency = {
    shuffledMatchesOrdered: Object.fromEntries(
      Object.keys(report.seek.shuffled).map((time) => [
        time,
        report.seek.shuffled[time].sha256 === report.seek.ordered[time].sha256,
      ]),
    ),
    reopenMatchesOrdered: Object.fromEntries(
      Object.keys(report.seek.reopen).map((time) => [
        time,
        report.seek.reopen[time].sha256 === report.seek.ordered[time].sha256,
      ]),
    ),
  };
}

// Cancel a running render: existing worker semantics must keep it clean and
// leave the client usable.
{
  const client = createClient(runtime, registryPath);
  try {
    await client.start();
    const opened = await client.open("demo");
    const beforeFiles = execFileSync("find", [runtime.outputRoot, "-type", "f"], { encoding: "utf8" }).trim();
    const started = performance.now();
    const job = await client.render({ projectId: "demo", revision: opened.revision });
    await new Promise((resolveWait) => setTimeout(resolveWait, 700));
    const cancelled = await client.cancel(job.jobId);
    const done = await waitStatus(client, job.jobId);
    const afterFiles = execFileSync("find", [runtime.outputRoot, "-type", "f"], { encoding: "utf8" }).trim();
    const usable = await sampleWorkerFrame(client, opened.revision, 2, { label: "after-cancel" });
    report.cancel = {
      jobId: job.jobId,
      cancelAck: cancelled.state,
      finalState: done.state,
      elapsedMs: Math.round(performance.now() - started),
      artifact: done.artifact ?? null,
      outputFilesUnchanged: beforeFiles === afterFiles,
      clientStillUsable: usable.state === "succeeded",
      frameAfterCancel: { sha256: usable.sha256, state: usable.state },
    };
  } finally {
    await client.dispose();
  }
}

await writeJson(resolve(evidenceDir, "q4-assets.json"), {
  generatedAt: report.generatedAt,
  node: report.node,
  assets: report.assets,
});
await writeJson(resolve(evidenceDir, "q8-render.json"), report);
console.log(
  JSON.stringify(
    {
      open: report.open,
      assets: {
        revisionChangedOnAssetBytes: report.assets.revisionChangedOnAssetBytes,
        revisionRestoredAfterRestore: report.assets.revisionRestoredAfterRestore,
        entries: report.assets.assetEntries.length,
      },
      render: {
        state: report.render.state,
        ms: report.render.ms,
        bytes: report.render.bytes,
        sha256: report.render.sha256,
        probe: report.render.probe.streams[0],
        duration: report.render.probe.format.duration,
        colors: Object.fromEntries(
          Object.entries(report.render.sample).map(([time, value]) => [time, value.background.hex]),
        ),
      },
      seek: report.seek.consistency,
      cancel: report.cancel,
    },
    null,
    2,
  ),
);
