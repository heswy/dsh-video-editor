import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { base, managed, waitJob } from "./helpers.mjs";
import { decodePng, diffImages, redTextBBox } from "./png-decode.mjs";

const TEMPLATE = "product-launch-v1";

async function framePng(f, revision, time) {
  const job = await f.c.call("frame", {
    projectId: f.projectId,
    revision,
    time,
    timeoutMs: 120000,
  });
  assert.equal(job.ok, true, JSON.stringify(job));
  const done = await waitJob(f.c, job.result.jobId);
  assert.equal(done.state, "succeeded", JSON.stringify(done));
  return readFile(resolve(f.outputRoot, done.artifact.name));
}

test("layout/style changes are visible in worker frames and MP4 while animation transforms stay relative", async () => {
  const f = await managed("layout-real");
  const artifacts = await mkdtemp(resolve(base, "artifacts/layout-real-"));
  try {
    const created = await f.c.call("project.create", {
      templateId: TEMPLATE,
      title: "布局渲染验证",
      assets: [{ inboxName: "logo.png", name: "logo.png" }],
    });
    assert.equal(created.ok, true, JSON.stringify(created));
    f.projectId = created.result.projectId;
    let revision = created.result.revision;
    const scene = await f.c.call("scene.update", {
      projectId: f.projectId,
      expectedRevision: revision,
      operationId: "real-scene",
      sceneId: "scene-1",
      template: {
        title: "布局标题验证",
        duration: 5,
        subtitle: "副标题",
        badge: "AI",
        logo: "assets/logo.png",
      },
    });
    assert.equal(scene.ok, true, JSON.stringify(scene));
    revision = scene.result.revision;

    const times = [0.5, 1.5];
    const before = {};
    for (const time of times) {
      const bytes = await framePng(f, revision, time);
      before[time] = decodePng(bytes);
    }

    const edit = await f.c.call("edit", {
      projectId: f.projectId,
      expectedRevision: revision,
      operationId: "real-layout-style",
      ops: [
        {
          type: "layout",
          target: "scene-1-title",
          unit: "composition-px",
          box: { left: 400, top: 196, width: 700 },
        },
        {
          type: "style",
          target: "scene-1-title",
          styles: { color: "#ff0000", fontSize: 96 },
        },
      ],
    });
    assert.equal(edit.ok, true, JSON.stringify(edit));
    revision = edit.result.revision;

    const after = {};
    for (const time of times) {
      const bytes = await framePng(f, revision, time);
      after[time] = decodePng(bytes);
    }

    const baseXBBoxes = [];
    for (const time of times) {
      const diff = diffImages(before[time], after[time]);
      assert.ok(diff.changedPct > 0.003, `frame ${time}s barely changed: ${JSON.stringify(diff)}`);
      assert.ok(diff.bbox.minX < 150, `old title region should be involved: ${JSON.stringify(diff.bbox)}`);
      assert.ok(diff.bbox.maxX > 500, `new title region should be involved: ${JSON.stringify(diff.bbox)}`);
      const red = redTextBBox(after[time]);
      assert.ok(red, `no red title pixels at ${time}s`);
      assert.ok(
        red.minX > 380 && red.minX < 520,
        `red title base x not at requested left 400: ${JSON.stringify(red)}`,
      );
      assert.ok(red.count > 200, `too few red pixels: ${red.count}`);
      baseXBBoxes.push(red.minX);
    }
    // Horizontal base is stable across animation times (transform has no x),
    // while the intro y offset is only a relative animation on top of the base.
    assert.ok(Math.abs(baseXBBoxes[0] - baseXBBoxes[1]) <= 6, `base x moved: ${baseXBBoxes}`);
    const early = redTextBBox(after[0.5]);
    const settled = redTextBBox(after[1.5]);
    assert.ok(
      early.minY > settled.minY + 2,
      `intro y transform must stay relative (early ${early.minY}, settled ${settled.minY})`,
    );

    // MP4 export still renders the persisted base layout/style.
    const render = await f.c.call("render", {
      projectId: f.projectId,
      revision,
      timeoutMs: 120000,
    });
    assert.equal(render.ok, true, JSON.stringify(render));
    const rendered = await waitJob(f.c, render.result.jobId);
    assert.equal(rendered.state, "succeeded", JSON.stringify(rendered));
    const mp4 = resolve(f.outputRoot, rendered.artifact.name);
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
          mp4,
        ],
        { encoding: "utf8" },
      ),
    );
    const stream = probe.streams[0];
    assert.equal(stream.codec_name, "h264");
    assert.equal(stream.width, 1280);
    assert.equal(stream.height, 720);
    assert.equal(stream.r_frame_rate, "30/1");
    assert.equal(Number(stream.nb_read_frames), 150);
    assert.ok(Math.abs(Number(probe.format.duration) - 5) <= 1 / 30);

    const renderedFramePath = resolve(artifacts, "rendered-1.5s.png");
    execFileSync("ffmpeg", [
      "-y",
      "-v",
      "error",
      "-ss",
      "1.5",
      "-i",
      mp4,
      "-frames:v",
      "1",
      renderedFramePath,
    ]);
    const renderedFrame = decodePng(await readFile(renderedFramePath));
    const renderedRed = redTextBBox(renderedFrame);
    assert.ok(renderedRed, "rendered frame has no red title pixels");
    assert.ok(
      Math.abs(renderedRed.minX - settled.minX) <= 24,
      `rendered base x ${renderedRed.minX} vs worker frame ${settled.minX}`,
    );
    assert.ok(renderedRed.count > 200);
  } finally {
    await rm(artifacts, { recursive: true, force: true });
    await f.cleanup();
  }
});
