// R1 publish settlement: direct `Projects` unit tests for the post-commit
// history stage. `recordComposeHistory` is the instance seam, so these tests can
// simulate any history-stage failure (read/snapshot/entries/ops/state) without
// production fault injection, and assert the three-state contract:
// clear failure keeps the old state, clear commit returns the real new revision,
// unknown outcome is explicitly `uncertain: true`.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Projects } from "../src/projects.mjs";
import { loadManagedRegistry } from "../src/registry.mjs";
import { WorkerError } from "../src/errors.mjs";

const base = fileURLToPath(new URL("../", import.meta.url));
const TEMPLATE = "product-launch-v1";

function composition({ text = "settlement", duration = 5 } = {}) {
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>settlement ${text}</title>
<script src="./assets/gsap.min.js"></script>
</head>
<body>
<div id="main" data-composition-id="main" data-width="1280" data-height="720" data-fps="30" data-start="0" data-duration="${duration}">
<div style="position:absolute;left:120px;top:240px;color:#fff;font-size:64px">${text}</div>
<script>
const tl = gsap.timeline({ paused: true });
tl.fromTo("div", { opacity: 0 }, { opacity: 1, duration: 1 }, 0);
window.__timelines = { main: tl };
tl.seek(0);
</script>
</div>
</body>
</html>
`;
}

async function directStore() {
  await mkdir(resolve(base, "artifacts"), { recursive: true });
  const dir = await mkdtemp(resolve(base, "artifacts/settlement-"));
  const projectsRoot = resolve(dir, "projects");
  const outputRoot = resolve(dir, "output");
  const assetInboxRoot = resolve(dir, "inbox");
  const dataPath = resolve(dir, "registry-data.json");
  await mkdir(projectsRoot, { recursive: true });
  await mkdir(outputRoot, { recursive: true });
  await mkdir(assetInboxRoot, { recursive: true });
  await writeFile(dataPath, JSON.stringify({ projects: {} }));
  const loaded = await loadManagedRegistry({
    projectsRoot,
    registryPath: dataPath,
    outputRoot,
    assetInboxRoot,
  });
  const config = {
    projectsRoot,
    registryPath: dataPath,
    outputRoot,
    assetInboxRoot,
    root: loaded.root,
    projects: loaded.projects,
    managed: true,
  };
  const diagnostics = [];
  const store = new Projects(config, {
    diagnostic: (stage) => diagnostics.push(stage),
  });
  await store.initialize();
  const created = await store.createProject({ templateId: TEMPLATE });
  return {
    store,
    projectId: created.projectId,
    revision: created.revision,
    diagnostics,
    cleanup: async () => {
      await store.shutdown().catch(() => {});
      await rm(dir, { recursive: true, force: true });
    },
  };
}

test("compose returns degraded success when the history stage throws (direct Projects)", async () => {
  const f = await directStore();
  try {
    const candidate = composition({ text: "degraded" });
    const original = f.store.recordComposeHistory;
    f.store.recordComposeHistory = async () => {
      throw new Error("injected history-stage failure");
    };
    let result;
    try {
      result = await f.store.compose(f.projectId, {
        projectId: f.projectId,
        expectedRevision: f.revision,
        operationId: "settlement-degraded",
        html: candidate,
      });
    } finally {
      f.store.recordComposeHistory = original;
    }
    // The publish is real: authoritative commit happened before the history
    // stage, so the result is a success with the real new revision.
    assert.equal(result.written, true);
    assert.equal(result.unchanged, false);
    assert.notEqual(result.revision, f.revision);
    assert.equal(result.publishedRevision, result.revision);
    assert.deepEqual(result.preview, {
      mode: "snapshot",
      status: "ready",
      checked: "composition+snapshot",
      revision: result.revision,
    });
    assert.deepEqual(result.history, { status: "degraded", code: "E_HISTORY" });
    // Public read paths agree with the returned publishedRevision.
    const published = await f.store.source(f.projectId);
    assert.equal(published.revision, result.revision);
    assert.equal(published.html, candidate);
    const inspected = await f.store.inspect(f.projectId);
    assert.equal(inspected.revision, result.revision);
    // Failure detail is diagnostic-only and bounded (no path/message leak).
    assert.ok(f.diagnostics.includes("compose history degraded"));
    for (const stage of f.diagnostics)
      assert.doesNotMatch(stage, /injected|settlement-|EACCES|\/Users\//);

    // With the seam restored, the next publish records history normally.
    const recorded = await f.store.compose(f.projectId, {
      projectId: f.projectId,
      expectedRevision: result.revision,
      operationId: "settlement-recorded",
      html: composition({ text: "recorded" }),
    });
    assert.equal(recorded.written, true);
    assert.equal(recorded.history.status, "recorded");
    assert.ok(Number.isInteger(recorded.history.historyCursor));
    assert.equal(
      (await f.store.source(f.projectId)).revision,
      recorded.revision,
    );
  } finally {
    await f.cleanup();
  }
});

test("compose reports typed uncertain E_PERSIST when preview proof and rollback both fail", async () => {
  const f = await directStore();
  try {
    const originalPreviewCreate = f.store.previews.create.bind(f.store.previews);
    const originalRestoreEntry = f.store.restoreEntry.bind(f.store);
    f.store.previews.create = async () => {
      throw Object.assign(new Error("injected preview failure"), {
        code: "EACCES",
      });
    };
    f.store.restoreEntry = async () => false;
    let error;
    try {
      await f.store.compose(f.projectId, {
        projectId: f.projectId,
        expectedRevision: f.revision,
        operationId: "settlement-uncertain",
        html: composition({ text: "uncertain" }),
      });
    } catch (caught) {
      error = caught;
    } finally {
      f.store.previews.create = originalPreviewCreate;
      f.store.restoreEntry = originalRestoreEntry;
    }
    assert.ok(error instanceof WorkerError, String(error));
    assert.equal(error.code, "E_PERSIST");
    assert.equal(error.stage, "persist");
    assert.equal(error.uncertain, true);
    // No injected message or filesystem path leaks into the public error.
    assert.doesNotMatch(String(error.message), /injected|EACCES|\/Users\//);
  } finally {
    await f.cleanup();
  }
});
