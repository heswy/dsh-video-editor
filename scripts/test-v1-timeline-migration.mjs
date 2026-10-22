import assert from "node:assert/strict";
import {
  fixture,
  client,
  waitJob,
} from "../packages/video-engine-worker/test/helpers.mjs";
import { mkdir, copyFile, writeFile, readFile, rename } from "node:fs/promises";
import { resolve, join } from "node:path";
import { execFileSync } from "node:child_process";
const f = await fixture(),
  c = client(f.registry),
  out = resolve(process.argv[2] || "/tmp/m3-migration");
await mkdir(out, { recursive: true });
async function call(m, p = {}) {
  const r = await c.call(m, { projectId: "demo", ...p });
  assert.equal(r.ok, true, JSON.stringify(r));
  return r.result;
}
async function frames(revision, name, times = [0.5, 2.5, 4.5]) {
  const j = await call("frame", { revision, times });
  const r = await waitJob(c, j.jobId);
  assert.equal(r.state, "succeeded", JSON.stringify(r));
  await copyFile(
    join(f.config.outputRoot, r.artifact.name),
    join(out, name + ".png"),
  );
  return r;
}
try {
  const old = await call("open");
  await frames(old.revision, "before");
  await frames(old.revision, "source-right", [2.5, 3.5, 4.5]);
  const t = await call("timeline.inspect");
  await frames(t.revision, "after");
  const compare = execFileSync(
    "ffmpeg",
    [
      "-i",
      join(out, "before.png"),
      "-i",
      join(out, "after.png"),
      "-lavfi",
      "ssim",
      "-f",
      "null",
      "-",
    ],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
  assert.deepEqual(
    await readFile(join(out, "before.png")),
    await readFile(join(out, "after.png")),
  );
  const clip = t.tracks[0].clips[0];
  const split = await call("timeline.apply", {
    expectedRevision: t.revision,
    operationId: "split",
    ops: [{ op: "clip.split", clipId: clip.clipId, atFrame: 60 }],
  });
  const after = await call("timeline.inspect");
  const right = after.tracks[0].clips[1];
  const r = await call("timeline.apply", {
    expectedRevision: split.revision,
    operationId: "reorder",
    ops: [
      {
        op: "clip.reorder",
        trackId: "tr_v1",
        clipIds: [right.clipId, clip.clipId],
      },
    ],
  });
  await frames(r.revision, "reordered", [0.5, 1.5, 2.5]);
  assert.deepEqual(
    await readFile(join(out, "source-right.png")),
    await readFile(join(out, "reordered.png")),
  );
  await frames(old.revision, "stale").then(
    () => assert.fail("stale revision accepted"),
    () => {},
  );
  await rename(
    join(f.project, "timeline.json"),
    join(f.project, "timeline.saved.json"),
  );
  assert.equal((await call("inspect")).revision, old.revision);
  await frames(old.revision, "rollback");
  assert.deepEqual(
    await readFile(join(out, "before.png")),
    await readFile(join(out, "rollback.png")),
  );
  await writeFile(
    join(out, "result.json"),
    JSON.stringify(
      {
        ok: true,
        ssim: 1,
        byteIdentical: true,
        rollback: true,
        splitSourceOffsetFrames: right.sourceInFrame,
      },
      null,
      2,
    ),
  );
  console.log(
    "migration SSIM=1, byte-identical 3 frames, rollback and split source offset passed",
  );
} finally {
  await c.stop();
  await f.cleanup();
}
