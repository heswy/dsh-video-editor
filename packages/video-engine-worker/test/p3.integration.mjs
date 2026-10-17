import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { resolve } from "node:path";
import { base, client } from "./helpers.mjs";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
const TEMPLATE = "product-launch-v1";
const spec = (title, duration = 4, extra = {}) => ({
  title,
  duration,
  subtitle: `${title} 副标题`,
  badge: "AI",
  ...extra,
});

async function managed() {
  const dir = await mkdtemp(resolve(base, "artifacts/p3-"));
  const projectsRoot = resolve(dir, "projects");
  const registryPath = resolve(dir, "registry.json");
  const outputRoot = resolve(dir, "output");
  const assetInboxRoot = resolve(dir, "inbox");
  await mkdir(projectsRoot, { recursive: true });
  await mkdir(outputRoot, { recursive: true });
  await mkdir(assetInboxRoot, { recursive: true });
  await writeFile(registryPath.replace("registry.json", "registry-data.json"), JSON.stringify({ projects: {} }));
  const configPath = resolve(dir, "registry.json");
  await writeFile(
    configPath,
    JSON.stringify({
      projectsRoot,
      registryPath: resolve(dir, "registry-data.json"),
      outputRoot,
      assetInboxRoot,
    }),
  );
  await writeFile(resolve(assetInboxRoot, "logo.png"), PNG);
  await writeFile(resolve(assetInboxRoot, "notes.txt"), "not an image");
  await writeFile(resolve(assetInboxRoot, "large.png"), Buffer.alloc(9 * 1024 * 1024));
  const clients = [];
  let current = client(configPath);
  clients.push(current);
  const readRegistry = async () =>
    JSON.parse(await readFile(resolve(dir, "registry-data.json"), "utf8"));
  return {
    dir,
    get c() {
      return current;
    },
    set c(value) {
      current = value;
      clients.push(value);
    },
    projectsRoot,
    configPath,
    readRegistry,
    async restart() {
      await current.stop();
      current = client(configPath);
      clients.push(current);
      return current;
    },
    async cleanup() {
      for (const candidate of clients) await candidate.stop().catch(() => {});
      await rm(dir, { recursive: true, force: true });
    },
  };
}

async function created(c, extra = {}) {
  const created = await c.call("project.create", {
    templateId: TEMPLATE,
    title: "AI 生成样例",
    assets: [{ inboxName: "logo.png", name: "logo.png" }],
    ...extra,
  });
  assert.equal(created.ok, true, JSON.stringify(created));
  return created.result;
}

async function scenesOf(c, projectId) {
  const inspected = await c.call("inspect", { projectId });
  assert.equal(inspected.ok, true, JSON.stringify(inspected));
  return inspected.result;
}

test("project.create manages projectsRoot, registry and assets; inspect derives scenes", async () => {
  const f = await managed();
  try {
    const project = await created(f.c);
    assert.match(project.projectId, /^proj-[a-z0-9-]+$/);
    assert.equal(project.templateId, TEMPLATE);
    assert.equal(project.scenes.length, 1);
    assert.equal(project.scenes[0].sceneId, "scene-1");
    const registry = await f.readRegistry();
    assert.ok(registry.projects[project.projectId]);
    const inspected = await scenesOf(f.c, project.projectId);
    assert.equal(inspected.scenes.length, 1);
    assert.ok(inspected.elements.every((element) => "sceneId" in element));
    assert.ok(
      inspected.scenes[0].elements.some(
        (element) => element.stableId === "scene-1-title" && element.sceneId === "scene-1",
      ),
    );
    const assets = inspected.files.map((file) => file.path);
    assert.ok(assets.includes("assets/gsap.min.js"));
    assert.ok(assets.includes("assets/logo.png"));
  } finally {
    await f.cleanup();
  }
});

test("scene create/update/reorder/remove are revision-checked and atomic", async () => {
  const f = await managed();
  try {
    let project = await created(f.c);
    const createdA = await f.c.call("scene.create", {
      projectId: project.projectId,
      expectedRevision: project.revision,
      operationId: "c1",
      template: spec("第二幕", 4),
    });
    assert.equal(createdA.ok, true, JSON.stringify(createdA));
    const createdB = await f.c.call("scene.create", {
      projectId: project.projectId,
      expectedRevision: createdA.result.revision,
      operationId: "c2",
      template: spec("第三幕", 3, { sceneId: "finale" }),
      afterSceneId: "scene-1",
    });
    assert.equal(createdB.ok, true, JSON.stringify(createdB));
    let inspected = await scenesOf(f.c, project.projectId);
    assert.deepEqual(
      inspected.scenes.map((scene) => [scene.sceneId, scene.start, scene.duration]),
      [
        ["scene-1", 0, 5],
        ["finale", 5, 3],
        ["scene-2", 8, 4],
      ],
    );
    const beforeFile = await readFile(
      resolve(f.projectsRoot, project.projectId, "index.html"),
    );
    const stale = await f.c.call("scene.update", {
      projectId: project.projectId,
      expectedRevision: project.revision,
      operationId: "stale",
      sceneId: "scene-1",
      template: spec("过期写入"),
    });
    assert.equal(stale.ok, false);
    assert.equal(stale.error.code, "E_REVISION_CONFLICT");
    const afterFile = await readFile(
      resolve(f.projectsRoot, project.projectId, "index.html"),
    );
    assert.equal(afterFile.toString(), beforeFile.toString());

    const invalid = await f.c.call("scene.update", {
      projectId: project.projectId,
      expectedRevision: createdB.result.revision,
      operationId: "bad",
      sceneId: "scene-1",
      template: { ...spec("坏场景"), duration: 0.1 },
    });
    assert.equal(invalid.ok, false);
    assert.equal(invalid.error.code, "E_PARAMS");

    const reordered = await f.c.call("scene.reorder", {
      projectId: project.projectId,
      expectedRevision: createdB.result.revision,
      operationId: "order",
      order: ["finale", "scene-1", "scene-2"],
    });
    assert.equal(reordered.ok, true, JSON.stringify(reordered));
    inspected = await scenesOf(f.c, project.projectId);
    assert.deepEqual(
      inspected.scenes.map((scene) => [scene.sceneId, scene.start]),
      [
        ["finale", 0],
        ["scene-1", 3],
        ["scene-2", 8],
      ],
    );
    const removed = await f.c.call("scene.remove", {
      projectId: project.projectId,
      expectedRevision: reordered.result.revision,
      operationId: "remove",
      sceneId: "finale",
    });
    assert.equal(removed.ok, true, JSON.stringify(removed));
    inspected = await scenesOf(f.c, project.projectId);
    assert.equal(inspected.scenes.length, 2);
    assert.equal(inspected.duration, 9);
  } finally {
    await f.cleanup();
  }
});

test("asset.import validates inbox path, signature and size limits", async () => {
  const f = await managed();
  try {
    const project = await created(f.c);
    const ok = await f.c.call("asset.import", {
      projectId: project.projectId,
      expectedRevision: project.revision,
      operationId: "asset-1",
      sourceName: "logo.png",
      name: "brand.png",
    });
    assert.equal(ok.ok, true, JSON.stringify(ok));
    assert.equal(ok.result.asset.path, "assets/brand.png");
    assert.equal(ok.result.asset.mediaType, "image/png");
    const second = await f.c.call("asset.import", {
      projectId: project.projectId,
      expectedRevision: ok.result.revision,
      operationId: "asset-2",
      sourceName: "logo.png",
      name: "brand2.png",
    });
    assert.equal(second.ok, true, JSON.stringify(second));
    const text = await f.c.call("asset.import", {
      projectId: project.projectId,
      expectedRevision: second.result.revision,
      operationId: "asset-3",
      sourceName: "notes.txt",
      name: "notes.txt",
    });
    assert.equal(text.ok, false);
    assert.equal(text.error.code, "E_PARAMS");
    const traversal = await f.c.call("asset.import", {
      projectId: project.projectId,
      expectedRevision: second.result.revision,
      operationId: "asset-4",
      sourceName: "../logo.png",
      name: "escape.png",
    });
    assert.equal(traversal.ok, false);
    assert.equal(traversal.error.code, "E_PARAMS");
    const oversized = await f.c.call("asset.import", {
      projectId: project.projectId,
      expectedRevision: second.result.revision,
      operationId: "asset-5",
      sourceName: "large.png",
      name: "large.png",
    });
    assert.equal(oversized.ok, false);
    assert.equal(oversized.error.code, "E_LIMIT");
    const inspected = await scenesOf(f.c, project.projectId);
    assert.ok(inspected.files.some((file) => file.path === "assets/brand.png"));
  } finally {
    await f.cleanup();
  }
});

test("project.revise merges AI candidates with human edits and returns explicit conflicts", async () => {
  const f = await managed();
  try {
    const project = await created(f.c);
    const projectId = project.projectId;
    const baseRevision = project.revision;

    // No human change: base === expected, direct template write.
    const direct = await f.c.call("project.revise", {
      projectId,
      baseRevision,
      expectedRevision: baseRevision,
      operationId: "rev-1",
      sceneId: "scene-1",
      template: spec("AI 无人工改动", 5),
    });
    assert.equal(direct.ok, true, JSON.stringify(direct));
    assert.equal(direct.result.written, true);
    assert.ok(direct.result.changeSummary.adopted.includes("scene-1-title"));

    // Human typed edit, then AI changes a different object: merge succeeds.
    const beforeHuman = (await scenesOf(f.c, projectId)).revision;
    const human = await f.c.call("edit", {
      projectId,
      expectedRevision: beforeHuman,
      operationId: "human-title",
      ops: [{ type: "text", target: "scene-1-title", text: "人工标题" }],
    });
    assert.equal(human.ok, true, JSON.stringify(human));
    const merged = await f.c.call("project.revise", {
      projectId,
      baseRevision: beforeHuman,
      expectedRevision: human.result.revision,
      operationId: "rev-2",
      sceneId: "scene-1",
      template: spec("AI 无人工改动", 5, { subtitle: "AI 改写的副标题" }),
    });
    assert.equal(merged.ok, true, JSON.stringify(merged));
    assert.equal(merged.result.written, true);
    const afterMerge = await scenesOf(f.c, projectId);
    const title = afterMerge.elements.find(
      (element) => element.stableId === "scene-1-title",
    );
    assert.equal(title.text, "人工标题");
    assert.ok(
      afterMerge.scenes[0].elements.find(
        (element) => element.stableId === "scene-1-subtitle",
      ).text.includes("AI 改写的副标题"),
    );

    // Both modified title: explicit conflict, no write.
    const conflictBase = afterMerge.revision;
    const human2 = await f.c.call("edit", {
      projectId,
      expectedRevision: conflictBase,
      operationId: "human-title-2",
      ops: [{ type: "text", target: "scene-1-title", text: "人工再次改标题" }],
    });
    const conflict = await f.c.call("project.revise", {
      projectId,
      baseRevision: conflictBase,
      expectedRevision: human2.result.revision,
      operationId: "rev-3",
      sceneId: "scene-1",
      template: spec("AI 竞争标题", 5, { subtitle: "AI 改写的副标题" }),
    });
    assert.equal(conflict.ok, true, JSON.stringify(conflict));
    assert.equal(conflict.result.written, false);
    assert.equal(conflict.result.conflicts[0].reason, "BOTH_MODIFIED");
    assert.equal(conflict.result.conflicts[0].stableId, "scene-1-title");
    assert.equal(
      (await scenesOf(f.c, projectId)).revision,
      human2.result.revision,
      "conflict must not write",
    );

    // AI deletes a subtitle the human edited: conflict.
    const deleteBase = human2.result.revision;
    const human3 = await f.c.call("edit", {
      projectId,
      expectedRevision: deleteBase,
      operationId: "human-subtitle",
      ops: [
        {
          type: "text",
          target: "scene-1-subtitle",
          text: "人工副标题",
        },
      ],
    });
    const deletion = await f.c.call("project.revise", {
      projectId,
      baseRevision: deleteBase,
      expectedRevision: human3.result.revision,
      operationId: "rev-4",
      sceneId: "scene-1",
      template: { title: "AI 标题", duration: 5 },
    });
    assert.equal(deletion.ok, true, JSON.stringify(deletion));
    assert.equal(deletion.result.written, false);
    assert.equal(
      deletion.result.conflicts[0].reason,
      "AI_DELETE_HUMAN_MODIFY",
    );

    const missing = await f.c.call("project.revise", {
      projectId,
      baseRevision: "0".repeat(64),
      expectedRevision: human3.result.revision,
      operationId: "rev-missing",
      sceneId: "scene-1",
      template: spec("缺少 base", 5),
    });
    assert.equal(missing.ok, false);
    assert.equal(missing.error.code, "E_BASE_MISSING");
  } finally {
    await f.cleanup();
  }
});

test("history/undo/redo survive a worker restart; history is not part of revision", async () => {
  const f = await managed();
  try {
    const project = await created(f.c);
    const projectId = project.projectId;
    const first = await f.c.call("history", { projectId });
    assert.equal(first.ok, true, JSON.stringify(first));
    assert.equal(first.result.canUndo, false);
    assert.equal(first.result.entries.length, 1);
    const created2 = await f.c.call("scene.create", {
      projectId,
      expectedRevision: project.revision,
      operationId: "c1",
      template: spec("第二幕", 4),
    });
    assert.equal(created2.ok, true);
    const edited = await f.c.call("edit", {
      projectId,
      expectedRevision: created2.result.revision,
      operationId: "et",
      ops: [{ type: "text", target: "scene-2-title", text: "人工改第二幕" }],
    });
    const history = await f.c.call("history", { projectId });
    assert.equal(history.result.entries.length, 3);
    assert.equal(history.result.canUndo, true);
    assert.ok(history.result.historyCursor >= 2);
    const editedBytes = await readFile(
      resolve(f.projectsRoot, projectId, "index.html"),
    );
    const undo = await f.c.call("undo", {
      projectId,
      expectedRevision: edited.result.revision,
      operationId: "u1",
    });
    assert.equal(undo.ok, true, JSON.stringify(undo));
    assert.equal(undo.result.revision, created2.result.revision);
    assert.ok(undo.result.historyCursor > history.result.historyCursor);
    const undoInspect = await scenesOf(f.c, projectId);
    assert.equal(undoInspect.revision, created2.result.revision);
    assert.notEqual(
      (await readFile(resolve(f.projectsRoot, projectId, "index.html"))).toString(),
      editedBytes.toString(),
    );
    const redo = await f.c.call("redo", {
      projectId,
      expectedRevision: undo.result.revision,
      operationId: "r1",
    });
    assert.equal(redo.ok, true, JSON.stringify(redo));
    assert.equal(redo.result.revision, edited.result.revision);
    assert.equal(
      (await readFile(resolve(f.projectsRoot, projectId, "index.html"))).toString(),
      editedBytes.toString(),
    );

    // Restart the worker against the same registry: history persists.
    await f.restart();
    const reopened = await f.c.call("open", { projectId });
    assert.equal(reopened.ok, true);
    const historyAfter = await f.c.call("history", { projectId });
    assert.equal(historyAfter.result.canUndo, true);
    assert.ok(historyAfter.result.entries.length >= 3);
    const undoAfterRestart = await f.c.call("undo", {
      projectId,
      expectedRevision: reopened.result.revision,
      operationId: "u2",
    });
    assert.equal(undoAfterRestart.ok, true, JSON.stringify(undoAfterRestart));
    assert.equal(undoAfterRestart.result.revision, created2.result.revision);
  } finally {
    await f.cleanup();
  }
});
