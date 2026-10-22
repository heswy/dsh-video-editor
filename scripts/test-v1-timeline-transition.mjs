import assert from "node:assert/strict";
import {
  fixture,
  client,
  waitJob,
} from "../packages/video-engine-worker/test/helpers.mjs";
import { decodePng } from "../packages/video-engine-worker/test/png-decode.mjs";
import { mkdir, writeFile, readFile, copyFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
const f = await fixture(),
  out = resolve(process.argv[2] || "/tmp/m3-transition");
await mkdir(out, { recursive: true });
let c;
async function call(m, p = {}) {
  const r = await c.call(m, { projectId: "demo", ...p });
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
  for (const color of ["red", "blue"])
    execFileSync("ffmpeg", [
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      `color=c=${color}:s=320x180:r=30:d=2`,
      "-c:v",
      "libx264",
      join(inbox, color + ".mp4"),
    ]);
  c = client(f.registry);
  await call("open");
  let t = await call("timeline.inspect");
  const assets = [];
  for (const color of ["red", "blue"])
    assets.push(
      (await call("asset.importMedia", { sourceName: color + ".mp4" })).asset,
    );
  let r = await call("timeline.apply", {
    expectedRevision: t.revision,
    operationId: "insert",
    ops: [
      { op: "clip.delete", clipId: t.tracks[0].clips[0].clipId },
      ...assets.map((a, i) => ({
        op: "clip.insert",
        assetId: a.assetId,
        trackId: "tr_v1",
        startFrame: i * 60,
      })),
      { op: "timeline.settings", durationFrames: 120 },
    ],
  });
  t = await call("timeline.inspect");
  r = await call("timeline.apply", {
    expectedRevision: r.revision,
    operationId: "fade",
    ops: [
      {
        op: "clip.transition",
        clipId: t.tracks[0].clips[0].clipId,
        type: "crossfade",
        durationFrames: 30,
      },
    ],
  });
  let j = await call("frame", { revision: r.revision, times: [0.5, 1.5, 2.5] });
  let result = await waitJob(c, j.jobId);
  assert.equal(result.state, "succeeded", JSON.stringify(result));
  await copyFile(
    join(f.config.outputRoot, result.artifact.name),
    join(out, "crossfade.png"),
  );
  const png = decodePng(await readFile(join(out, "crossfade.png")));
  const rgb = [240, 720, 1200].map((x) =>
    Array.from(
      png.data.subarray(
        (135 * png.width + x) * png.channels,
        (135 * png.width + x) * png.channels + 3,
      ),
    ),
  );
  assert.ok(rgb[0][0] > 230 && rgb[0][2] < 20);
  assert.ok(
    rgb[1][0] > 90 && rgb[1][0] < 170 && rgb[1][2] > 90 && rgb[1][2] < 170,
    JSON.stringify(rgb),
  );
  assert.ok(rgb[2][2] > 230 && rgb[2][0] < 20);
  j = await call("render", { revision: r.revision });
  assert.equal((await c.call("cancel", { jobId: j.jobId })).ok, true);
  result = await waitJob(c, j.jobId);
  assert.equal(result.state, "cancelled");
  assert.deepEqual(result.survivors ?? [], []);
  j = await call("render", { revision: r.revision });
  result = await waitJob(c, j.jobId);
  assert.equal(result.state, "succeeded", JSON.stringify(result));
  assert.equal(Number(result.artifact.metadata.nb_read_frames), 120);
  await copyFile(
    join(f.config.outputRoot, result.artifact.name),
    join(out, "crossfade.mp4"),
  );
  const probe = JSON.parse(
    execFileSync(
      "ffprobe",
      [
        "-v",
        "error",
        "-show_streams",
        "-of",
        "json",
        join(out, "crossfade.mp4"),
      ],
      { encoding: "utf8" },
    ),
  );
  assert.equal(
    probe.streams.some((s) => s.codec_type === "audio"),
    false,
  );
  execFileSync("ffmpeg", [
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "color=c=green:s=320x180:r=30:d=2",
    "-c:v",
    "prores_ks",
    join(inbox, "proxy.mov"),
  ]);
  const a = (await call("asset.importMedia", { sourceName: "proxy.mov" }))
    .asset;
  const op = {
    projectId: "demo",
    expectedRevision: r.revision,
    operationId: "replace-proxy",
    ops: [
      {
        op: "clip.replace",
        clipId: t.tracks[0].clips[1].clipId,
        assetId: a.assetId,
      },
    ],
  };
  const bad = await c.call("timeline.apply", op);
  assert.equal(bad.error.code, "E_MEDIA_PROXY_REQUIRED");
  assert.equal((await call("timeline.inspect")).revision, r.revision);
  await call("asset.derive", { assetId: a.assetId, kind: "proxy" });
  r = await call("timeline.apply", op);
  const snapshot = await call("preview.snapshot", { revision: r.revision });
  assert.ok(
    snapshot.files.filter((x) => x.media).every((x) => x.path.endsWith(".mp4")),
  );
  const sourcePath = join(
    f.project,
    "media",
    assets[0].sha256.slice(0, 8) + ".mp4",
  );
  const changed = await readFile(sourcePath);
  changed[20] ^= 1;
  await writeFile(sourcePath, changed);
  const corrupted = await c.call("preview.snapshot", {
    projectId: "demo",
    revision: r.revision,
  });
  assert.equal(corrupted.error.code, "E_ASSET_CHANGED");
  await writeFile(
    join(out, "result.json"),
    JSON.stringify(
      {
        ok: true,
        rgb,
        frames: 120,
        duration: 4,
        silent: true,
        cancelRetry: true,
        proxy: true,
      },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify({
      ok: true,
      rgb,
      frames: 120,
      cancelRetry: true,
      proxy: true,
    }),
  );
} finally {
  if (c) await c.stop();
  await f.cleanup();
}
