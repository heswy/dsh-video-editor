import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { base, client, fixture } from "./helpers.mjs";

/**
 * P3-016: `project.rename` is UI metadata, not project content.
 *
 * The test drives the real worker process: the title is trimmed into
 * `project.json` atomically while `index.html`, the declared assets, the
 * content revision and the history files stay byte-identical.
 */

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nXQAAAAASUVORK5CYII=",
  "base64",
);

async function managed() {
  await mkdir(resolve(base, "artifacts"), { recursive: true });
  const dir = await mkdtemp(resolve(base, "artifacts/rename-"));
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
  const c = client(configPath);
  return {
    dir,
    configPath,
    projectDir: (projectId) => resolve(projectsRoot, projectId),
    c,
    async cleanup() {
      await c.stop().catch(() => {});
      await rm(dir, { recursive: true, force: true });
    },
  };
}

test("project.rename writes only the manifest title and keeps revision/history", async () => {
  const f = await fixture();
  const c = client(f.registry);
  try {
    const manifestPath = resolve(f.project, "project.json");
    const entryPath = resolve(f.project, "index.html");
    const manifestBefore = JSON.parse(await readFile(manifestPath, "utf8"));
    const entryBefore = await readFile(entryPath);
    // Legacy project.json without title: inspect reports null, not a guess.
    const opened = await c.call("open", { projectId: "demo" });
    assert.equal(opened.ok, true, JSON.stringify(opened));
    assert.equal(opened.result.title, null, "a legacy project must report a null title");
    const revision = opened.result.revision;

    const renamed = await c.call("project.rename", {
      projectId: "demo",
      title: "  球的自述  ",
    });
    assert.equal(renamed.ok, true, JSON.stringify(renamed));
    assert.deepEqual(
      {
        projectId: renamed.result.projectId,
        revision: renamed.result.revision,
        title: renamed.result.title,
        changed: renamed.result.changed,
      },
      { projectId: "demo", revision, title: "球的自述", changed: true },
    );

    const manifestAfter = JSON.parse(await readFile(manifestPath, "utf8"));
    assert.deepEqual(manifestAfter, {
      entry: manifestBefore.entry,
      assets: manifestBefore.assets,
      title: "球的自述",
    });
    assert.deepEqual(
      await readFile(entryPath),
      entryBefore,
      "rename must not rewrite the composition entry",
    );
    // A legacy project has no history; a rename must not invent one.
    await assert.rejects(readFile(resolve(f.project, ".dsh-video/history/entries.jsonl")));

    const inspected = await c.call("inspect", { projectId: "demo" });
    assert.equal(inspected.result.revision, revision, "rename must not change the revision");
    assert.equal(inspected.result.title, "球的自述");

    // Repeating the same title is an explicit unchanged success.
    const again = await c.call("project.rename", {
      projectId: "demo",
      title: "球的自述",
    });
    assert.deepEqual(
      { title: again.result.title, revision: again.result.revision, changed: again.result.changed },
      { title: "球的自述", revision, changed: false },
    );

    // Params reject empty/blank/oversized/non-string titles before writing.
    for (const title of ["", "   ", "x".repeat(121), 7, null]) {
      const rejected = await c.call("project.rename", { projectId: "demo", title });
      assert.equal(rejected.error?.code, "E_PARAMS", `accepted title ${JSON.stringify(title)}`);
    }
    assert.equal(
      (await c.call("project.rename", { projectId: "demo" })).error?.code,
      "E_PARAMS",
    );
    assert.equal(
      (await c.call("project.rename", { projectId: "demo", title: "x", extra: 1 })).error?.code,
      "E_PARAMS",
    );
    assert.equal(
      (await c.call("project.rename", { projectId: "unknown", title: "x" })).error?.code,
      "E_PROJECT_NOT_OPEN",
    );

    // A closed project is not active: rename must fail and keep the title.
    await c.call("close", { projectId: "demo" });
    assert.equal(
      (await c.call("project.rename", { projectId: "demo", title: "closed" })).error?.code,
      "E_PROJECT_NOT_OPEN",
    );
    assert.equal(
      JSON.parse(await readFile(manifestPath, "utf8")).title,
      "球的自述",
      "a rejected rename changed the manifest",
    );
  } finally {
    await c.stop();
    await f.cleanup();
  }
});

test("project.rename persists across restart and asset import keeps the title", async () => {
  const f = await managed();
  let c = f.c;
  try {
    const created = await c.call("project.create", {
      templateId: "product-launch-v1",
      title: "初始标题",
    });
    assert.equal(created.ok, true, JSON.stringify(created));
    const projectId = created.result.projectId;
    const dir = f.projectDir(projectId);
    const revision = created.result.revision;
    assert.equal(
      (await c.call("inspect", { projectId })).result.title,
      "初始标题",
      "project.create title was not stored",
    );

    // Rename changes the title only: history and entry bytes are untouched.
    const entryBefore = await readFile(resolve(dir, "index.html"));
    const historyBefore = await readFile(resolve(dir, ".dsh-video/history/entries.jsonl"));
    const renamed = await c.call("project.rename", { projectId, title: "  第二版标题  " });
    assert.equal(renamed.ok, true, JSON.stringify(renamed));
    assert.equal(renamed.result.revision, revision);
    assert.deepEqual(await readFile(resolve(dir, "index.html")), entryBefore);
    assert.deepEqual(await readFile(resolve(dir, ".dsh-video/history/entries.jsonl")), historyBefore);
    assert.deepEqual(
      JSON.parse(await readFile(resolve(dir, "project.json"), "utf8")),
      { entry: "index.html", assets: ["assets/gsap.min.js"], title: "第二版标题" },
    );

    // A later asset import rewrites project.json; the title must survive.
    const imported = await c.call("asset.import", {
      projectId,
      expectedRevision: revision,
      operationId: "rename-asset-import",
      sourceName: "logo.png",
      name: "logo.png",
    });
    assert.equal(imported.ok, true, JSON.stringify(imported));
    const postImportRevision = imported.result.revision;
    assert.notEqual(postImportRevision, revision);
    const importedInspect = await c.call("inspect", { projectId });
    assert.equal(importedInspect.result.title, "第二版标题", "asset.import dropped the project title");
    assert.deepEqual(
      JSON.parse(await readFile(resolve(dir, "project.json"), "utf8")).assets,
      ["assets/gsap.min.js", "assets/logo.png"],
    );

    // Renaming again after the import keeps the post-import revision/history.
    const entryAfterImport = await readFile(resolve(dir, "index.html"));
    const historyAfterImport = await readFile(resolve(dir, ".dsh-video/history/entries.jsonl"));
    const finalRename = await c.call("project.rename", { projectId, title: "第三版标题" });
    assert.equal(finalRename.result.changed, true);
    assert.equal(finalRename.result.revision, postImportRevision);
    assert.deepEqual(await readFile(resolve(dir, "index.html")), entryAfterImport);
    assert.deepEqual(await readFile(resolve(dir, ".dsh-video/history/entries.jsonl")), historyAfterImport);

    // Restart: the title is durable metadata next to the content.
    await c.stop();
    c = client(f.configPath);
    const reopened = await c.call("open", { projectId });
    assert.equal(reopened.ok, true, JSON.stringify(reopened));
    assert.equal(reopened.result.revision, postImportRevision);
    assert.equal(reopened.result.title, "第三版标题");
  } finally {
    await c.stop().catch(() => {});
    await f.cleanup();
  }
});
