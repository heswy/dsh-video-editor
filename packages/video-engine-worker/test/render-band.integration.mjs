import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { copyFile, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { base, client, managed, waitJob } from "./helpers.mjs";
import { buildDocumentHtml, defaultScene } from "../src/scenes.mjs";
import { decodePng, diffImages, pixelBBox } from "./png-decode.mjs";

const SCENE_COLOR = "#1d4ed8";
const TOLERANCE = 24;

function nearColor(image, x, y, target, tolerance = 14) {
  const { data, channels } = image;
  const index = (y * image.width + x) * channels;
  return (
    Math.abs(data[index] - target[0]) <= tolerance &&
    Math.abs(data[index + 1] - target[1]) <= tolerance &&
    Math.abs(data[index + 2] - target[2]) <= tolerance
  );
}

function rgb(hex) {
  return [1, 3, 5].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16));
}

function bottomBlackRows(image) {
  const { width, height, channels, data } = image;
  let rows = 0;
  for (let y = height - 1; y >= 0; y--) {
    let black = true;
    for (let x = 0; x < width; x += 4) {
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

function regionDiff(left, right, fromY, toY) {
  const { width, channels } = left;
  let changed = 0;
  let total = 0;
  for (let y = fromY; y < toY; y++) {
    for (let x = 0; x < width; x++) {
      const li = (y * width + x) * channels;
      const ri = (y * width + x) * right.channels;
      const delta = Math.max(
        Math.abs(left.data[li] - right.data[ri]),
        Math.abs(left.data[li + 1] - right.data[ri + 1]),
        Math.abs(left.data[li + 2] - right.data[ri + 2]),
      );
      if (delta > TOLERANCE) changed += 1;
      total += 1;
    }
  }
  return changed / total;
}

async function renderAndDecodeFrames(f, projectId, revision, times, label) {
  const render = await f.c.call("render", { projectId, revision, timeoutMs: 120000 });
  assert.equal(render.ok, true, JSON.stringify(render));
  const rendered = await waitJob(f.c, render.result.jobId);
  assert.equal(rendered.state, "succeeded", JSON.stringify(rendered));
  const metadata = rendered.artifact.metadata;
  assert.equal(metadata.codec_name, "h264", label);
  assert.equal(metadata.r_frame_rate, "30/1", label);
  assert.equal(Number(metadata.nb_read_frames), Math.round(metadata.duration * 30), label);
  assert.ok(Math.abs(metadata.duration - 3) <= 1 / 30, `${label} duration ${metadata.duration}`);
  const mp4 = resolve(f.outputRoot, rendered.artifact.name);
  const frames = {};
  for (const time of times) {
    const frame = await f.c.call("frame", { projectId, revision, time, timeoutMs: 120000 });
    const frameDone = await waitJob(f.c, frame.result.jobId);
    assert.equal(frameDone.state, "succeeded", JSON.stringify(frameDone));
    const framePath = resolve(f.outputRoot, frameDone.artifact.name);
    const extractedPath = resolve(f.dir, `mp4-${label}-${time}s.png`);
    execFileSync("ffmpeg", ["-y", "-v", "error", "-ss", String(time), "-i", mp4, "-frames:v", "1", extractedPath]);
    frames[time] = {
      worker: decodePng(await readFile(framePath)),
      mp4: decodePng(await readFile(extractedPath)),
    };
  }
  return { metadata: rendered.artifact.metadata, mp4, frames };
}

function assertFullFrameComposition(result, label, expectedWidth, expectedHeight) {
  const background = rgb(SCENE_COLOR);
  for (const time of Object.keys(result.frames)) {
    const { worker, mp4 } = result.frames[time];
    assert.equal(mp4.width, expectedWidth, `${label} ${time}s mp4 width`);
    assert.equal(mp4.height, expectedHeight, `${label} ${time}s mp4 height`);
    // The colored full-bleed background must reach the bottom of the frame;
    // this is exactly the region the old renderer clipped to black.
    assert.equal(bottomBlackRows(mp4), 0, `${label} ${time}s mp4 has a bottom black band`);
    assert.ok(
      nearColor(mp4, Math.floor(expectedWidth / 2), expectedHeight - 4, background),
      `${label} ${time}s mp4 bottom background is not the scene color`,
    );
    assert.ok(
      nearColor(worker, Math.floor(expectedWidth / 2), expectedHeight - 4, background),
      `${label} ${time}s worker frame bottom background is not the scene color`,
    );
    const diff = diffImages(worker, mp4, TOLERANCE);
    assert.ok(diff.changedPct <= 0.02, `${label} ${time}s mp4/worker differ too much: ${JSON.stringify(diff)}`);
    const bottomBandDiff = regionDiff(worker, mp4, expectedHeight - 90, expectedHeight);
    assert.ok(
      bottomBandDiff <= 0.02,
      `${label} ${time}s bottom band differs from worker frame: ${bottomBandDiff}`,
    );
  }
}

test("render keeps the full 720p composition for baseline, edited layout and a 4:3 project", async () => {
  const f = await managed("render-band");
  const times = [0.5, 1.5];
  try {
    // Baseline project: no manual layout/style overrides.
    const created = await f.c.call("project.create", {
      templateId: "product-launch-v1",
      title: "BUG-001 baseline",
      assets: [{ inboxName: "logo.png", name: "logo.png" }],
    });
    assert.equal(created.ok, true, JSON.stringify(created));
    const baselineId = created.result.projectId;
    const scene = await f.c.call("scene.update", {
      projectId: baselineId,
      expectedRevision: created.result.revision,
      operationId: "band-baseline-scene",
      sceneId: "scene-1",
      template: {
        title: "底部黑带基线",
        duration: 3,
        subtitle: "副标题",
        badge: "AI",
        logo: "assets/logo.png",
      },
    });
    assert.equal(scene.ok, true, JSON.stringify(scene));
    const baseline = await renderAndDecodeFrames(f, baselineId, scene.result.revision, times, "baseline");
    assertFullFrameComposition(baseline, "baseline", 1280, 720);

    // Manual-layout project: bottom logo proves rows below the old 634px edge
    // still contain rendered composition, not black padding.
    const modified = await f.c.call("project.create", {
      templateId: "product-launch-v1",
      title: "BUG-001 edited",
      assets: [{ inboxName: "logo.png", name: "logo.png" }],
    });
    const modifiedId = modified.result.projectId;
    const scene2 = await f.c.call("scene.update", {
      projectId: modifiedId,
      expectedRevision: modified.result.revision,
      operationId: "band-modified-scene",
      sceneId: "scene-1",
      template: {
        title: "底部元素验证",
        duration: 3,
        subtitle: "副标题",
        badge: "AI",
        logo: "assets/logo.png",
      },
    });
    const edit = await f.c.call("edit", {
      projectId: modifiedId,
      expectedRevision: scene2.result.revision,
      operationId: "band-modified-layout",
      ops: [
        { type: "layout", target: "scene-1-logo", unit: "composition-px", box: { left: 900, top: 580, width: 200, height: 120 } },
        { type: "style", target: "scene-1-title", styles: { color: "#ff0000" } },
        { type: "layout", target: "scene-1-title", unit: "composition-px", box: { left: 120, top: 220, width: 700 } },
      ],
    });
    assert.equal(edit.ok, true, JSON.stringify(edit));
    const edited = await renderAndDecodeFrames(f, modifiedId, edit.result.revision, times, "edited");
    assertFullFrameComposition(edited, "edited", 1280, 720);
    for (const time of times) {
      const { worker, mp4 } = edited.frames[time];
      // The red-tinted bottom logo (semi-transparent red asset over the blue
      // scene background) must exist below y=560 in both captures.
      const logoPixels = (image) =>
        pixelBBox(
          image,
          (data, index) => data[index] > 100 && data[index] > data[index + 1] + 25,
        );
      const workerLogo = logoPixels(worker);
      const mp4Logo = logoPixels(mp4);
      assert.ok(workerLogo, `edited ${time}s worker frame lost the bottom logo`);
      assert.ok(mp4Logo, `edited ${time}s mp4 lost the bottom logo`);
      assert.ok(workerLogo.maxY > 560, `edited ${time}s worker logo not at the bottom`);
      assert.ok(mp4Logo.maxY > 560, `edited ${time}s mp4 logo not at the bottom`);
      assert.ok(
        Math.abs(mp4Logo.minY - workerLogo.minY) <= 8 &&
          Math.abs(mp4Logo.minX - workerLogo.minX) <= 8,
        `edited ${time}s bottom logo position differs: worker=${JSON.stringify(workerLogo)} mp4=${JSON.stringify(mp4Logo)}`,
      );
    }

    // Another supported canvas ratio: static 4:3 project (960x720), rendered
    // through the same worker render path and compared with its worker frames.
    const ratioDir = await mkdtemp(resolve(base, "artifacts/render-band-ratio-"));
    try {
      const scenes = [
        {
          ...defaultScene(0),
          duration: 3,
          title: "4:3 画布验证",
          subtitle: "底部背景应完整",
          badge: "4:3",
          color: SCENE_COLOR,
          accent: "#bfdbfe",
        },
      ];
      await mkdir(resolve(ratioDir, "project/assets"), { recursive: true });
      await writeFile(
        resolve(ratioDir, "project/index.html"),
        buildDocumentHtml({ width: 960, height: 720, scenes }),
      );
      await copyFile(
        resolve(base, "node_modules/gsap/dist/gsap.min.js"),
        resolve(ratioDir, "project/assets/gsap.min.js"),
      );
      await writeFile(
        resolve(ratioDir, "project/project.json"),
        JSON.stringify({ entry: "index.html", assets: ["assets/gsap.min.js"] }),
      );
      const configPath = resolve(ratioDir, "registry.json");
      await writeFile(
        configPath,
        JSON.stringify({
          root: ratioDir,
          projects: { ratio: resolve(ratioDir, "project") },
          outputRoot: resolve(ratioDir, "output"),
        }),
      );
      const ratioClient = client(configPath);
      const ratioF = { c: ratioClient, outputRoot: resolve(ratioDir, "output"), dir: ratioDir };
      try {
        const opened = await ratioClient.call("open", { projectId: "ratio" });
        assert.equal(opened.ok, true, JSON.stringify(opened));
        const ratio = await renderAndDecodeFrames(ratioF, "ratio", opened.result.revision, times, "ratio");
        assertFullFrameComposition(ratio, "ratio", 960, 720);
      } finally {
        await ratioClient.stop();
      }
    } finally {
      await rm(ratioDir, { recursive: true, force: true });
    }
  } finally {
    await f.cleanup();
  }
});
