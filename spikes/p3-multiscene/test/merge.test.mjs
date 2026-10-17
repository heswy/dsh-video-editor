import test from "node:test";
import assert from "node:assert/strict";
import { mergeDocument } from "../scripts/lib/merge.mjs";
import { scenesFixture, renderSingleDoc } from "../scripts/lib/scene-templates.mjs";

const scenes = scenesFixture();
const baseHtml = renderSingleDoc(scenes);

function humanWithTitle(title) {
  return renderSingleDoc(
    scenes.map((scene) =>
      scene.sceneId === "scene-2" ? { ...scene, title } : scene,
    ),
  );
}

function withoutBadge(html) {
  return html.replace(/<div data-hf-id="scene-2-badge"[\s\S]*?<\/div>\n/, "");
}

function withInsertedElement(html, id, text) {
  return html.replace(
    /(<img data-hf-id="scene-2-shot"[^>]*>)/,
    `$1\n    <div data-hf-id="${id}" style="position:absolute;left:88px;top:500px;font-size:22px;color:#ffffff">${text}</div>`,
  );
}

const humanHtml = humanWithTitle("人工标题");

test("disjoint human and AI changes auto-merge and preserve both", async () => {
  const aiHtml = renderSingleDoc(
    scenes.map((scene) =>
      scene.sceneId === "scene-2"
        ? { ...scene, subtitle: "AI 副标题" }
        : scene,
    ),
  );
  const merged = await mergeDocument({ sceneId: "scene-2", baseHtml, humanHtml, aiHtml });
  assert.equal(merged.ok, true, JSON.stringify(merged));
  assert.match(merged.html, /人工标题/);
  assert.match(merged.html, /AI 副标题/);
  assert.ok(merged.otherSections.every((entry) => entry.unchanged));
});

test("both sides modifying the same object is an explicit conflict", async () => {
  const aiHtml = humanWithTitle("AI 标题");
  const merged = await mergeDocument({ sceneId: "scene-2", baseHtml, humanHtml, aiHtml });
  assert.equal(merged.ok, false);
  const conflict = merged.conflicts.find((entry) => entry.stableId === "scene-2-title");
  assert.equal(conflict.reason, "BOTH_MODIFIED");
  assert.equal(conflict.human.text, "人工标题");
  assert.equal(conflict.ai.text, "AI 标题");
});

test("AI deleting a human-modified object conflicts; untouched deletion is accepted", async () => {
  const humanBadge = renderSingleDoc(
    scenes.map((scene) =>
      scene.sceneId === "scene-2" ? { ...scene, badge: "人工徽标" } : scene,
    ),
  );
  const deletedAi = withoutBadge(baseHtml);
  const conflict = await mergeDocument({
    sceneId: "scene-2",
    baseHtml,
    humanHtml: humanBadge,
    aiHtml: deletedAi,
  });
  assert.equal(conflict.ok, false);
  assert.deepEqual(
    conflict.conflicts.map((entry) => entry.reason),
    ["AI_DELETE_HUMAN_MODIFY"],
  );

  const accepted = await mergeDocument({
    sceneId: "scene-2",
    baseHtml,
    humanHtml,
    aiHtml: deletedAi,
  });
  assert.equal(accepted.ok, true, JSON.stringify(accepted));
  assert.doesNotMatch(accepted.html, /scene-2-badge/);
});

test("deleting an element shifts sibling order without false conflicts", async () => {
  const merged = await mergeDocument({
    sceneId: "scene-2",
    baseHtml,
    humanHtml,
    aiHtml: withoutBadge(baseHtml),
  });
  assert.equal(merged.ok, true, JSON.stringify(merged));
  assert.deepEqual(merged.conflicts, []);
});

test("human additions are preserved while AI changes are adopted", async () => {
  const humanAdded = withInsertedElement(humanHtml, "scene-2-human-note", "人工新增");
  const aiHtml = renderSingleDoc(
    scenes.map((scene) =>
      scene.sceneId === "scene-2"
        ? { ...scene, subtitle: "AI 修改副标题" }
        : scene,
    ),
  );
  const merged = await mergeDocument({
    sceneId: "scene-2",
    baseHtml,
    humanHtml: humanAdded,
    aiHtml,
  });
  assert.equal(merged.ok, true, JSON.stringify(merged));
  assert.match(merged.html, /scene-2-human-note/);
  assert.match(merged.html, /AI 修改副标题/);
  assert.match(merged.html, /人工标题/);
});

test("AI additions are adopted and reported", async () => {
  const aiAdded = withInsertedElement(baseHtml, "scene-2-note", "AI 新增");
  const merged = await mergeDocument({
    sceneId: "scene-2",
    baseHtml,
    humanHtml,
    aiHtml: aiAdded,
  });
  assert.equal(merged.ok, true, JSON.stringify(merged));
  assert.match(merged.html, /scene-2-note/);
  assert.deepEqual(merged.added, ["scene-2-note"]);
});

test("scene-level timing changes require an explicit scene operation", async () => {
  const aiHtml = renderSingleDoc(
    scenes.map((scene) =>
      scene.sceneId === "scene-2" ? { ...scene, duration: 3 } : scene,
    ),
  );
  const merged = await mergeDocument({ sceneId: "scene-2", baseHtml, humanHtml, aiHtml });
  assert.equal(merged.ok, false);
  assert.equal(merged.conflicts[0].reason, "SCENE_META_CHANGED");
});

test("structural tag change and reorder are manual coordination cases", async () => {
  const tagChanged = humanHtml.replace(
    /<h1 data-hf-id="scene-2-title"([\s\S]*?)<\/h1>/,
    '<div data-hf-id="scene-2-title"$1</div>',
  );
  const tagResult = await mergeDocument({
    sceneId: "scene-2",
    baseHtml,
    humanHtml,
    aiHtml: tagChanged,
  });
  assert.equal(tagResult.ok, false);
  assert.equal(tagResult.conflicts[0].reason, "STRUCTURAL_TAG");

  const reorderedAi = baseHtml
    .replace(/(  <section id="scene-2"[\s\S]*?<\/section>\n)(  <section id="scene-3"[\s\S]*?<\/section>\n)/, "$2$1");
  const orderResult = await mergeDocument({
    sceneId: "scene-2",
    baseHtml,
    humanHtml,
    aiHtml: reorderedAi,
  });
  assert.equal(orderResult.ok, false);
  assert.ok(
    orderResult.conflicts.some((entry) => entry.reason === "STRUCTURAL_ORDER"),
  );

  // A scene content merge may not silently edit another scene either.
  const otherSceneAi = renderSingleDoc(
    scenes.map((scene) =>
      scene.sceneId === "scene-3" ? { ...scene, title: "AI 偷偷改 Scene3" } : scene,
    ),
  );
  const otherSceneResult = await mergeDocument({
    sceneId: "scene-2",
    baseHtml,
    humanHtml,
    aiHtml: otherSceneAi,
  });
  assert.equal(otherSceneResult.ok, false);
  assert.equal(
    otherSceneResult.conflicts[0].reason,
    "STRUCTURAL_OTHER_SCENE",
  );
});
