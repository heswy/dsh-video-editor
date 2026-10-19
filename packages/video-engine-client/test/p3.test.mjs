import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
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
  const dir = await mkdtemp(resolve(tmpdir(), "p3-client-"));
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
    dir,
    client,
    async cleanup() {
      await client.dispose().catch(() => {});
      await rm(dir, { recursive: true, force: true });
    },
  };
}

const spec = (title, duration = 4, extra = {}) => ({
  title,
  duration,
  subtitle: `${title} 副标题`,
  ...extra,
});

test("client exposes project/scene/asset/revise/history methods", async () => {
  const f = await managed();
  try {
    await f.client.start();
    const project = await f.client.projectCreate({
      templateId: TEMPLATE,
      title: "客户端 P3",
      assets: [{ inboxName: "logo.png", name: "logo.png" }],
    });
    assert.match(project.projectId, /^proj-/);
    assert.equal(project.scenes.length, 1);
    let revision = project.revision;

    const inspected = await f.client.inspect(project.projectId);
    assert.equal(inspected.scenes.length, 1);
    assert.ok(inspected.elements.every((element) => "sceneId" in element));

    const created = await f.client.sceneCreate({
      projectId: project.projectId,
      expectedRevision: revision,
      operationId: "client-c1",
      template: spec("第二幕", 4),
    });
    assert.equal(created.scenes.length, 2);
    revision = created.revision;

    const asset = await f.client.assetImport({
      projectId: project.projectId,
      expectedRevision: revision,
      operationId: "client-a1",
      sourceName: "logo.png",
      name: "brand.png",
    });
    assert.equal(asset.asset.path, "assets/brand.png");
    revision = asset.revision;

    const base = revision;
    const direct = await f.client.projectRevise({
      projectId: project.projectId,
      baseRevision: base,
      expectedRevision: base,
      operationId: "client-rev1",
      sceneId: "scene-2",
      template: spec("AI 第二幕", 4),
    });
    assert.equal(direct.written, true);
    revision = direct.revision;

    const human = await f.client.edit({
      projectId: project.projectId,
      expectedRevision: revision,
      operationId: "client-h1",
      ops: [{ type: "text", target: "scene-2-title", text: "人工第二幕" }],
    });
    const conflict = await f.client.projectRevise({
      projectId: project.projectId,
      baseRevision: revision,
      expectedRevision: human.revision,
      operationId: "client-rev2",
      sceneId: "scene-2",
      template: spec("AI 竞争", 4),
    });
    assert.equal(conflict.written, false);
    assert.equal(conflict.conflicts[0].reason, "BOTH_MODIFIED");

    const history = await f.client.history({ projectId: project.projectId });
    assert.equal(history.canUndo, true);
    const undo = await f.client.undo({
      projectId: project.projectId,
      expectedRevision: human.revision,
      operationId: "client-u1",
    });
    assert.equal(undo.revision, revision);
    const redo = await f.client.redo({
      projectId: project.projectId,
      expectedRevision: undo.revision,
      operationId: "client-r1",
    });
    assert.equal(redo.revision, human.revision);
    assert.equal(
      (await f.client.inspect(project.projectId)).revision,
      human.revision,
    );
  } finally {
    await f.cleanup();
  }
});
