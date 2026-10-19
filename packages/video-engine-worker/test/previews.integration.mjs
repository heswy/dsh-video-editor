import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { buildDocument } from "@hyperframes/sdk";
import { managed } from "./helpers.mjs";

const TEMPLATE = "product-launch-v1";
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

async function previewDirs(f) {
  try {
    return (await readdir(resolve(f.outputRoot, "previews"))).sort();
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

async function created(c, extra = {}) {
  const response = await c.call("project.create", {
    templateId: TEMPLATE,
    title: "真实快照链",
    assets: [{ inboxName: "logo.png", name: "logo.png" }],
    ...extra,
  });
  assert.equal(response.ok, true, JSON.stringify(response));
  return response.result;
}

async function inspect(c, projectId) {
  const response = await c.call("inspect", { projectId });
  assert.equal(response.ok, true, JSON.stringify(response));
  return response.result;
}

test("real worker chain: snapshot -> disk hash check -> edit -> immutable old snapshot -> release/restart cleanup", async () => {
  const f = await managed("previews-real");
  try {
    const project = await created(f.c);
    const projectId = project.projectId;
    let revision = project.revision;
    for (const [sceneId, duration] of [
      ["scene-2", 4],
      ["scene-3", 2],
    ]) {
      const response = await f.c.call("scene.create", {
        projectId,
        expectedRevision: revision,
        operationId: `real-${sceneId}`,
        template: {
          sceneId,
          title: `真实 ${sceneId}`,
          duration,
          subtitle: `${sceneId} 副标题`,
          badge: "AI",
        },
      });
      assert.equal(response.ok, true, JSON.stringify(response));
      revision = response.result.revision;
    }
    const before = await inspect(f.c, projectId);
    assert.equal(before.scenes.length, 3);

    const first = await f.c.call("preview.snapshot", {
      projectId,
      revision: before.revision,
      ttlMs: 60000,
    });
    assert.equal(first.ok, true, JSON.stringify(first));
    const snapshot = first.result;
    assert.equal(snapshot.revision, before.revision);
    assert.deepEqual(snapshot.files, before.files);
    const root = resolve(f.outputRoot, "previews", snapshot.snapshotId);
    for (const file of snapshot.files) {
      const bytes = await readFile(resolve(root, file.path));
      assert.equal(bytes.length, file.bytes, file.path);
      assert.equal(sha256(bytes), file.sha256, file.path);
    }
    // The snapshot is directly consumable by the engine's document parser, as
    // the future canvas iframe will be.
    const doc = buildDocument(await readFile(resolve(root, "index.html"), "utf8"));
    assert.equal(doc.width, before.width);
    assert.equal(doc.height, before.height);
    assert.equal(doc.compositionDuration, before.duration);
    const indexBefore = await readFile(resolve(root, "index.html"));

    // Modify the project: the old snapshot stays byte-identical and keeps its
    // original revision; a new snapshot reflects the new revision.
    const edited = await f.c.call("edit", {
      projectId,
      expectedRevision: before.revision,
      operationId: "real-edit",
      ops: [{ type: "text", target: "scene-2-title", text: "真实链人工修改" }],
    });
    assert.equal(edited.ok, true, JSON.stringify(edited));
    const afterEdit = await inspect(f.c, projectId);
    const stale = await f.c.call("preview.snapshot", {
      projectId,
      revision: before.revision,
    });
    assert.equal(stale.error.code, "E_REVISION_CONFLICT");
    assert.deepEqual(await readFile(resolve(root, "index.html")), indexBefore);
    const second = await f.c.call("preview.snapshot", {
      projectId,
      revision: afterEdit.revision,
      ttlMs: 60000,
    });
    assert.equal(second.ok, true, JSON.stringify(second));
    assert.equal(second.result.revision, afterEdit.revision);
    assert.notEqual(second.result.snapshotId, snapshot.snapshotId);
    assert.notDeepEqual(second.result.files, snapshot.files);
    const editedHtml = await readFile(
      resolve(f.outputRoot, "previews", second.result.snapshotId, "index.html"),
      "utf8",
    );
    assert.ok(editedHtml.includes("真实链人工修改"));

    const releasedOld = await f.c.call("preview.release", {
      snapshotId: snapshot.snapshotId,
    });
    assert.equal(releasedOld.ok, true, JSON.stringify(releasedOld));
    assert.equal((await previewDirs(f)).includes(snapshot.snapshotId), false);
    assert.equal((await previewDirs(f)).includes(second.result.snapshotId), true);

    // close cleans the remaining snapshot for that project.
    await f.c.call("close", { projectId });
    assert.deepEqual(await previewDirs(f), []);
    const closed = await f.c.call("preview.snapshot", {
      projectId,
      revision: afterEdit.revision,
    });
    assert.equal(closed.error.code, "E_PROJECT_NOT_OPEN");

    // Restart: previously open state is gone; a fresh worker discards any
    // private directories left by a crashed process.
    const leftover = resolve(f.outputRoot, "previews", "cafe".repeat(8));
    await mkdir(leftover, { recursive: true });
    await writeFile(resolve(leftover, "leftover.txt"), "stale");
    await f.restart();
    const opened = await f.c.call("open", { projectId });
    assert.equal(opened.ok, true, JSON.stringify(opened));
    assert.deepEqual(await previewDirs(f), [], "restart must discard stale previews");
    const afterRestart = await f.c.call("preview.snapshot", {
      projectId,
      revision: opened.result.revision,
    });
    assert.equal(afterRestart.ok, true, JSON.stringify(afterRestart));
    assert.equal(afterRestart.result.revision, opened.result.revision);
    for (const file of afterRestart.result.files) {
      const bytes = await readFile(
        resolve(f.outputRoot, "previews", afterRestart.result.snapshotId, file.path),
      );
      assert.equal(sha256(bytes), file.sha256);
    }
    await f.c.call("shutdown", {});
    await f.c.exited;
    assert.deepEqual(await previewDirs(f), [], "shutdown must clean previews");
    await rm(leftover, { recursive: true, force: true });
  } finally {
    await f.cleanup();
  }
});
