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

async function managed() {
  const dir = await mkdtemp(resolve(tmpdir(), "scene-template-client-"));
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
  await writeFile(resolve(assetInboxRoot, "shot.png"), PNG);
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
    async cleanup() {
      await client.dispose().catch(() => {});
      await rm(dir, { recursive: true, force: true });
    },
  };
}

test("client exposes scene.template and can reuse it for a partial scene update", async () => {
  const f = await managed();
  try {
    await f.client.start();
    const project = await f.client.projectCreate({
      templateId: "product-launch-v1",
      title: "客户端模板读取",
      assets: [
        { inboxName: "logo.png", name: "logo.png" },
        { inboxName: "shot.png", name: "shot.png" },
      ],
    });
    assert.ok(project.scenes[0].template, "project.create scenes expose template");
    const scene = await f.client.sceneUpdate({
      projectId: project.projectId,
      expectedRevision: project.revision,
      operationId: "client-template-full",
      sceneId: "scene-1",
      template: {
        title: "客户端完整场景",
        duration: 4,
        subtitle: "保留副标题",
        badge: "KEEP",
        color: "#123456",
        accent: "#abcdef",
        logo: "assets/logo.png",
        shot: "assets/shot.png",
      },
    });
    const inspected = await f.client.inspect(project.projectId);
    const template = inspected.scenes[0].template;
    assert.deepEqual(template, {
      title: "客户端完整场景",
      duration: 4,
      subtitle: "保留副标题",
      badge: "KEEP",
      color: "#123456",
      accent: "#abcdef",
      logo: "assets/logo.png",
      shot: "assets/shot.png",
    });
    const recolor = await f.client.sceneUpdate({
      projectId: project.projectId,
      expectedRevision: scene.revision,
      operationId: "client-template-recolor",
      sceneId: "scene-1",
      template: { ...template, color: "#ff0000" },
    });
    const after = await f.client.inspect(project.projectId);
    assert.deepEqual(
      { ...after.scenes[0].template, color: "#123456" },
      template,
    );
    assert.equal(after.revision, recolor.revision);
  } finally {
    await f.cleanup();
  }
});
