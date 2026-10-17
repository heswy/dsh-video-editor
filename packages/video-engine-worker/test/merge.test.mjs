import test from "node:test";
import assert from "node:assert/strict";
import { buildDocumentHtml, defaultScene } from "../src/scenes.mjs";
import { mergeSceneDocuments } from "../src/merge.mjs";

const scenes = [0, 1, 2, 3].map((index) => ({
  ...defaultScene(index),
  duration: [4, 4, 4, 3][index],
  title: `标题 ${index + 1}`,
  subtitle: `副标题 ${index + 1}`,
  badge: `SCENE 0${index + 1}`,
  logo: "assets/logo.png",
  shot: "assets/shot.png",
}));
const html = (list) =>
  buildDocumentHtml({ width: 1280, height: 720, scenes: list });
const baseHtml = html(scenes);
const human = (changes) =>
  html(
    scenes.map((scene, index) =>
      changes[index] ? { ...scene, ...changes[index] } : scene,
    ),
  );
const replace = (source, pattern, replacement) => {
  const result = source.replace(pattern, replacement);
  assert.notEqual(result, source, `pattern did not match: ${pattern}`);
  return result;
};

test("disjoint human and AI changes merge and other scenes stay identical", () => {
  const humanHtml = human({ 1: { title: "人工标题" } });
  const aiHtml = human({ 1: { subtitle: "AI 副标题" } });
  const merged = mergeSceneDocuments({
    sceneId: "scene-2",
    baseHtml,
    humanHtml,
    aiHtml,
  });
  assert.equal(merged.ok, true, JSON.stringify(merged));
  assert.match(merged.html, /人工标题/);
  assert.match(merged.html, /AI 副标题/);
  assert.ok(merged.changeSummary.otherScenes.every((scene) => scene.unchanged));
  assert.ok(merged.changeSummary.adopted.includes("scene-2-subtitle"));
});

test("same object changed on both sides conflicts with both summaries", () => {
  const merged = mergeSceneDocuments({
    sceneId: "scene-2",
    baseHtml,
    humanHtml: human({ 1: { title: "人工标题" } }),
    aiHtml: human({ 1: { title: "AI 标题" } }),
  });
  assert.equal(merged.ok, false);
  const conflict = merged.conflicts.find(
    (entry) => entry.stableId === "scene-2-title",
  );
  assert.equal(conflict.reason, "BOTH_MODIFIED");
  assert.equal(conflict.human.text, "人工标题");
  assert.equal(conflict.ai.text, "AI 标题");
});

test("AI deleting a human-modified object conflicts; untouched deletion applies", () => {
  const removeSubtitle = (source) =>
    source.replace(/\n  <p id="scene-2-subtitle"[\s\S]*?<\/p>/, "");
  const aiHtml = removeSubtitle(baseHtml);
  const humanHtml = human({ 1: { subtitle: "人工副标题" } });
  const conflict = mergeSceneDocuments({
    sceneId: "scene-2",
    baseHtml,
    humanHtml,
    aiHtml,
  });
  assert.equal(conflict.ok, false);
  assert.equal(conflict.conflicts[0].reason, "AI_DELETE_HUMAN_MODIFY");
  assert.equal(conflict.conflicts[0].stableId, "scene-2-subtitle");

  const accepted = mergeSceneDocuments({
    sceneId: "scene-2",
    baseHtml,
    humanHtml: baseHtml,
    aiHtml,
  });
  assert.equal(accepted.ok, true, JSON.stringify(accepted));
  assert.doesNotMatch(accepted.html, /scene-2-subtitle/);
});

test("human additions are preserved and AI additions adopted", () => {
  const humanHtml = replace(
    human({ 1: { title: "人工标题" } }),
    /(<img id="scene-2-shot"[^>]*>)/,
    '$1\n<div id="scene-2-human-note" data-hf-id="scene-2-human-note" style="position:absolute;left:88px;top:470px;font-size:22px;color:#fff">人工新增</div>',
  );
  const aiHtml = replace(
    html(scenes),
    /(<img id="scene-2-shot"[^>]*>)/,
    '$1\n<div id="scene-2-note" data-hf-id="scene-2-note" style="position:absolute;left:88px;top:500px;font-size:22px;color:#fff">AI 新增</div>',
  );
  const merged = mergeSceneDocuments({
    sceneId: "scene-2",
    baseHtml,
    humanHtml,
    aiHtml,
  });
  assert.equal(merged.ok, true, JSON.stringify(merged));
  assert.match(merged.html, /scene-2-human-note/);
  assert.match(merged.html, /scene-2-note/);
  assert.match(merged.html, /人工标题/);
});

test("scene meta changes and structural changes are explicit conflicts", () => {
  const durationAi = baseHtml.replace(
    /(<section id="scene-2"[^>]*data-start=")4(")/,
    "$15$2",
  );
  const meta = mergeSceneDocuments({
    sceneId: "scene-2",
    baseHtml,
    humanHtml: human({ 1: { title: "人工标题" } }),
    aiHtml: durationAi,
  });
  assert.equal(meta.ok, false);
  assert.equal(meta.conflicts[0].reason, "SCENE_META_CHANGED");

  const tagAi = replace(
    replace(
      baseHtml,
      /<h1 id="scene-2-title"/,
      '<div id="scene-2-title"',
    ),
    /(<div id="scene-2-title"[\s\S]*?)<\/h1>/,
    "$1</div>",
  );
  const structural = mergeSceneDocuments({
    sceneId: "scene-2",
    baseHtml,
    humanHtml: baseHtml,
    aiHtml: tagAi,
  });
  assert.equal(structural.ok, false);
  assert.equal(structural.conflicts[0].reason, "STRUCTURAL_TAG");
});

test("AI changes to other scenes or scene order are rejected", () => {
  const other = human({ 2: { title: "AI 偷改 Scene3" } });
  const otherResult = mergeSceneDocuments({
    sceneId: "scene-2",
    baseHtml,
    humanHtml: baseHtml,
    aiHtml: other,
  });
  assert.equal(otherResult.ok, false);
  assert.equal(otherResult.conflicts[0].reason, "STRUCTURAL_OTHER_SCENE");

  const reordered = baseHtml
    .replace(
      /(  <section id="scene-1"[\s\S]*?<\/section>\n)(  <section id="scene-2"[\s\S]*?<\/section>\n)/,
      "$2$1",
    );
  const orderResult = mergeSceneDocuments({
    sceneId: "scene-2",
    baseHtml,
    humanHtml: baseHtml,
    aiHtml: reordered,
  });
  assert.equal(orderResult.ok, false);
  assert.equal(orderResult.conflicts[0].reason, "STRUCTURAL_ORDER");
});
