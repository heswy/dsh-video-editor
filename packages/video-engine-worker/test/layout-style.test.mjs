import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { base, client, fixture, managed } from "./helpers.mjs";
import { parseDocument } from "../src/scenes.mjs";
import { validate } from "./schema-validator.mjs";

const TEMPLATE = "product-launch-v1";
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

const sceneSpec = (overrides = {}) => ({
  duration: 5,
  title: "场景标题",
  subtitle: "场景副标题",
  badge: "AI",
  logo: "assets/logo.png",
  ...overrides,
});

async function created(c, extra = {}) {
  const response = await c.call("project.create", {
    templateId: TEMPLATE,
    title: "布局样式测试",
    assets: [{ inboxName: "logo.png", name: "logo.png" }],
    ...extra,
  });
  assert.equal(response.ok, true, JSON.stringify(response));
  return response.result;
}

async function inspected(c, projectId) {
  const response = await c.call("inspect", { projectId });
  assert.equal(response.ok, true, JSON.stringify(response));
  return response.result;
}

function element(result, stableId) {
  return result.elements.find((entry) => entry.stableId === stableId);
}

function sceneElement(result, stableId) {
  return result.scenes
    .flatMap((scene) => scene.elements)
    .find((entry) => entry.stableId === stableId);
}

async function readProjectHtml(f, projectId) {
  return readFile(resolve(f.projectsRoot, projectId, "index.html"), "utf8");
}

async function addShotScene(c, projectId, revision) {
  const response = await c.call("scene.update", {
    projectId,
    expectedRevision: revision,
    operationId: "add-visual-assets",
    sceneId: "scene-1",
    template: sceneSpec({ title: "场景标题" }),
  });
  assert.equal(response.ok, true, JSON.stringify(response));
  return response.result.revision;
}

test("inspect exposes normalized layout/style and capabilities for template leaves only", async () => {
  const f = await managed("layout-inspect");
  try {
    const project = await created(f.c);
    const revision = await addShotScene(f.c, project.projectId, project.revision);
    const inspectedResult = await inspected(f.c, project.projectId);
    assert.equal(inspectedResult.revision, revision);

    const title = element(inspectedResult, "scene-1-title");
    assert.deepEqual(title.layout, { left: 88, top: 196, width: 980, height: null });
    assert.deepEqual(title.style, {
      color: null,
      fontSize: 64,
      fontWeight: 600,
      textAlign: null,
    });
    assert.deepEqual(title.capabilities, ["text", "timing", "layout", "style"]);

    const subtitle = element(inspectedResult, "scene-1-subtitle");
    assert.deepEqual(subtitle.layout, { left: 90, top: 330, width: null, height: null });
    assert.ok(subtitle.capabilities.includes("layout"));
    assert.ok(subtitle.capabilities.includes("style"));

    const logo = element(inspectedResult, "scene-1-logo");
    assert.deepEqual(logo.layout, { left: 1030, top: 88, width: 140, height: 140 });
    assert.equal(logo.style, null);
    assert.deepEqual(logo.capabilities, ["layout"]);

    const rule = element(inspectedResult, "scene-1-rule");
    assert.deepEqual(rule.layout, { left: 88, top: 560, width: 1104, height: 2 });
    assert.equal(rule.style, null);
    assert.deepEqual(rule.capabilities, ["text", "timing", "layout"]);

    const section = element(inspectedResult, "scene-1-section");
    assert.equal(section.layout, null);
    assert.equal(section.style, null);
    const root = element(inspectedResult, "hf-main");
    assert.equal(root.layout, null);
    assert.equal(root.style, null);

    // inspect.scenes[].elements carry the same managed view.
    assert.deepEqual(sceneElement(inspectedResult, "scene-1-title").layout, title.layout);
    assert.deepEqual(sceneElement(inspectedResult, "scene-1-logo").layout, logo.layout);
  } finally {
    await f.cleanup();
  }

  // Legacy P2 fixture keeps the old inspect contract (no managed fields).
  const legacy = await fixture();
  const legacyClient = client(legacy.registry);
  try {
    const opened = await legacyClient.call("open", { projectId: "demo" });
    assert.equal(opened.ok, true, JSON.stringify(opened));
    for (const entry of opened.result.elements) {
      assert.equal(entry.layout, null);
      assert.equal(entry.style, null);
      assert.ok(!entry.capabilities.includes("layout"));
      assert.ok(!entry.capabilities.includes("style"));
    }
    const unsupported = await legacyClient.call("edit", {
      projectId: "demo",
      expectedRevision: opened.result.revision,
      operationId: "legacy-layout",
      ops: [
        {
          type: "layout",
          target: "hf-title",
          unit: "composition-px",
          box: { left: 10 },
        },
      ],
    });
    assert.equal(unsupported.ok, false);
    assert.equal(unsupported.error.code, "E_UNSUPPORTED_EDIT");
  } finally {
    await legacyClient.stop();
    await legacy.cleanup();
  }
});

test("layout/style writes persist through inspect, HTML, snapshots, reopen and worker restart", async () => {
  const f = await managed("layout-persist");
  try {
    const project = await created(f.c);
    const projectId = project.projectId;
    let revision = await addShotScene(f.c, projectId, project.revision);
    const original = await inspected(f.c, projectId);
    const beforeSnapshot = await f.c.call("preview.snapshot", {
      projectId,
      revision,
    });
    assert.equal(beforeSnapshot.ok, true, JSON.stringify(beforeSnapshot));
    const oldSnapshotDir = resolve(
      f.outputRoot,
      "previews",
      beforeSnapshot.result.snapshotId,
    );
    const oldEntry = await readFile(resolve(oldSnapshotDir, "index.html"));
    const oldEntryHash = beforeSnapshot.result.files.find(
      (file) => file.path === "index.html",
    ).sha256;
    assert.equal(sha256(oldEntry), oldEntryHash);

    const edit = await f.c.call("edit", {
      projectId,
      expectedRevision: revision,
      operationId: "persist-mixed",
      ops: [
        { type: "text", target: "scene-1-title", text: "人工改标题" },
        {
          type: "layout",
          target: "scene-1-title",
          unit: "composition-px",
          box: { left: 120.12345, top: 240 },
        },
        {
          type: "style",
          target: "scene-1-title",
          styles: {
            color: "#FF0000",
            fontSize: 72,
            fontWeight: 700,
            textAlign: "center",
          },
        },
        {
          type: "layout",
          target: "scene-1-logo",
          unit: "composition-px",
          box: { left: 600, top: 360, width: 600, height: 320 },
        },
      ],
    });
    assert.equal(edit.ok, true, JSON.stringify(edit));
    revision = edit.result.revision;
    assert.notEqual(revision, original.revision);

    const afterEdit = await inspected(f.c, projectId);
    const title = element(afterEdit, "scene-1-title");
    assert.equal(title.text, "人工改标题");
    assert.deepEqual(title.layout, { left: 120.123, top: 240, width: 980, height: null });
    assert.deepEqual(title.style, {
      color: "#ff0000",
      fontSize: 72,
      fontWeight: 700,
      textAlign: "center",
    });
    assert.deepEqual(element(afterEdit, "scene-1-logo").layout, {
      left: 600,
      top: 360,
      width: 600,
      height: 320,
    });

    const html = await readProjectHtml(f, projectId);
    assert.match(html, /left:\s*120\.123px/);
    assert.match(html, /top:\s*240px/);
    assert.match(html, /color:\s*#ff0000/);
    assert.match(html, /font-size:\s*72px/);
    assert.match(html, /font-weight:\s*700/);
    assert.match(html, /text-align:\s*center/);
    assert.match(html, /width:\s*600px/);
    assert.match(html, /height:\s*320px/);
    assert.doesNotMatch(html, /transform:/);

    // The old snapshot is immutable even though the project moved on.
    assert.deepEqual(await readFile(resolve(oldSnapshotDir, "index.html")), oldEntry);

    const newSnapshot = await f.c.call("preview.snapshot", {
      projectId,
      revision,
    });
    assert.equal(newSnapshot.ok, true, JSON.stringify(newSnapshot));
    const newEntry = await readFile(
      resolve(f.outputRoot, "previews", newSnapshot.result.snapshotId, "index.html"),
      "utf8",
    );
    assert.match(newEntry, /left:\s*120\.123px/);
    assert.match(newEntry, /color:\s*#ff0000/);

    // close/reopen keeps overrides.
    await f.c.call("close", { projectId });
    let reopened = await f.c.call("open", { projectId });
    assert.equal(reopened.ok, true, JSON.stringify(reopened));
    let reopenedInspect = await inspected(f.c, projectId);
    assert.equal(reopenedInspect.revision, revision);
    assert.deepEqual(element(reopenedInspect, "scene-1-title").layout, title.layout);
    assert.deepEqual(element(reopenedInspect, "scene-1-title").style, title.style);

    // Full worker restart keeps overrides (content hash authoritative).
    await f.restart();
    reopened = await f.c.call("open", { projectId });
    assert.equal(reopened.ok, true, JSON.stringify(reopened));
    reopenedInspect = await inspected(f.c, projectId);
    assert.equal(reopenedInspect.revision, revision);
    assert.deepEqual(element(reopenedInspect, "scene-1-title").layout, title.layout);
    assert.deepEqual(element(reopenedInspect, "scene-1-title").style, title.style);
    assert.deepEqual(element(reopenedInspect, "scene-1-logo").layout, {
      left: 600,
      top: 360,
      width: 600,
      height: 320,
    });
  } finally {
    await f.cleanup();
  }
});

test("layout/style params are strict, capability-scoped and atomic; operation ids stay idempotent", async () => {
  const f = await managed("layout-validation");
  try {
    const project = await created(f.c);
    const projectId = project.projectId;
    let revision = await addShotScene(f.c, projectId, project.revision);
    const stable = async () => (await inspected(f.c, projectId)).revision;
    const expectError = async (operationId, ops, code) => {
      const response = await f.c.call("edit", {
        projectId,
        expectedRevision: revision,
        operationId,
        ops,
      });
      assert.equal(response.ok, false, JSON.stringify(response));
      assert.equal(response.error.code, code, JSON.stringify(response));
      assert.equal(await stable(), revision, "invalid edit must not write");
    };

    await expectError("bad-empty", [{ type: "layout", target: "scene-1-title", unit: "composition-px", box: {} }], "E_PARAMS");
    await expectError("bad-key", [{ type: "layout", target: "scene-1-title", unit: "composition-px", box: { x: 10 } }], "E_PARAMS");
    await expectError("bad-string", [{ type: "layout", target: "scene-1-title", unit: "composition-px", box: { left: "10" } }], "E_PARAMS");
    await expectError("bad-negative", [{ type: "layout", target: "scene-1-title", unit: "composition-px", box: { left: -1 } }], "E_PARAMS");
    await expectError("bad-width", [{ type: "layout", target: "scene-1-title", unit: "composition-px", box: { width: 0.5 } }], "E_PARAMS");
    await expectError("bad-unit", [{ type: "layout", target: "scene-1-title", unit: "px", box: { left: 10 } }], "E_PARAMS");
    await expectError("bad-overflow", [{ type: "layout", target: "scene-1-title", unit: "composition-px", box: { left: 1200 } }], "E_PARAMS");
    await expectError("bad-width-overflow", [{ type: "layout", target: "scene-1-logo", unit: "composition-px", box: { width: 2000 } }], "E_PARAMS");
    await expectError("bad-style-key", [{ type: "style", target: "scene-1-title", styles: { background: "#ffffff" } }], "E_PARAMS");
    await expectError("bad-color", [{ type: "style", target: "scene-1-title", styles: { color: "red" } }], "E_PARAMS");
    await expectError("bad-font-size", [{ type: "style", target: "scene-1-title", styles: { fontSize: 7 } }], "E_PARAMS");
    await expectError("bad-font-weight", [{ type: "style", target: "scene-1-title", styles: { fontWeight: 150 } }], "E_PARAMS");
    await expectError("bad-align", [{ type: "style", target: "scene-1-title", styles: { textAlign: "justify" } }], "E_PARAMS");
    await expectError("style-on-rule", [{ type: "style", target: "scene-1-rule", styles: { color: "#ffffff" } }], "E_UNSUPPORTED_EDIT");
    await expectError("style-on-image", [{ type: "style", target: "scene-1-logo", styles: { color: "#ffffff" } }], "E_UNSUPPORTED_EDIT");
    await expectError("layout-on-section", [{ type: "layout", target: "scene-1-section", unit: "composition-px", box: { left: 10 } }], "E_UNSUPPORTED_EDIT");
    await expectError("layout-on-root", [{ type: "layout", target: "hf-main", unit: "composition-px", box: { left: 10 } }], "E_UNSUPPORTED_EDIT");
    await expectError(
      "mixed-atomic",
      [
        { type: "text", target: "scene-1-title", text: "不应写入" },
        { type: "layout", target: "scene-1-title", unit: "composition-px", box: { left: -5 } },
      ],
      "E_PARAMS",
    );
    // The rejected atomic batch did not change the text either.
    assert.equal(element(await inspected(f.c, projectId), "scene-1-title").text, "场景标题");

    // Precision is normalized to 1/1000 px.
    const precisionExpectedRevision = revision;
    const precise = await f.c.call("edit", {
      projectId,
      expectedRevision: precisionExpectedRevision,
      operationId: "precision",
      ops: [
        { type: "layout", target: "scene-1-title", unit: "composition-px", box: { left: 10.12345, top: 20.98765 } },
        { type: "style", target: "scene-1-title", styles: { color: "#AABBCC", fontSize: 8 } },
      ],
    });
    assert.equal(precise.ok, true, JSON.stringify(precise));
    revision = precise.result.revision;
    let current = await inspected(f.c, projectId);
    assert.deepEqual(element(current, "scene-1-title").layout, {
      left: 10.123,
      top: 20.988,
      width: 980,
      height: null,
    });
    assert.equal(element(current, "scene-1-title").style.color, "#aabbcc");
    assert.equal(element(current, "scene-1-title").style.fontSize, 8);

    // Idempotent retry returns the first result; different content is rejected.
    const retry = await f.c.call("edit", {
      projectId,
      expectedRevision: precisionExpectedRevision,
      operationId: "precision",
      ops: [
        { type: "layout", target: "scene-1-title", unit: "composition-px", box: { left: 10.12345, top: 20.98765 } },
        { type: "style", target: "scene-1-title", styles: { color: "#AABBCC", fontSize: 8 } },
      ],
    });
    assert.equal(retry.ok, true);
    assert.equal(retry.result.revision, revision);
    const reused = await f.c.call("edit", {
      projectId,
      expectedRevision: revision,
      operationId: "precision",
      ops: [
        { type: "layout", target: "scene-1-title", unit: "composition-px", box: { left: 30 } },
      ],
    });
    assert.equal(reused.ok, false);
    assert.equal(reused.error.code, "E_OPERATION_REUSED");
    const stale = await f.c.call("edit", {
      projectId,
      expectedRevision: project.revision,
      operationId: "stale-layout",
      ops: [
        { type: "layout", target: "scene-1-title", unit: "composition-px", box: { left: 30 } },
      ],
    });
    assert.equal(stale.ok, false);
    assert.equal(stale.error.code, "E_REVISION_CONFLICT");

    // Cumulative bounds: two patches are validated against the effective box.
    const cumulative = await f.c.call("edit", {
      projectId,
      expectedRevision: revision,
      operationId: "cumulative",
      ops: [
        { type: "layout", target: "scene-1-logo", unit: "composition-px", box: { left: 1000 } },
        { type: "layout", target: "scene-1-logo", unit: "composition-px", box: { width: 400 } },
      ],
    });
    assert.equal(cumulative.ok, false);
    assert.equal(cumulative.error.code, "E_PARAMS");
    assert.equal(await stable(), revision);
  } finally {
    await f.cleanup();
  }
});

test("scene create/update/reorder preserve overrides; dropping an overridden object conflicts; remove reports impact", async () => {
  const f = await managed("layout-scenes");
  try {
    const project = await created(f.c);
    const projectId = project.projectId;
    let revision = await addShotScene(f.c, projectId, project.revision);
    const second = await f.c.call("scene.create", {
      projectId,
      expectedRevision: revision,
      operationId: "scenes-create-2",
      template: sceneSpec({ sceneId: "scene-2", title: "第二幕" }),
    });
    assert.equal(second.ok, true, JSON.stringify(second));
    revision = second.result.revision;

    const overrides = await f.c.call("edit", {
      projectId,
      expectedRevision: revision,
      operationId: "scenes-overrides",
      ops: [
        { type: "layout", target: "scene-1-title", unit: "composition-px", box: { left: 300, top: 250 } },
        { type: "style", target: "scene-1-title", styles: { fontSize: 80, color: "#112233" } },
        { type: "layout", target: "scene-1-subtitle", unit: "composition-px", box: { left: 150 } },
        { type: "layout", target: "scene-2-title", unit: "composition-px", box: { left: 220 } },
      ],
    });
    assert.equal(overrides.ok, true, JSON.stringify(overrides));
    revision = overrides.result.revision;

    const updated = await f.c.call("scene.update", {
      projectId,
      expectedRevision: revision,
      operationId: "scenes-update",
      sceneId: "scene-1",
      template: sceneSpec({ title: "改名后的第一幕", duration: 6 }),
    });
    assert.equal(updated.ok, true, JSON.stringify(updated));
    revision = updated.result.revision;
    assert.ok(updated.result.changeSummary.preservedOverrides >= 1);

    let current = await inspected(f.c, projectId);
    assert.equal(element(current, "scene-1-title").text, "改名后的第一幕");
    assert.deepEqual(element(current, "scene-1-title").layout, {
      left: 300,
      top: 250,
      width: 980,
      height: null,
    });
    assert.deepEqual(element(current, "scene-1-title").style, {
      color: "#112233",
      fontSize: 80,
      fontWeight: 600,
      textAlign: null,
    });
    assert.equal(element(current, "scene-1-subtitle").layout.left, 150);

    const reordered = await f.c.call("scene.reorder", {
      projectId,
      expectedRevision: revision,
      operationId: "scenes-reorder",
      order: ["scene-2", "scene-1"],
    });
    assert.equal(reordered.ok, true, JSON.stringify(reordered));
    revision = reordered.result.revision;
    current = await inspected(f.c, projectId);
    assert.deepEqual(element(current, "scene-1-title").layout, {
      left: 300,
      top: 250,
      width: 980,
      height: null,
    });
    assert.equal(element(current, "scene-1-subtitle").layout.left, 150);
    assert.equal(element(current, "scene-2-title").layout.left, 220);

    const third = await f.c.call("scene.create", {
      projectId,
      expectedRevision: revision,
      operationId: "scenes-create-3",
      template: sceneSpec({ sceneId: "scene-3", title: "第三幕", duration: 2 }),
    });
    assert.equal(third.ok, true, JSON.stringify(third));
    revision = third.result.revision;
    current = await inspected(f.c, projectId);
    assert.equal(element(current, "scene-1-title").layout.left, 300);

    // A scene rewrite that would drop the overridden subtitle must conflict.
    const drop = await f.c.call("scene.update", {
      projectId,
      expectedRevision: revision,
      operationId: "scenes-drop",
      sceneId: "scene-1",
      template: { title: "删副标题", duration: 6, badge: "AI" },
    });
    assert.equal(drop.ok, false, JSON.stringify(drop));
    assert.equal(drop.error.code, "E_OVERRIDE_CONFLICT");
    assert.equal((await inspected(f.c, projectId)).revision, revision);

    // Explicit whole-scene removal is allowed and reports the impact.
    const removed = await f.c.call("scene.remove", {
      projectId,
      expectedRevision: revision,
      operationId: "scenes-remove",
      sceneId: "scene-1",
    });
    assert.equal(removed.ok, true, JSON.stringify(removed));
    assert.ok(
      removed.result.changeSummary.droppedOverrides.some(
        (entry) => entry.stableId === "scene-1-title",
      ),
    );
  } finally {
    await f.cleanup();
  }
});

test("explicit override markers keep values equal to template defaults and protect them from later default changes", async () => {
  const f = await managed("layout-marker");
  try {
    const project = await created(f.c);
    const projectId = project.projectId;
    let revision = await addShotScene(f.c, projectId, project.revision);
    let current = await inspected(f.c, projectId);
    // Default subtitle color is the scene accent (#bfdbfe for scene-1 palette).
    const defaultAccent = element(current, "scene-1-subtitle").style.color;
    assert.equal(defaultAccent, "#bfdbfe");

    // Explicitly pick a color that equals the current default: without the
    // marker this would be indistinguishable from "not overridden".
    const marked = await f.c.call("edit", {
      projectId,
      expectedRevision: revision,
      operationId: "marker-style",
      ops: [
        {
          type: "style",
          target: "scene-1-subtitle",
          styles: { color: defaultAccent },
        },
        {
          type: "layout",
          target: "scene-1-title",
          unit: "composition-px",
          box: { left: 88 },
        },
      ],
    });
    assert.equal(marked.ok, true, JSON.stringify(marked));
    revision = marked.result.revision;
    const htmlWithMarkers = await readProjectHtml(f, projectId);
    assert.match(htmlWithMarkers, /data-dv-managed="[^"]*color[^"]*"/);
    assert.match(htmlWithMarkers, /data-dv-managed="[^"]*left[^"]*"/);

    // A later scene-level accent change must not silently rewrite the explicit
    // subtitle color, while the unmarked badge still follows the accent.
    const accentRed = await f.c.call("scene.update", {
      projectId,
      expectedRevision: revision,
      operationId: "marker-accent-red",
      sceneId: "scene-1",
      template: sceneSpec({ accent: "#ff0000" }),
    });
    assert.equal(accentRed.ok, true, JSON.stringify(accentRed));
    revision = accentRed.result.revision;
    current = await inspected(f.c, projectId);
    assert.equal(element(current, "scene-1-subtitle").style.color, defaultAccent);
    assert.equal(element(current, "scene-1-badge").style.color, "#ff0000");

    const accentGreen = await f.c.call("scene.update", {
      projectId,
      expectedRevision: revision,
      operationId: "marker-accent-green",
      sceneId: "scene-1",
      template: sceneSpec({ accent: "#00ff00" }),
    });
    assert.equal(accentGreen.ok, true, JSON.stringify(accentGreen));
    revision = accentGreen.result.revision;
    current = await inspected(f.c, projectId);
    assert.equal(element(current, "scene-1-subtitle").style.color, defaultAccent);
    assert.equal(element(current, "scene-1-badge").style.color, "#00ff00");

    // Even though the marked color equals the template default, dropping the
    // object via scene.update is refused instead of silently losing the choice.
    const drop = await f.c.call("scene.update", {
      projectId,
      expectedRevision: revision,
      operationId: "marker-drop",
      sceneId: "scene-1",
      template: { title: "去掉副标题", duration: 5, badge: "AI", logo: "assets/logo.png" },
    });
    assert.equal(drop.ok, false, JSON.stringify(drop));
    assert.equal(drop.error.code, "E_OVERRIDE_CONFLICT");
    assert.equal((await inspected(f.c, projectId)).revision, revision);
  } finally {
    await f.cleanup();
  }
});

test("old-base revise protects overrides added after base, including defaults and deletions (R1)", async () => {
  const f = await managed("r1-old-base");
  const baseSpec = (overrides = {}) => sceneSpec({ ...overrides });
  try {
    // R1a: human adds an explicit override whose value equals the base default
    // after the AI base revision; AI only changes the scene accent default.
    const first = await created(f.c);
    const projectId = first.projectId;
    let revision = await addShotScene(f.c, projectId, first.revision);
    let current = await inspected(f.c, projectId);
    const defaultAccent = element(current, "scene-1-subtitle").style.color;
    const oldBase = current.revision;
    const human = await f.c.call("edit", {
      projectId,
      expectedRevision: oldBase,
      operationId: "r1a-human",
      ops: [
        { type: "style", target: "scene-1-subtitle", styles: { color: defaultAccent } },
      ],
    });
    assert.equal(human.ok, true, JSON.stringify(human));
    const revised = await f.c.call("project.revise", {
      projectId,
      baseRevision: oldBase,
      expectedRevision: human.result.revision,
      operationId: "r1a-ai",
      sceneId: "scene-1",
      template: baseSpec({ accent: "#ff0000" }),
    });
    assert.equal(revised.ok, true, JSON.stringify(revised));
    assert.equal(revised.result.written, true, JSON.stringify(revised.result.conflicts));
    assert.deepEqual(revised.result.conflicts, []);
    current = await inspected(f.c, projectId);
    // The explicit human color wins even though AI changed the scene default.
    assert.equal(element(current, "scene-1-subtitle").style.color, defaultAccent);
    assert.equal(element(current, "scene-1-title").text, "场景标题");
    // Unmarked defaults still follow the AI scene change.
    assert.equal(element(current, "scene-1-badge").style.color, "#ff0000");

    // R1b: AI candidate drops the object whose override was added after base.
    const second = await created(f.c);
    const pid2 = second.projectId;
    revision = await addShotScene(f.c, pid2, second.revision);
    current = await inspected(f.c, pid2);
    const accent2 = element(current, "scene-1-subtitle").style.color;
    const oldBase2 = current.revision;
    const human2 = await f.c.call("edit", {
      projectId: pid2,
      expectedRevision: oldBase2,
      operationId: "r1b-human",
      ops: [
        { type: "style", target: "scene-1-subtitle", styles: { color: accent2 } },
      ],
    });
    const drop = await f.c.call("project.revise", {
      projectId: pid2,
      baseRevision: oldBase2,
      expectedRevision: human2.result.revision,
      operationId: "r1b-ai",
      sceneId: "scene-1",
      template: { title: "场景标题", duration: 5, badge: "AI", logo: "assets/logo.png" },
    });
    assert.equal(drop.ok, true, JSON.stringify(drop));
    assert.equal(drop.result.written, false);
    assert.equal(drop.result.conflicts[0].reason, "AI_DELETE_HUMAN_MODIFY");
    assert.equal(drop.result.conflicts[0].stableId, "scene-1-subtitle");
    assert.equal((await inspected(f.c, pid2)).revision, human2.result.revision);

    // R1c: an unchanged AI candidate must not create a false conflict.
    const third = await created(f.c);
    const pid3 = third.projectId;
    revision = await addShotScene(f.c, pid3, third.revision);
    current = await inspected(f.c, pid3);
    const accent3 = element(current, "scene-1-subtitle").style.color;
    const oldBase3 = current.revision;
    const human3 = await f.c.call("edit", {
      projectId: pid3,
      expectedRevision: oldBase3,
      operationId: "r1c-human",
      ops: [
        { type: "style", target: "scene-1-subtitle", styles: { color: accent3 } },
      ],
    });
    const unchanged = await f.c.call("project.revise", {
      projectId: pid3,
      baseRevision: oldBase3,
      expectedRevision: human3.result.revision,
      operationId: "r1c-ai",
      sceneId: "scene-1",
      template: baseSpec(),
    });
    assert.equal(unchanged.ok, true, JSON.stringify(unchanged));
    assert.equal(unchanged.result.written, true);
    assert.deepEqual(unchanged.result.conflicts, []);
    current = await inspected(f.c, pid3);
    assert.equal(element(current, "scene-1-subtitle").style.color, accent3);
  } finally {
    await f.cleanup();
  }
});

test("first typed edit keeps existing marker-less deltas across regeneration and history (R2)", async () => {
  const f = await managed("r2-markerless-union");
  try {
    // R2a: marker-less external layout delta, then a typed style edit, then a
    // scene regeneration must keep both left=240 and the new color.
    const first = await created(f.c);
    const pid = first.projectId;
    let revision = await addShotScene(f.c, pid, first.revision);
    const original = await readProjectHtml(f, pid);
    const withLeft = original.replace(
      /(<h1[^>]*data-hf-id="scene-1-title"[^>]*style="[^"]*?left:)88px/,
      "$1240px",
    );
    assert.notEqual(withLeft, original, "external left patch did not apply");
    const { writeFile } = await import("node:fs/promises");
    await writeFile(resolve(f.projectsRoot, pid, "index.html"), withLeft);
    let current = await inspected(f.c, pid);
    assert.equal(element(current, "scene-1-title").layout.left, 240);
    revision = current.revision;
    const styleEdit = await f.c.call("edit", {
      projectId: pid,
      expectedRevision: revision,
      operationId: "r2a-style",
      ops: [{ type: "style", target: "scene-1-title", styles: { color: "#ff0000" } }],
    });
    assert.equal(styleEdit.ok, true, JSON.stringify(styleEdit));
    const regenerated = await f.c.call("scene.update", {
      projectId: pid,
      expectedRevision: styleEdit.result.revision,
      operationId: "r2a-regenerate",
      sceneId: "scene-1",
      template: sceneSpec({ title: "重生成标题" }),
    });
    assert.equal(regenerated.ok, true, JSON.stringify(regenerated));
    current = await inspected(f.c, pid);
    assert.equal(element(current, "scene-1-title").layout.left, 240);
    assert.equal(element(current, "scene-1-title").style.color, "#ff0000");
    assert.equal(element(current, "scene-1-title").text, "重生成标题");

    // reopen and undo/redo keep both sources.
    await f.c.call("close", { projectId: pid });
    await f.c.call("open", { projectId: pid });
    current = await inspected(f.c, pid);
    assert.equal(element(current, "scene-1-title").layout.left, 240);
    assert.equal(element(current, "scene-1-title").style.color, "#ff0000");
    const undo = await f.c.call("undo", {
      projectId: pid,
      expectedRevision: current.revision,
      operationId: "r2a-undo",
    });
    assert.equal(undo.ok, true, JSON.stringify(undo));
    current = await inspected(f.c, pid);
    assert.equal(element(current, "scene-1-title").layout.left, 240);
    assert.equal(element(current, "scene-1-title").style.color, "#ff0000");
    const redo = await f.c.call("redo", {
      projectId: pid,
      expectedRevision: current.revision,
      operationId: "r2a-redo",
    });
    assert.equal(redo.ok, true, JSON.stringify(redo));
    current = await inspected(f.c, pid);
    assert.equal(element(current, "scene-1-title").layout.left, 240);
    assert.equal(element(current, "scene-1-title").style.color, "#ff0000");

    // R2b reverse: marker-less external style delta + typed layout edit.
    const second = await created(f.c);
    const pid2 = second.projectId;
    revision = await addShotScene(f.c, pid2, second.revision);
    const html2 = await readProjectHtml(f, pid2);
    const withColor = html2.replace(
      /(<h1[^>]*data-hf-id="scene-1-title"[^>]*style="[^"]*?)(")/,
      "$1;color:#00ff00$2",
    );
    assert.notEqual(withColor, html2, "external color patch did not apply");
    await writeFile(resolve(f.projectsRoot, pid2, "index.html"), withColor);
    current = await inspected(f.c, pid2);
    assert.equal(element(current, "scene-1-title").style.color, "#00ff00");
    const layoutEdit = await f.c.call("edit", {
      projectId: pid2,
      expectedRevision: current.revision,
      operationId: "r2b-layout",
      ops: [
        { type: "layout", target: "scene-1-title", unit: "composition-px", box: { left: 240 } },
      ],
    });
    assert.equal(layoutEdit.ok, true, JSON.stringify(layoutEdit));
    const regenerated2 = await f.c.call("scene.update", {
      projectId: pid2,
      expectedRevision: layoutEdit.result.revision,
      operationId: "r2b-regenerate",
      sceneId: "scene-1",
      template: sceneSpec({ title: "反向重生成" }),
    });
    assert.equal(regenerated2.ok, true, JSON.stringify(regenerated2));
    current = await inspected(f.c, pid2);
    assert.equal(element(current, "scene-1-title").style.color, "#00ff00");
    assert.equal(element(current, "scene-1-title").layout.left, 240);
  } finally {
    await f.cleanup();
  }
});

test("marker-less projects edited outside the protocol still keep differing managed values", async () => {
  const f = await managed("layout-legacy-fallback");
  try {
    const project = await created(f.c);
    const projectId = project.projectId;
    let revision = await addShotScene(f.c, projectId, project.revision);
    // Simulate a pre-marker/external HTML edit: change the title base left
    // without the controlled override attribute.
    const before = await readProjectHtml(f, projectId);
    const edited = before.replace(
      /(<h1[^>]*data-hf-id="scene-1-title"[^>]*style="[^"]*?left:)88px/,
      "$1240px",
    );
    assert.notEqual(edited, before, "test fixture edit did not apply");
    await import("node:fs/promises").then(({ writeFile }) =>
      writeFile(resolve(f.projectsRoot, projectId, "index.html"), edited),
    );
    const changed = await f.c.call("inspect", { projectId });
    revision = changed.result.revision;
    const updated = await f.c.call("scene.update", {
      projectId,
      expectedRevision: revision,
      operationId: "fallback-scene",
      sceneId: "scene-1",
      template: sceneSpec({ title: "外部编辑后重生成" }),
    });
    assert.equal(updated.ok, true, JSON.stringify(updated));
    const current = await inspected(f.c, projectId);
    assert.equal(element(current, "scene-1-title").layout.left, 240);
    assert.equal(element(current, "scene-1-title").text, "外部编辑后重生成");
  } finally {
    await f.cleanup();
  }
});

test("project.revise merges human layout/style with AI text, conflicts per field and protects overrides", async () => {
  const f = await managed("layout-merge");
  try {
    const project = await created(f.c);
    const projectId = project.projectId;
    const baseRevision = project.revision;
    const spec = (title) => ({
      title,
      duration: 5,
      subtitle: "场景副标题",
      badge: "AI",
      logo: "assets/logo.png",
      shot: "assets/shot.png",
    });

    // Human moves/stylizes the title; AI only changes its text.
    const humanLayout = await f.c.call("edit", {
      projectId,
      expectedRevision: baseRevision,
      operationId: "merge-layout",
      ops: [
        { type: "layout", target: "scene-1-title", unit: "composition-px", box: { left: 300, top: 250 } },
        { type: "style", target: "scene-1-title", styles: { color: "#00ff00", fontSize: 88 } },
      ],
    });
    assert.equal(humanLayout.ok, true, JSON.stringify(humanLayout));
    const merged = await f.c.call("project.revise", {
      projectId,
      baseRevision,
      expectedRevision: humanLayout.result.revision,
      operationId: "merge-revise",
      sceneId: "scene-1",
      template: spec("AI 改写的标题"),
    });
    assert.equal(merged.ok, true, JSON.stringify(merged));
    assert.equal(merged.result.written, true);
    let current = await inspected(f.c, projectId);
    assert.equal(element(current, "scene-1-title").text, "AI 改写的标题");
    assert.deepEqual(element(current, "scene-1-title").layout, {
      left: 300,
      top: 250,
      width: 980,
      height: null,
    });
    assert.equal(element(current, "scene-1-title").style.color, "#00ff00");
    assert.equal(element(current, "scene-1-title").style.fontSize, 88);

    // Same field (text) changed on both sides is still an explicit conflict.
    const base2 = current.revision;
    const humanText = await f.c.call("edit", {
      projectId,
      expectedRevision: base2,
      operationId: "merge-human-text",
      ops: [{ type: "text", target: "scene-1-title", text: "人工再改标题" }],
    });
    const conflict = await f.c.call("project.revise", {
      projectId,
      baseRevision: base2,
      expectedRevision: humanText.result.revision,
      operationId: "merge-conflict",
      sceneId: "scene-1",
      template: spec("AI 再改标题"),
    });
    assert.equal(conflict.ok, true, JSON.stringify(conflict));
    assert.equal(conflict.result.written, false);
    const textConflict = conflict.result.conflicts.find((entry) => entry.stableId === "scene-1-title");
    assert.equal(textConflict.reason, "BOTH_MODIFIED");
    assert.equal(textConflict.field, "text");
    assert.equal(textConflict.humanValue, "人工再改标题");
    assert.equal(textConflict.aiValue, "AI 再改标题");
    current = await inspected(f.c, projectId);
    assert.equal(current.revision, humanText.result.revision);
    assert.equal(element(current, "scene-1-title").text, "人工再改标题");

    // AI dropping a human-overridden optional object is a conflict, not silent loss.
    const withSubtitle = await f.c.call("edit", {
      projectId,
      expectedRevision: current.revision,
      operationId: "merge-subtitle",
      ops: [
        { type: "layout", target: "scene-1-subtitle", unit: "composition-px", box: { left: 160 } },
      ],
    });
    const drop = await f.c.call("project.revise", {
      projectId,
      baseRevision: current.revision,
      expectedRevision: withSubtitle.result.revision,
      operationId: "merge-drop",
      sceneId: "scene-1",
      template: { title: "人工再改标题", duration: 5, badge: "AI", logo: "assets/logo.png" },
    });
    assert.equal(drop.ok, true, JSON.stringify(drop));
    assert.equal(drop.result.written, false);
    assert.equal(drop.result.conflicts[0].reason, "AI_DELETE_HUMAN_MODIFY");
    assert.equal(drop.result.conflicts[0].stableId, "scene-1-subtitle");
    assert.equal(
      (await inspected(f.c, projectId)).revision,
      withSubtitle.result.revision,
    );

    // Direct path (base === current) with prior overrides also preserves them.
    current = await inspected(f.c, projectId);
    const direct = await f.c.call("project.revise", {
      projectId,
      baseRevision: current.revision,
      expectedRevision: current.revision,
      operationId: "merge-direct",
      sceneId: "scene-1",
      template: spec("AI 直接改写"),
    });
    assert.equal(direct.ok, true, JSON.stringify(direct));
    assert.equal(direct.result.written, true);
    current = await inspected(f.c, projectId);
    assert.equal(element(current, "scene-1-title").text, "AI 直接改写");
    assert.equal(element(current, "scene-1-title").layout.left, 300);
    assert.equal(element(current, "scene-1-title").style.color, "#00ff00");
    assert.equal(element(current, "scene-1-subtitle").layout.left, 160);
  } finally {
    await f.cleanup();
  }
});

test("undo/redo restore real layout/style output and timeline bytes stay unchanged", async () => {
  const f = await managed("layout-history");
  try {
    const project = await created(f.c);
    const projectId = project.projectId;
    let revision = await addShotScene(f.c, projectId, project.revision);
    const originalRevision = revision;
    const originalHtml = await readProjectHtml(f, projectId);
    const originalTimeline = (() => {
      const parsed = parseDocument(originalHtml);
      return originalHtml.match(/<script>([\s\S]*?)<\/script>/)?.[1] ?? null;
    })();
    assert.ok(originalTimeline);
    const originalTitle = element(await inspected(f.c, projectId), "scene-1-title");

    const first = await f.c.call("edit", {
      projectId,
      expectedRevision: revision,
      operationId: "history-1",
      ops: [
        { type: "layout", target: "scene-1-title", unit: "composition-px", box: { left: 100 } },
        { type: "style", target: "scene-1-title", styles: { color: "#ff8800" } },
      ],
    });
    assert.equal(first.ok, true, JSON.stringify(first));
    revision = first.result.revision;
    const firstHtml = await readProjectHtml(f, projectId);
    const firstTimeline = firstHtml.match(/<script>([\s\S]*?)<\/script>/)?.[1];
    assert.equal(firstTimeline, originalTimeline, "layout/style must not touch the GSAP timeline");
    const firstTitle = element(await inspected(f.c, projectId), "scene-1-title");
    assert.equal(firstTitle.layout.left, 100);

    const second = await f.c.call("edit", {
      projectId,
      expectedRevision: revision,
      operationId: "history-2",
      ops: [
        { type: "layout", target: "scene-1-title", unit: "composition-px", box: { left: 250 } },
        { type: "style", target: "scene-1-title", styles: { fontSize: 96 } },
      ],
    });
    assert.equal(second.ok, true, JSON.stringify(second));
    revision = second.result.revision;

    const undo1 = await f.c.call("undo", {
      projectId,
      expectedRevision: revision,
      operationId: "history-undo-1",
    });
    assert.equal(undo1.ok, true, JSON.stringify(undo1));
    let current = await inspected(f.c, projectId);
    assert.deepEqual(element(current, "scene-1-title").layout, firstTitle.layout);
    assert.deepEqual(element(current, "scene-1-title").style, firstTitle.style);

    const undo2 = await f.c.call("undo", {
      projectId,
      expectedRevision: current.revision,
      operationId: "history-undo-2",
    });
    assert.equal(undo2.ok, true, JSON.stringify(undo2));
    current = await inspected(f.c, projectId);
    assert.deepEqual(element(current, "scene-1-title").layout, originalTitle.layout);
    assert.deepEqual(element(current, "scene-1-title").style, originalTitle.style);
    assert.equal(current.revision, originalRevision);

    const redo1 = await f.c.call("redo", {
      projectId,
      expectedRevision: current.revision,
      operationId: "history-redo-1",
    });
    assert.equal(redo1.ok, true, JSON.stringify(redo1));
    current = await inspected(f.c, projectId);
    assert.equal(element(current, "scene-1-title").layout.left, 100);
    assert.equal(element(current, "scene-1-title").style.color, "#ff8800");

    const redo2 = await f.c.call("redo", {
      projectId,
      expectedRevision: current.revision,
      operationId: "history-redo-2",
    });
    assert.equal(redo2.ok, true, JSON.stringify(redo2));
    current = await inspected(f.c, projectId);
    assert.equal(element(current, "scene-1-title").layout.left, 250);
    assert.equal(element(current, "scene-1-title").style.fontSize, 96);
    assert.equal(current.revision, revision);
  } finally {
    await f.cleanup();
  }
});

test("edit-op schema accepts layout/style variants and rejects malformed ones", async () => {
  const schema = JSON.parse(
    await readFile(resolve(base, "protocol.schema.json"), "utf8"),
  );
  const frame = (ops) => ({
    v: 1,
    id: "schema-layout",
    method: "edit",
    params: {
      projectId: "proj-example",
      expectedRevision: "a".repeat(64),
      operationId: "schema-op",
      ops,
    },
  });
  const valid = [
    [{ type: "layout", target: "scene-1-title", unit: "composition-px", box: { left: 120, top: 240 } }],
    [{ type: "layout", target: "scene-1-logo", unit: "composition-px", box: { width: 600, height: 320 } }],
    [{ type: "style", target: "scene-1-title", styles: { color: "#ff0000", fontSize: 48, fontWeight: 600, textAlign: "center" } }],
    [
      { type: "text", target: "scene-1-title", text: "mix" },
      { type: "layout", target: "scene-1-title", unit: "composition-px", box: { left: 10 } },
    ],
  ];
  for (const ops of valid) assert.deepEqual(validate(frame(ops), schema), [], JSON.stringify(ops));
  const invalid = [
    [{ type: "layout", target: "scene-1-title", unit: "composition-px", box: {} }],
    [{ type: "layout", target: "scene-1-title", unit: "px", box: { left: 10 } }],
    [{ type: "layout", target: "scene-1-title", unit: "composition-px", box: { x: 10 } }],
    [{ type: "layout", target: "scene-1-title", unit: "composition-px", box: { width: 0 } }],
    [{ type: "style", target: "scene-1-title", styles: {} }],
    [{ type: "style", target: "scene-1-title", styles: { color: "red" } }],
    [{ type: "style", target: "scene-1-title", styles: { fontWeight: 150 } }],
    [{ type: "style", target: "scene-1-title", styles: { unknown: "x" } }],
  ];
  for (const ops of invalid)
    assert.ok(validate(frame(ops), schema).length > 0, JSON.stringify(ops));
});
