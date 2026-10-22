import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  fixture,
  client,
} from "../packages/video-engine-worker/test/helpers.mjs";
const f = await fixture();
let c = client(f.registry);
let checks = 0;
async function call(method, p = {}) {
  const r = await c.call(method, { projectId: "demo", ...p });
  if (!r.ok) throw Object.assign(new Error(r.error.message), r.error);
  return r.result;
}
try {
  await call("open");
  let t = await call("timeline.inspect");
  const refs = await call("timeline.references", { query: "" });
  assert(refs.items.some((x) => x.kind === "scene"));
  assert(refs.items.some((x) => x.kind === "range"));
  checks++;
  const item = refs.items.find((x) => x.kind === "clip");
  assert(item.token.startsWith("dshvideo:v1/demo/clip/"));
  checks++;
  const resolved = await call("timeline.resolve", {
    revision: t.revision,
    refs: [{ kind: "token", token: item.token }],
  });
  assert.equal(resolved.matches[0].status, "resolved");
  assert.deepEqual(resolved.matches[0].clipIds, [item.clipId]);
  checks++;
  const foreign = item.token.replace("/demo/", "/other/");
  const bad = await call("timeline.resolve", {
    refs: [{ kind: "token", token: foreign }],
  });
  assert.equal(bad.matches[0].status, "foreign");
  checks++;
  const request = {
    expectedRevision: t.revision,
    operationId: "rename",
    ops: [{ op: "clip.set", clipId: item.clipId, patch: { label: "开场" } }],
  };
  const dry = await call("timeline.apply", { ...request, dryRun: true });
  assert.equal(dry.written, false);
  assert.equal(dry.beforeRevision, t.revision);
  assert.equal((await call("timeline.inspect")).lastChange, null);
  checks++;
  const result = await call("timeline.apply", request);
  t = await call("timeline.inspect");
  assert.equal(t.lastChange.operationId, "rename");
  assert.equal(t.lastChange.revision, t.revision);
  assert.equal(t.historyCursor, 1);
  checks++;
  const staleRange = await call("timeline.resolve", {
    refs: [
      {
        kind: "token",
        token: refs.items.find((x) => x.kind === "range").token,
      },
    ],
  });
  assert.equal(staleRange.matches[0].status, "stale");
  checks++;
  assert.equal(
    (
      await call("timeline.resolve", {
        refs: [{ kind: "token", token: item.token }],
      })
    ).matches[0].status,
    "resolved",
  );
  checks++;
  const wrongReceipt = await c.call("timeline.undo", {
    projectId: "demo",
    expectedRevision: t.revision,
    expectedHistoryCursor: 1,
    expectedOperationId: "other",
    operationId: "wrong-receipt",
  });
  assert.equal(wrongReceipt.error.code, "E_REVISION_CONFLICT");
  checks++;
  const denied = await c.call("timeline.undo", {
    projectId: "demo",
    expectedRevision: t.revision,
    expectedHistoryCursor: 0,
    operationId: "stale-undo",
  });
  assert.equal(denied.error.code, "E_REVISION_CONFLICT");
  checks++;
  await call("timeline.undo", {
    expectedRevision: t.revision,
    expectedHistoryCursor: t.historyCursor,
    operationId: "undo",
  });
  t = await call("timeline.inspect");
  assert.equal(t.revision, request.expectedRevision);
  checks++;
  await call("timeline.apply", {
    expectedRevision: t.revision,
    operationId: "delete",
    ops: [{ op: "clip.delete", clipId: item.clipId }],
  });
  assert.equal(
    (
      await call("timeline.resolve", {
        refs: [{ kind: "token", token: item.token }],
      })
    ).matches[0].status,
    "missing",
  );
  checks++;
  const malformed = await call("timeline.resolve", {
    refs: [
      { kind: "token", token: "dshvideo:fake" },
      { kind: "token", token: "dshvideo:v1/demo/clip/%2f/-" },
    ],
  });
  assert(malformed.matches.every((x) => x.status === "invalid"));
  checks++;
  await c.stop();
  c = client(f.registry);
  await call("open");
  t = await call("timeline.inspect");
  assert.equal(t.lastChange.operationId, "delete");
  checks++;
  const indexPath = join(f.project, "asset-index.json");
  await writeFile(
    indexPath,
    JSON.stringify({
      assets: [
        {
          assetId: "as_11111111",
          name: "临时图片",
          kind: "image",
          sha256: "1".repeat(64),
          ext: "png",
          bytes: 1,
        },
      ],
    }),
  );
  await call("timeline.apply", {
    expectedRevision: t.revision,
    operationId: "sync-inventory",
    ops: [{ op: "timeline.settings", background: "#112233" }],
  });
  const assetRef = (await call("timeline.references")).items.find(
    (x) => x.kind === "asset",
  );
  assert(assetRef);
  checks++;
  await writeFile(indexPath, JSON.stringify({ assets: [] }));
  assert.equal(
    (
      await call("timeline.resolve", {
        refs: [{ kind: "token", token: assetRef.token }],
      })
    ).matches[0].status,
    "missing",
  );
  assert.equal(
    (await call("timeline.references")).items.filter((x) => x.kind === "asset")
      .length,
    0,
  );
  checks++;
  for (let i = 0; i < 2; i++) {
    const now = await call("timeline.inspect");
    await call("timeline.undo", {
      expectedRevision: now.revision,
      operationId: "restore-" + i,
    });
  }
  let now = await call("timeline.inspect");
  const added = await call("timeline.apply", {
    expectedRevision: now.revision,
    operationId: "extra-track",
    ops: [{ op: "track.add", kind: "video", name: "重叠轨" }],
  });
  await call("timeline.apply", {
    expectedRevision: added.revision,
    operationId: "overlap-copy",
    ops: [
      {
        op: "clip.duplicate",
        clipId: item.clipId,
        trackId: added.applied[0].createdIds[0],
        startFrame: 0,
      },
    ],
  });
  const list = await call("timeline.references");
  assert.equal(new Set(list.items.map((x) => x.token)).size, list.items.length);
  checks++;
  const ordinal = await call("timeline.resolve", {
    refs: [{ kind: "index", index: 1 }],
  });
  assert.equal(ordinal.matches[0].status, "ambiguous");
  assert.equal(ordinal.matches[0].candidates.length, 2);
  checks++;
  console.log(JSON.stringify({ ok: true, checks }));
} finally {
  await c.stop();
  await f.cleanup();
}
