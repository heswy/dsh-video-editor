import { rename } from "node:fs/promises";
import { join } from "node:path";
import assert from "node:assert/strict";
import {
  fixture,
  client,
} from "../packages/video-engine-worker/test/helpers.mjs";
const f = await fixture();
let c = client(f.registry);
let n = 0;
async function call(method, p = {}) {
  const r = await c.call(method, { projectId: "demo", ...p });
  if (!r.ok) throw Object.assign(new Error(JSON.stringify(r.error)), r.error);
  return r.result;
}
try {
  await call("open");
  let t = await call("timeline.inspect");
  assert.equal(t.schema, "dsh-video/timeline@1");
  assert.equal(t.tracks[0].clips.length, 1);
  n++;
  const original = t.revision,
    clip = t.tracks[0].clips[0],
    split = Math.floor(clip.durationFrames / 2);
  const p = {
    expectedRevision: original,
    operationId: "split-one",
    ops: [{ op: "clip.split", clipId: clip.clipId, atFrame: split }],
  };
  const dry = await call("timeline.apply", { ...p, dryRun: true });
  assert.equal(dry.written, false);
  assert.equal((await call("timeline.inspect")).revision, original);
  n++;
  const r = await call("timeline.apply", p);
  assert.equal(r.lineage[0].keptClipId, clip.clipId);
  assert.deepEqual(await call("timeline.apply", p), r);
  n++;
  const conflict = await c.call("timeline.apply", {
    projectId: "demo",
    ...p,
    operationId: "stale",
  });
  assert.equal(conflict.error.code, "E_REVISION_CONFLICT");
  n++;
  t = await call("timeline.inspect");
  const ids = t.tracks[0].clips.map((x) => x.clipId);
  assert.equal(ids.length, 2);
  const bad = await c.call("timeline.apply", {
    projectId: "demo",
    expectedRevision: t.revision,
    operationId: "atomic",
    ops: [
      { op: "clip.set", clipId: ids[0], patch: { label: "changed" } },
      { op: "clip.split", clipId: ids[1], atFrame: 0 },
    ],
  });
  assert.equal(bad.ok, false);
  assert.equal((await call("timeline.inspect")).revision, t.revision);
  n++;
  const reordered = await call("timeline.apply", {
    expectedRevision: t.revision,
    operationId: "reorder",
    ops: [
      {
        op: "clip.reorder",
        trackId: t.tracks[0].trackId,
        clipIds: [...ids].reverse(),
      },
    ],
  });
  assert.equal(
    (await call("timeline.inspect")).tracks[0].clips[0].clipId,
    ids[1],
  );
  n++;
  let undone = await call("timeline.undo", {
    expectedRevision: reordered.revision,
    operationId: "undo-reorder",
  });
  assert.equal(
    (await call("timeline.inspect")).tracks[0].clips[0].clipId,
    ids[0],
  );
  n++;
  await call("timeline.redo", {
    expectedRevision: undone.revision,
    operationId: "redo-reorder",
  });
  n++;
  const resolved = await call("timeline.resolve", {
    refs: [{ kind: "index", index: 1 }],
  });
  assert.equal(resolved.matches[0].clipIds[0], ids[1]);
  n++;
  await c.call("shutdown", {});
  await c.exited;
  c = client(f.registry);
  await call("open");
  t = await call("timeline.inspect");
  assert.equal(t.tracks[0].clips.length, 2);
  assert.ok(t.undoHint.canUndo);
  assert.deepEqual(await call("timeline.apply", p), r);
  n++;
  await rename(
    join(f.project, "index.html"),
    join(f.project, "legacy.saved.html"),
  );
  assert.equal((await call("inspect")).revision, t.revision);
  n++;
  console.log(`timeline ${n} scenarios passed`);
} finally {
  await c.call("shutdown", {});
  await c.exited;
  await f.cleanup();
}
