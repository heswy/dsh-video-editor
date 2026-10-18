import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, resolve } from "node:path";
import { WorkerClient, WorkerClientError } from "../src/index.mjs";

const workerEntry = resolve(
  import.meta.dirname,
  "../../video-engine-worker/src/worker.mjs",
);
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
const TEMPLATE = "product-launch-v1";
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

async function managed() {
  const dir = await mkdtemp(resolve(tmpdir(), "preview-client-"));
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
    outputRoot,
    client,
    async cleanup() {
      await client.dispose().catch(() => {});
      await rm(dir, { recursive: true, force: true });
    },
  };
}

async function rejection(promise) {
  try {
    await promise;
  } catch (error) {
    assert.ok(error instanceof WorkerClientError, String(error));
    return error;
  }
  assert.fail("expected the client to reject");
}

test("client exposes preview snapshot/release and preserves their contract", async () => {
  const f = await managed();
  try {
    await f.client.start();
    const project = await f.client.projectCreate({
      templateId: TEMPLATE,
      title: "客户端预览",
      assets: [{ inboxName: "logo.png", name: "logo.png" }],
    });
    const inspected = await f.client.inspect(project.projectId);
    const snapshot = await f.client.previewSnapshot({
      projectId: project.projectId,
      revision: project.revision,
      ttlMs: 60000,
    });
    assert.match(snapshot.snapshotId, /^[a-f0-9]{32}$/);
    assert.equal(snapshot.projectId, project.projectId);
    assert.equal(snapshot.revision, project.revision);
    assert.equal(snapshot.entry, "index.html");
    assert.deepEqual(snapshot.files, inspected.files);
    assert.equal(snapshot.maxBytes, 128 * 1024 * 1024);
    for (const file of snapshot.files) {
      assert.ok(!isAbsolute(file.path));
      const bytes = await readFile(
        resolve(f.outputRoot, "previews", snapshot.snapshotId, file.path),
      );
      assert.equal(sha256(bytes), file.sha256);
    }

    const stale = await rejection(
      f.client.previewSnapshot({
        projectId: project.projectId,
        revision: "0".repeat(64),
      }),
    );
    assert.equal(stale.code, "E_REVISION_CONFLICT");

    const released = await f.client.previewRelease({
      snapshotId: snapshot.snapshotId,
    });
    assert.deepEqual(released, {
      snapshotId: snapshot.snapshotId,
      projectId: project.projectId,
      revision: project.revision,
      released: true,
    });
    const repeated = await rejection(
      f.client.previewRelease({ snapshotId: snapshot.snapshotId }),
    );
    assert.equal(repeated.code, "E_SNAPSHOT_NOT_FOUND");
    assert.deepEqual(await readdir(resolve(f.outputRoot, "previews")), []);

    // A snapshot stays readable after the project content changes; closing the
    // project removes its remaining preview copies.
    const kept = await f.client.previewSnapshot({
      projectId: project.projectId,
      revision: project.revision,
    });
    const edited = await f.client.edit({
      projectId: project.projectId,
      expectedRevision: project.revision,
      operationId: "preview-client-edit",
      ops: [{ type: "text", target: "scene-1-title", text: "客户端改标题" }],
    });
    assert.notEqual(edited.revision, project.revision);
    const bytes = await readFile(
      resolve(f.outputRoot, "previews", kept.snapshotId, "index.html"),
    );
    assert.equal(
      sha256(bytes),
      kept.files.find((file) => file.path === "index.html").sha256,
    );
    await f.client.close(project.projectId);
    assert.deepEqual(await readdir(resolve(f.outputRoot, "previews")), []);
  } finally {
    await f.cleanup();
  }
});

test("preview TTL expiry surfaces as E_SNAPSHOT_NOT_FOUND through the client", async () => {
  const f = await managed();
  try {
    await f.client.start();
    const project = await f.client.projectCreate({
      templateId: TEMPLATE,
      title: "客户端 TTL",
    });
    const snapshot = await f.client.previewSnapshot({
      projectId: project.projectId,
      revision: project.revision,
      ttlMs: 100,
    });
    assert.equal(
      (await readdir(resolve(f.outputRoot, "previews"))).includes(snapshot.snapshotId),
      true,
    );
    await new Promise((resolveWait) => setTimeout(resolveWait, 500));
    assert.deepEqual(await readdir(resolve(f.outputRoot, "previews")), []);
    const expired = await rejection(
      f.client.previewRelease({ snapshotId: snapshot.snapshotId }),
    );
    assert.equal(expired.code, "E_SNAPSHOT_NOT_FOUND");
  } finally {
    await f.cleanup();
  }
});
