import assert from "node:assert/strict";
import {
  fixture,
  client,
  waitJob,
} from "../packages/video-engine-worker/test/helpers.mjs";
import { mkdir, writeFile, readFile, copyFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
const f = await fixture(),
  out = resolve(process.argv[2] || "/tmp/m3-render-evidence");
await mkdir(out, { recursive: true });
let c;
async function call(method, p = {}) {
  const r = await c.call(method, { projectId: "demo", ...p });
  assert.equal(r.ok, true, JSON.stringify(r));
  return r.result;
}
try {
  const inbox = join(f.dir, "inbox");
  await mkdir(inbox);
  await writeFile(
    join(f.dir, "managed.json"),
    JSON.stringify({ projects: f.config.projects }),
  );
  await writeFile(
    f.registry,
    JSON.stringify({
      projectsRoot: f.config.root,
      registryPath: join(f.dir, "managed.json"),
      outputRoot: f.config.outputRoot,
      assetInboxRoot: inbox,
    }),
  );
  execFileSync("ffmpeg", [
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "testsrc2=s=320x180:r=30:d=20",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    join(inbox, "video.mp4"),
  ]);
  c = client(f.registry);
  await call("open");
  const legacy = await call("inspect");
  if (process.env.M3_MIGRATION === "1") {
    const job = await call("frame", {
      revision: legacy.revision,
      times: process.env.M3_SCENE === "1" ? [20.5, 21, 21.5] : [0.5, 2.5, 4.5],
    });
    const result = await waitJob(c, job.jobId);
    assert.equal(result.state, "succeeded", JSON.stringify(result));
    await copyFile(result.artifact.path, join(out, "legacy.png"));
  }
  let t = await call("timeline.inspect");
  const a = await call("asset.importMedia", { sourceName: "video.mp4" });
  let r = await call("timeline.apply", {
    expectedRevision: t.revision,
    operationId: "insert",
    ops: [
      { op: "clip.delete", clipId: t.tracks[0].clips[0].clipId },
      {
        op: "clip.insert",
        assetId: a.asset.assetId,
        trackId: "tr_v1",
        startFrame: 0,
      },
    ],
  });
  t = await call("timeline.inspect");
  const clip = t.tracks[0].clips[0];
  r = await call("timeline.apply", {
    expectedRevision: t.revision,
    operationId: "split",
    ops: [
      { op: "clip.split", clipId: clip.clipId, atFrame: 150 },
      { op: "clip.split", clipId: clip.clipId, atFrame: 90 },
    ],
  });
  t = await call("timeline.inspect");
  r = await call("timeline.apply", {
    expectedRevision: t.revision,
    operationId: "reorder",
    ops: [
      {
        op: "clip.reorder",
        trackId: "tr_v1",
        clipIds: [
          t.tracks[0].clips[1].clipId,
          t.tracks[0].clips[0].clipId,
          t.tracks[0].clips[2].clipId,
        ],
      },
    ],
  });
  if (process.env.M3_SCENE === "1") {
    const html = `<!doctype html><html><head><script src="assets/gsap.min.js"></script><style>html,body{margin:0}#main{background:#243040;color:white}</style></head><body><div id="main" data-composition-id="main" data-width="1280" data-height="720" data-duration="2"><h1 id="title">Timeline scene</h1></div><script>const tl=gsap.timeline({paused:true});tl.to('#title',{x:300,duration:2,ease:"none"});window.__timelines={main:tl};</script></body></html>`;
    r = await call("scene.compose", {
      expectedRevision: r.revision,
      operationId: "scene",
      trackId: "tr_v1",
      startFrame: 600,
      html,
    });
  }
  const snap = await call("preview.snapshot", { revision: r.revision });
  assert.ok(snap.files.some((x) => x.media));
  await writeFile(join(out, "snapshot.json"), JSON.stringify(snap, null, 2));
  const job = await call(process.env.M3_FRAME === "1" ? "frame" : "render", {
    revision: r.revision,
    ...(process.env.M3_FRAME === "1"
      ? {
          times:
            process.env.M3_SCENE === "1" ? [20.5, 21, 21.5] : [0.5, 2.5, 4.5],
        }
      : {}),
  });
  const result = await waitJob(c, job.jobId);
  await writeFile(join(out, "result.json"), JSON.stringify(result, null, 2));
  assert.equal(result.state, "succeeded", JSON.stringify(result));
  console.log(JSON.stringify(result));
  await copyFile(
    join(f.config.outputRoot, result.artifact.name),
    join(out, process.env.M3_FRAME === "1" ? "frame.png" : "render.mp4"),
  );
} finally {
  if (c) {
    await c.stop();
  }
  await f.cleanup();
}
