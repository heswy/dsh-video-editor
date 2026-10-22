import assert from "node:assert/strict";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { VideoBridge } from "../host/bridge.js";
import { WorkerClient } from "../packages/video-engine-client/src/index.mjs";
const root = await mkdtemp(join(tmpdir(), "m4-host-"));
let bridge;
try {
  const config = {
    workerNode: process.execPath,
    workerEntry: resolve("packages/video-engine-worker/src/worker.mjs"),
    workerCwd: root,
    registryPath: join(root, "old-registry.json"),
    artifactRoot: join(root, "old-output"),
    allowedProjects: ["demo"],
    dataRoot: join(root, "data"),
    legacyDataRoots: [],
    requestTimeoutMs: 120000,
  };
  bridge = new VideoBridge({
    ctx: {
      logger: { warn: () => {} },
      subprocess: { resolveExecutable: async (c) => c },
    },
    rawConfig: config,
    engineLoader: async () => ({
      WorkerClient,
      workerEntry: config.workerEntry,
      clientVersion: "0.8.0",
      workerVersion: "0.8.0",
    }),
  });
  const a = await bridge.invoke("project.create", {
      templateId: "product-launch-v1",
      title: "audio A",
    }),
    b = await bridge.invoke("project.create", {
      templateId: "product-launch-v1",
      title: "audio B",
    });
  bridge.sessions.projectForSession = async (id) =>
    id === "trusted-agent" ? a.projectId : null;
  await assert.rejects(
    () => bridge.invoke("reference.list", { sessionId: "unbound" }),
    (e) => e.code === "E_SESSION_NOT_BOUND",
  );
  await assert.rejects(
    () =>
      bridge.invoke(
        "reference.list",
        { sessionId: "trusted-agent" },
        { source: "tool", agentSessionId: "trusted-agent" },
      ),
    (e) => e.code === "E_METHOD",
  );
  const refs = await bridge.invoke("reference.list", {
    sessionId: "trusted-agent",
    query: "",
  });
  assert.equal(refs.projectId, a.projectId);
  assert(refs.items.length > 0);
  assert(!JSON.stringify(refs).includes(root));
  await assert.rejects(
    () =>
      bridge.invoke(
        "timeline.references",
        { projectId: b.projectId },
        { source: "tool", agentSessionId: "trusted-agent" },
      ),
    (e) => e.code === "E_PROJECT_SCOPE",
  );
  const t = await bridge.invoke("timeline.inspect", { projectId: a.projectId });
  await bridge.invoke("timeline.apply", {
    projectId: a.projectId,
    expectedRevision: t.revision,
    operationId: "ui",
    ops: [
      {
        op: "clip.set",
        clipId: t.tracks[0].clips[0].clipId,
        patch: { label: "用户修改" },
      },
    ],
  });
  const now = await bridge.invoke("timeline.inspect", {
    projectId: a.projectId,
  });
  await assert.rejects(
    () =>
      bridge.invoke("timeline.undo", {
        projectId: a.projectId,
        expectedRevision: now.revision,
        expectedHistoryCursor: 0,
        operationId: "stale",
      }),
    (e) => e.code === "E_REVISION_CONFLICT",
  );
  const resolved = await bridge.invoke(
    "timeline.resolve",
    {
      projectId: a.projectId,
      refs: [{ kind: "token", token: refs.items[0].token }],
    },
    { source: "tool", agentSessionId: "trusted-agent" },
  );
  assert.equal(resolved.matches[0].status, "resolved");
  console.log(JSON.stringify({ ok: true, checks: 7 }));
} finally {
  if (bridge) await bridge.dispose();
  await rm(root, { recursive: true, force: true });
}
