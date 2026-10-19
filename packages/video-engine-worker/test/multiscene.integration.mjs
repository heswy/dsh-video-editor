import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { resolve } from "node:path";
import { base, client, waitJob } from "./helpers.mjs";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
const TEMPLATE = "product-launch-v1";

async function managed() {
  const dir = await mkdtemp(resolve(base, "artifacts/p3-render-"));
  const projectsRoot = resolve(dir, "projects");
  const outputRoot = resolve(dir, "output");
  const assetInboxRoot = resolve(dir, "inbox");
  const dataPath = resolve(dir, "registry-data.json");
  const configPath = resolve(dir, "registry.json");
  await mkdir(projectsRoot, { recursive: true });
  await mkdir(outputRoot, { recursive: true });
  await mkdir(assetInboxRoot, { recursive: true });
  await writeFile(dataPath, JSON.stringify({ projects: {} }));
  await writeFile(resolve(assetInboxRoot, "logo.png"), PNG);
  await writeFile(
    configPath,
    JSON.stringify({ projectsRoot, registryPath: dataPath, outputRoot, assetInboxRoot }),
  );
  const c = client(configPath);
  return {
    c,
    outputRoot,
    projectsRoot,
    async cleanup() {
      await c.stop().catch(() => {});
      await rm(dir, { recursive: true, force: true });
    },
  };
}

const spec = (title, duration) => ({
  title,
  duration,
  subtitle: `${title} 副标题`,
  badge: "AI",
});

test("15s four-scene AI project renders H.264, frames and cancels through the worker", async () => {
  const f = await managed();
  try {
    const created = await f.c.call("project.create", {
      templateId: TEMPLATE,
      title: "AI 创作 15 秒",
      assets: [{ inboxName: "logo.png", name: "logo.png" }],
    });
    assert.equal(created.ok, true, JSON.stringify(created));
    let revision = created.result.revision;
    const projectId = created.result.projectId;
    const sceneOps = [
      ["scene-2", 4],
      ["scene-3", 4],
      ["scene-4", 2],
    ];
    for (const [sceneId, duration] of sceneOps) {
      const result = await f.c.call("scene.create", {
        projectId,
        expectedRevision: revision,
        operationId: `mk-${sceneId}`,
        template: { ...spec(`场景 ${sceneId}`, duration), sceneId },
      });
      assert.equal(result.ok, true, JSON.stringify(result));
      revision = result.result.revision;
    }
    const inspected = await f.c.call("inspect", { projectId });
    assert.equal(inspected.result.duration, 15);
    assert.equal(inspected.result.scenes.length, 4);
    assert.deepEqual(
      inspected.result.scenes.map((scene) => [scene.sceneId, scene.start, scene.duration]),
      [
        ["scene-1", 0, 5],
        ["scene-2", 5, 4],
        ["scene-3", 9, 4],
        ["scene-4", 13, 2],
      ],
    );

    const frame = await f.c.call("frame", { projectId, revision, time: 6 });
    assert.equal(frame.ok, true, JSON.stringify(frame));
    const frameDone = await waitJob(f.c, frame.result.jobId);
    assert.equal(frameDone.state, "succeeded", JSON.stringify(frameDone));
    const framePath = resolve(f.outputRoot, frameDone.artifact.name);
    const frameBytes = await readFile(framePath);
    assert.equal(frameBytes.subarray(0, 4).toString("hex"), "89504e47");

    const render = await f.c.call("render", { projectId, revision });
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
    assert.equal(Number(stream.nb_read_frames), 450);
    assert.ok(Math.abs(Number(probe.format.duration) - 15) <= 1 / 30);
    assert.ok((await readFile(mp4)).length > 10000);

    // Cancel a running render: no artifact, no half-published output.
    const cancelRender = await f.c.call("render", { projectId, revision });
    await new Promise((resolveWait) => setTimeout(resolveWait, 400));
    await f.c.call("cancel", { jobId: cancelRender.result.jobId });
    const cancelled = await waitJob(f.c, cancelRender.result.jobId);
    assert.equal(cancelled.state, "cancelled", JSON.stringify(cancelled));
    assert.equal(cancelled.artifact ?? null, null);
    const afterCancelFrame = await f.c.call("frame", { projectId, revision, time: 2 });
    assert.equal(afterCancelFrame.ok, true);
    assert.equal((await waitJob(f.c, afterCancelFrame.result.jobId)).state, "succeeded");
  } finally {
    await f.cleanup();
  }
});
