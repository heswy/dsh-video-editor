import { createVideoTool } from "../host/tool.js";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { VideoBridge } from "../host/bridge.js";
import { WorkerClient } from "../packages/video-engine-client/src/index.mjs";
const root = await mkdtemp(join(tmpdir(), "m3-pages-"));
const bridge = new VideoBridge({
  ctx: {
    connection: { fetch: { register: () => () => {} } },
    logger: { warn() {} },
    subprocess: { resolveExecutable: async (x) => x },
  },
  rawConfig: {
    workerNode: process.execPath,
    workerEntry: resolve("packages/video-engine-worker/src/worker.mjs"),
    workerCwd: root,
    dataRoot: join(root, "data"),
    legacyDataRoots: [],
    registryPath: join(root, "registry.json"),
    artifactRoot: join(root, "output"),
    allowedProjects: ["demo"],
    requestTimeoutMs: 120000,
  },
  engineLoader: async () => ({
    WorkerClient,
    workerEntry: resolve("packages/video-engine-worker/src/worker.mjs"),
    clientVersion: "0.6.0",
    workerVersion: "0.6.0",
  }),
});
try {
  const created = await bridge.invoke("project.create", {
    templateId: "product-launch-v1",
    title: "分页时间线",
  });
  const projectId = created.projectId;
  let t = await bridge.invoke("timeline.inspect", { projectId });
  const clipId = t.tracks[0].clips[0].clipId;
  for (let i = 0; i < 4; i++)
    t = await bridge.invoke("timeline.apply", {
      projectId,
      expectedRevision: t.revision,
      operationId: "copies-" + i,
      ops: Array.from({ length: 26 }, () => ({
        op: "clip.duplicate",
        clipId,
        mode: "ripple",
      })),
    });
  await bridge.sessions.store.addSession(projectId, "m3-agent-session", true);
  const tool = createVideoTool(bridge),
    exec = { agent: { session: { id: "m3-agent-session" } } };
  const seen = await tool.execute(
    { action: "timeline.inspect", projectId },
    exec,
  );
  assert.equal(seen.result.revision, t.revision);
  assert.ok(bridge.sessions.contextText(exec).includes("timeline.apply"));
  assert.ok(!bridge.sessions.contextText(exec).includes("1. Fast path:"));
  const ai = (
    await tool.execute(
      {
        action: "timeline.apply",
        projectId,
        expectedRevision: t.revision,
        operationId: "ai-change",
        ops: [{ op: "clip.set", clipId, patch: { label: "AI scene" } }],
      },
      exec,
    )
  ).result;
  assert.equal(ai.written, true);
  const uiUndo = await bridge.invoke("timeline.undo", {
    projectId,
    expectedRevision: ai.revision,
    operationId: "ui-undo-ai",
  });
  assert.equal(uiUndo.revision, t.revision);
  t = (
    await tool.execute(
      {
        action: "timeline.redo",
        projectId,
        expectedRevision: uiUndo.revision,
        operationId: "ai-redo",
      },
      exec,
    )
  ).result;
  await assert.rejects(
    () => tool.execute({ action: "timeline.inspect", projectId }, {}),
    (e) => e.message.includes("E_AGENT_REQUIRED"),
  );
  const other = await bridge.invoke("project.create", {
    templateId: "product-launch-v1",
    title: "Other",
  });
  await assert.rejects(
    () =>
      tool.execute(
        { action: "timeline.inspect", projectId: other.projectId },
        exec,
      ),
    (e) => e.message.includes("E_PROJECT_SCOPE"),
  );
  const inspected = await bridge.invoke("inspect", { projectId });
  assert.equal(inspected.filesTruncated, true);
  assert.equal(inspected.files.length, 50);
  const snapshot = await bridge.invoke("preview.snapshot", {
    projectId,
    revision: t.revision,
  });
  assert.equal(snapshot.filesTruncated, true);
  assert.ok(snapshot.fileCount > 100);
  assert.equal(
    bridge.snapshots.records.get(snapshot.snapshotId).files.size,
    snapshot.fileCount,
  );
  assert.ok(Buffer.byteLength(JSON.stringify(snapshot)) < 65536);
  await bridge.invoke("preview.release", { snapshotId: snapshot.snapshotId });
  let registered = 0,
    rolledBack = 0;
  bridge.snapshots.connection.fetch.register = () => {
    if (++registered === 2) throw new Error("fixture route failure");
    return () => rolledBack++;
  };
  await assert.rejects(
    () =>
      bridge.invoke("preview.snapshot", { projectId, revision: t.revision }),
    (e) => e.code === "E_SNAPSHOT",
  );
  assert.equal(rolledBack, 1);
  assert.equal(bridge.snapshots.records.size, 0);
  console.log(
    JSON.stringify({
      ok: true,
      clips: 105,
      files: snapshot.fileCount,
      publicFiles: snapshot.files.length,
      inspectionFiles: inspected.files.length,
    }),
  );
} finally {
  await bridge.dispose();
  await rm(root, { recursive: true, force: true });
}
