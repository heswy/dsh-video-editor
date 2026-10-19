import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { WorkerClient } from "../src/index.mjs";

const workerEntry = resolve(
  import.meta.dirname,
  "../../video-engine-worker/src/worker.mjs",
);
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
const TEMPLATE = "product-launch-v1";

async function managed() {
  const dir = await mkdtemp(resolve(tmpdir(), "layout-client-"));
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
  const client = new WorkerClient({
    nodeExecutable: process.execPath,
    workerEntry,
    registryPath: configPath,
    startupTimeoutMs: 15000,
    requestTimeoutMs: 15000,
    shutdownTimeoutMs: 15000,
    forceKillTimeoutMs: 2000,
    maxPending: 32,
    maxLineBytes: 131072,
    maxStderrBytes: 16384,
  });
  return {
    client,
    dir,
    async cleanup() {
      await client.dispose().catch(() => {});
      await rm(dir, { recursive: true, force: true });
    },
  };
}

test("client passes layout/style edit ops through and exposes normalized inspect fields", async () => {
  const f = await managed();
  try {
    await f.client.start();
    const project = await f.client.projectCreate({
      templateId: TEMPLATE,
      title: "客户端布局",
      assets: [{ inboxName: "logo.png", name: "logo.png" }],
    });
    const scene = await f.client.sceneUpdate({
      projectId: project.projectId,
      expectedRevision: project.revision,
      operationId: "client-scene",
      sceneId: "scene-1",
      template: {
        title: "客户端标题",
        duration: 5,
        subtitle: "副标题",
        logo: "assets/logo.png",
      },
    });
    const expectedRevision = scene.revision;
    const editParams = {
      projectId: project.projectId,
      expectedRevision,
      operationId: "client-layout-style",
      ops: [
        {
          type: "layout",
          target: "scene-1-title",
          unit: "composition-px",
          box: { left: 150.5, top: 220 },
        },
        {
          type: "style",
          target: "scene-1-title",
          styles: { color: "#00aaff", fontSize: 80, fontWeight: 500, textAlign: "left" },
        },
        {
          type: "layout",
          target: "scene-1-logo",
          unit: "composition-px",
          box: { width: 220 },
        },
      ],
    };
    const saved = await f.client.edit(editParams);
    assert.equal(typeof saved.revision, "string");
    assert.equal(saved.operationId, "client-layout-style");
    assert.notEqual(saved.revision, expectedRevision);

    const inspected = await f.client.inspect(project.projectId);
    const title = inspected.elements.find((entry) => entry.stableId === "scene-1-title");
    assert.deepEqual(title.layout, { left: 150.5, top: 220, width: 980, height: null });
    assert.deepEqual(title.style, {
      color: "#00aaff",
      fontSize: 80,
      fontWeight: 500,
      textAlign: "left",
    });
    assert.ok(title.capabilities.includes("layout"));
    assert.ok(title.capabilities.includes("style"));
    const logo = inspected.elements.find((entry) => entry.stableId === "scene-1-logo");
    assert.equal(logo.layout.width, 220);

    // Same request is idempotent through the client too (no method added).
    const retried = await f.client.edit(editParams);
    assert.equal(retried.revision, saved.revision);

    // Legacy text/timing behavior is unchanged in the same unified edit call.
    const text = await f.client.edit({
      projectId: project.projectId,
      expectedRevision: saved.revision,
      operationId: "client-text",
      ops: [
        { type: "text", target: "scene-1-title", text: "文字仍然可改" },
        { type: "timing", target: "scene-1-subtitle", start: 0.5, duration: 4 },
      ],
    });
    const afterText = await f.client.inspect(project.projectId);
    assert.equal(
      afterText.elements.find((entry) => entry.stableId === "scene-1-title").text,
      "文字仍然可改",
    );
    const subtitle = afterText.elements.find(
      (entry) => entry.stableId === "scene-1-subtitle",
    );
    assert.deepEqual(subtitle.timing, { start: 0.5, duration: 4 });
    assert.equal(afterText.revision, text.revision);
  } finally {
    await f.cleanup();
  }
});
