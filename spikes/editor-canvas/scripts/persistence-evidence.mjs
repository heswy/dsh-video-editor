#!/usr/bin/env node
// P3-006-B real-engine persistence evidence: layout/style edits through the
// shared worker are visible in worker frames and the exported MP4, survive
// scene regeneration and undo/redo, and merge with AI text changes.
//
// Output goes to spikes/editor-canvas/evidence/p3-006b/ (never overwrites the
// 0.2.1 canvas evidence). Uses the shipped 0.3.0 worker/client only.
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { CanvasHarness, REPO_ROOT, SPIKE_ROOT } from "./lib/worker-harness.mjs";

const OUT = resolve(SPIKE_ROOT, "evidence", "p3-006b");
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const {
  decodePng,
  diffImages,
  redTextBBox,
} = await import(
  pathToFileURL(resolve(REPO_ROOT, "packages/video-engine-worker/test/png-decode.mjs")).href
);

const check = (condition, message) => {
  if (!condition) throw new Error(message);
};

// Pre-existing managed-template renderer/template issue observed during
// P3-006-B review: the MP4 has a bottom black band while worker frames do not.
// Record it explicitly instead of claiming full-frame parity.
function bottomBlackRows(image) {
  const { width, height, channels, data } = image;
  let rows = 0;
  for (let y = height - 1; y >= 0; y--) {
    let black = true;
    for (let x = 0; x < width; x++) {
      const index = (y * width + x) * channels;
      if (data[index] > 8 || data[index + 1] > 8 || data[index + 2] > 8) {
        black = false;
        break;
      }
    }
    if (!black) break;
    rows += 1;
  }
  return rows;
}

async function waitJob(client, jobId) {
  for (let attempt = 0; attempt < 1200; attempt++) {
    const view = await client.status(jobId);
    if (["succeeded", "failed", "cancelled", "timed_out"].includes(view.state))
      return view;
    await new Promise((wait) => setTimeout(wait, 100));
  }
  throw new Error("job timeout");
}

async function framePng(harness, revision, time) {
  const job = await harness.client.frame({
    projectId: harness.project.projectId,
    revision,
    time,
    timeoutMs: 120000,
  });
  const done = await waitJob(harness.client, job.jobId);
  check(done.state === "succeeded", `frame ${time}s failed: ${JSON.stringify(done.error)}`);
  return readFile(resolve(harness.outputRoot, done.artifact.name));
}

async function inspect(harness) {
  return harness.inspect();
}

function element(inspected, stableId) {
  return inspected.elements.find((entry) => entry.stableId === stableId);
}

async function main() {
  await mkdir(OUT, { recursive: true });
  await mkdir(resolve(SPIKE_ROOT, "artifacts"), { recursive: true });
  const evidence = {
    kind: "p3-006b-persistence-evidence",
    startedAt: new Date().toISOString(),
    independence:
      "real worker/client + Chrome frames + FFmpeg render; not a mocked canvas",
    engine: null,
    frames: {},
    render: {},
    sceneRegeneration: {},
    merge: {},
    history: {},
    failures: [],
  };
  const harness = new CanvasHarness({
    runDir: await mkdtemp(resolve(SPIKE_ROOT, "artifacts", "p3-006b-evidence-")),
  });
  try {
    await harness.initialize();
    await harness.createProject();
    let inspected = await inspect(harness);
    const scene = await harness.client.sceneUpdate({
      projectId: harness.project.projectId,
      expectedRevision: inspected.revision,
      operationId: "evidence-scene",
      sceneId: "scene-1",
      template: {
        title: "布局持久化验证",
        duration: 5,
        subtitle: "副标题",
        badge: "AI",
        logo: "assets/logo.png",
      },
    });
    inspected = await inspect(harness);
    const evidenceEngine = JSON.parse(
      await readFile(resolve(REPO_ROOT, "packages/video-engine-worker/package.json"), "utf8"),
    );
    evidence.engine = {
      worker: `${evidenceEngine.name}@${evidenceEngine.version}`,
      client: JSON.parse(
        await readFile(
          resolve(REPO_ROOT, "packages/video-engine-client/package.json"),
          "utf8",
        ),
      ).version,
      versions: harness.doctor,
    };
    let revision = scene.revision;
    const times = [0.5, 1.5];
    evidence.frames.before = {};
    for (const time of times) {
      const bytes = await framePng(harness, revision, time);
      await writeFile(resolve(OUT, `frame-before-${time}s.png`), bytes);
      evidence.frames.before[time] = {
        sha256: sha256(bytes),
        ...(() => {
          const image = decodePng(bytes);
          return { width: image.width, height: image.height };
        })(),
      };
    }

    const edit = await harness.client.edit({
      projectId: harness.project.projectId,
      expectedRevision: revision,
      operationId: "evidence-layout-style",
      ops: [
        { type: "text", target: "scene-1-title", text: "人工布局标题" },
        {
          type: "layout",
          target: "scene-1-title",
          unit: "composition-px",
          box: { left: 400, top: 196, width: 700 },
        },
        {
          type: "style",
          target: "scene-1-title",
          styles: { color: "#ff0000", fontSize: 96, fontWeight: 700, textAlign: "left" },
        },
        {
          type: "layout",
          target: "scene-1-logo",
          unit: "composition-px",
          box: { left: 900, top: 300, width: 240, height: 240 },
        },
      ],
    });
    revision = edit.revision;
    inspected = await inspect(harness);
    const title = element(inspected, "scene-1-title");
    const logo = element(inspected, "scene-1-logo");
    evidence.frames.after = {};
    const decodedAfter = {};
    for (const time of times) {
      const bytes = await framePng(harness, revision, time);
      await writeFile(resolve(OUT, `frame-after-${time}s.png`), bytes);
      const image = decodePng(bytes);
      decodedAfter[time] = image;
      evidence.frames.after[time] = {
        sha256: sha256(bytes),
        width: image.width,
        height: image.height,
      };
    }
    evidence.inspectAfterEdit = {
      revision,
      title: { text: title.text, layout: title.layout, style: title.style },
      logo: { layout: logo.layout },
    };

    // Pixel checks: visual change, static base x stable across animation times,
    // relative intro y still animating (base not baked with transform).
    evidence.frames.comparison = {};
    const baseX = [];
    for (const time of times) {
      const before = decodePng(await readFile(resolve(OUT, `frame-before-${time}s.png`)));
      const after = decodedAfter[time];
      const diff = diffImages(before, after);
      check(diff.changedPct > 0.003, `frame ${time}s did not change`);
      check(diff.bbox.minX < 150 && diff.bbox.maxX > 500, `unexpected diff region ${JSON.stringify(diff.bbox)}`);
      const red = redTextBBox(after);
      check(red && red.minX > 380 && red.minX < 520, `red title not at base left 400: ${JSON.stringify(red)}`);
      baseX.push(red.minX);
      evidence.frames.comparison[time] = {
        diff: { changedPct: diff.changedPct, mae: diff.mae, bbox: diff.bbox },
        redTitleBBox: red,
      };
    }
    check(Math.abs(baseX[0] - baseX[1]) <= 6, `base x moved across animation times: ${baseX}`);
    const earlyY = evidence.frames.comparison[0.5].redTitleBBox.minY;
    const settledY = evidence.frames.comparison[1.5].redTitleBBox.minY;
    check(earlyY > settledY + 2, `intro y animation was baked into the base (early ${earlyY}, settled ${settledY})`);
    evidence.frames.animationTransform = {
      baseXStableAcrossTimes: baseX,
      earlyMinY: earlyY,
      settledMinY: settledY,
      note: "static left is stable; the GSAP intro y offset remains a relative animation",
    };

    // Export still contains the persisted layout/style.
    const renderDuration = (await inspect(harness)).duration;
    const render = await harness.client.render({
      projectId: harness.project.projectId,
      revision,
      timeoutMs: 120000,
    });
    const rendered = await waitJob(harness.client, render.jobId);
    check(rendered.state === "succeeded", `render failed: ${JSON.stringify(rendered.error)}`);
    const mp4Path = resolve(harness.outputRoot, rendered.artifact.name);
    const mp4Bytes = await readFile(mp4Path);
    const probe = JSON.parse(
      execFileSync(
        "ffprobe",
        [
          "-v",
          "error",
          "-count_frames",
          "-select_streams",
          "v:0",
          "-show_entries",
          "stream=codec_name,width,height,r_frame_rate,nb_read_frames:format=duration",
          "-of",
          "json",
          mp4Path,
        ],
        { encoding: "utf8" },
      ),
    );
    const stream = probe.streams[0];
    check(stream.codec_name === "h264", "render is not H.264");
    check(stream.width === 1280 && stream.height === 720, "render size changed");
    check(stream.r_frame_rate === "30/1", "render fps changed");
    check(
      Number(stream.nb_read_frames) === Math.round(renderDuration * 30),
      `unexpected frame count ${stream.nb_read_frames} for ${renderDuration}s`,
    );
    check(
      Math.abs(Number(probe.format.duration) - renderDuration) <= 1 / 30,
      "render duration changed",
    );
    const renderedFramePath = resolve(OUT, "rendered-1.5s.png");
    execFileSync("ffmpeg", [
      "-y",
      "-v",
      "error",
      "-ss",
      "1.5",
      "-i",
      mp4Path,
      "-frames:v",
      "1",
      renderedFramePath,
    ]);
    const renderedImage = decodePng(await readFile(renderedFramePath));
    const renderedRed = redTextBBox(renderedImage);
    const workerImage = decodedAfter[1.5];
    const renderedBottomBlackRows = bottomBlackRows(renderedImage);
    const workerBottomBlackRows = bottomBlackRows(workerImage);
    check(renderedRed && renderedRed.count > 200, "rendered frame misses the red title");
    check(
      Math.abs(renderedRed.minX - evidence.frames.comparison[1.5].redTitleBBox.minX) <= 24,
      `rendered title x differs from worker frame: ${renderedRed.minX}`,
    );
    evidence.render = {
      mp4Sha256: sha256(mp4Bytes),
      mp4Bytes: mp4Bytes.length,
      ffprobe: {
        codec: stream.codec_name,
        width: stream.width,
        height: stream.height,
        fps: stream.r_frame_rate,
        frames: Number(stream.nb_read_frames),
        duration: Number(probe.format.duration),
      },
      renderedFrame: {
        file: "rendered-1.5s.png",
        redTitleBBox: renderedRed,
        workerFrameRedTitleBBox: evidence.frames.comparison[1.5].redTitleBBox,
        renderedBottomBlackRows,
        workerBottomBlackRows,
        knownIssue:
          renderedBottomBlackRows > 0
            ? `pre-existing renderer/template bottom crop (${renderedBottomBlackRows}px at 720p); worker frames have ${workerBottomBlackRows}px; unrelated to layout/style persistence, needs its own ticket`
            : null,
        note: "the rendered title base x matches the worker frame; full-frame parity is NOT claimed because of the pre-existing bottom band",
      },
    };

    // scene.update (rename + duration) keeps manual layout/style.
    const updated = await harness.client.sceneUpdate({
      projectId: harness.project.projectId,
      expectedRevision: revision,
      operationId: "evidence-scene-update",
      sceneId: "scene-1",
      template: {
        title: "改名后仍然保留布局",
        duration: 6,
        subtitle: "副标题",
        badge: "AI",
        logo: "assets/logo.png",
      },
    });
    inspected = await inspect(harness);
    const updatedTitle = element(inspected, "scene-1-title");
    const updatedLogo = element(inspected, "scene-1-logo");
    check(updatedTitle.layout.left === 400 && updatedTitle.style.color === "#ff0000", "scene.update dropped layout/style");
    check(updatedLogo.layout.width === 240, "scene.update dropped image size");
    evidence.sceneRegeneration = {
      revision: updated.revision,
      title: { text: updatedTitle.text, layout: updatedTitle.layout, style: updatedTitle.style },
      logo: { layout: updatedLogo.layout },
      preserved: true,
    };

    // Human layout + AI text merge, then undo/redo.
    const mergeBase = updated.revision;
    const humanLayout = await harness.client.edit({
      projectId: harness.project.projectId,
      expectedRevision: mergeBase,
      operationId: "evidence-merge-layout",
      ops: [
        { type: "layout", target: "scene-1-title", unit: "composition-px", box: { top: 260 } },
        { type: "style", target: "scene-1-title", styles: { fontSize: 104 } },
      ],
    });
    const merged = await harness.client.projectRevise({
      projectId: harness.project.projectId,
      baseRevision: mergeBase,
      expectedRevision: humanLayout.revision,
      operationId: "evidence-merge",
      sceneId: "scene-1",
      template: {
        title: "AI 续改文案",
        duration: 6,
        subtitle: "副标题",
        badge: "AI",
        logo: "assets/logo.png",
      },
    });
    check(merged.written === true, `merge failed: ${JSON.stringify(merged.conflicts)}`);
    inspected = await inspect(harness);
    const mergedTitle = element(inspected, "scene-1-title");
    check(mergedTitle.text === "AI 续改文案", "AI text was not adopted");
    check(mergedTitle.layout.top === 260 && mergedTitle.layout.left === 400, "human layout was not preserved");
    check(mergedTitle.style.fontSize === 104 && mergedTitle.style.color === "#ff0000", "human style was not preserved");
    evidence.merge = {
      written: true,
      text: mergedTitle.text,
      layout: mergedTitle.layout,
      style: mergedTitle.style,
      stepRevisions: {
        base: mergeBase,
        humanLayout: humanLayout.revision,
        merged: inspected.revision,
      },
    };

    const undo = await harness.client.undo({
      projectId: harness.project.projectId,
      expectedRevision: inspected.revision,
      operationId: "evidence-undo",
    });
    let afterUndo = await inspect(harness);
    const undoTitle = element(afterUndo, "scene-1-title");
    check(undoTitle.text === "改名后仍然保留布局", "undo did not restore the AI-revised text");
    check(undoTitle.layout.top === 260 && undoTitle.layout.left === 400, "undo lost human layout");
    const redo = await harness.client.redo({
      projectId: harness.project.projectId,
      expectedRevision: afterUndo.revision,
      operationId: "evidence-redo",
    });
    let afterRedo = await inspect(harness);
    const redoTitle = element(afterRedo, "scene-1-title");
    check(redoTitle.text === "AI 续改文案", "redo did not restore merged text");
    check(redoTitle.layout.top === 260, "redo lost human layout");
    evidence.history = {
      undoRevision: afterUndo.revision,
      undoTitle: { text: undoTitle.text, layout: undoTitle.layout },
      redoRevision: afterRedo.revision,
      redoTitle: { text: redoTitle.text, layout: redoTitle.layout },
      undoEntryRevision: undo.revision,
      redoEntryRevision: redo.revision,
    };
  } catch (error) {
    evidence.failures.push(String(error?.stack ?? error));
    process.exitCode = 1;
  } finally {
    await harness.cleanup().catch(() => {});
    evidence.finishedAt = new Date().toISOString();
    const sanitized = JSON.parse(
      JSON.stringify(evidence)
        .replaceAll(REPO_ROOT, "<repo>")
        .replaceAll(SPIKE_ROOT, "<spike>")
        .replaceAll(OUT, "<evidence>"),
    );
    sanitized.evidenceFile = "evidence/p3-006b/persistence-evidence.json";
    await writeFile(
      resolve(OUT, "persistence-evidence.json"),
      JSON.stringify(sanitized, null, 2) + "\n",
    );
    console.log(
      JSON.stringify({
        failures: evidence.failures.map((entry) => entry.split("\n")[0]),
        frames: evidence.frames.comparison
          ? Object.fromEntries(
              Object.entries(evidence.frames.comparison).map(([time, value]) => [
                time,
                { changedPct: value.diff.changedPct, redX: value.redTitleBBox.minX },
              ]),
            )
          : null,
        render: evidence.render.ffprobe ?? null,
        merge: evidence.merge.written ?? null,
        evidence: resolve(OUT, "persistence-evidence.json"),
      }),
    );
  }
}

main();
