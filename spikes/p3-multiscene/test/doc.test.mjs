import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import {
  capabilities,
  childrenOf,
  documentModel,
  inspectExtended,
  otherSectionsUnchanged,
  replaceSectionHtml,
  sceneSections,
  sectionHtml,
  validateDocument,
} from "../scripts/lib/doc.mjs";
import { scenesFixture, renderSingleDoc } from "../scripts/lib/scene-templates.mjs";

const scenes = scenesFixture();
const baseHtml = renderSingleDoc(scenes);

test("single-document model exposes four scenes with stable ids and capabilities", () => {
  const model = documentModel(baseHtml);
  assert.equal(model.duration, 15);
  assert.equal(model.width, 1280);
  assert.equal(model.height, 720);
  assert.equal(model.elements.length, 29);
  const sections = model.elements.filter(
    (element) => element.tag === "section" && element.attributes["data-scene-id"],
  );
  assert.deepEqual(
    sections.map((section) => section.attributes["data-scene-id"]),
    scenes.map((scene) => scene.sceneId),
  );
  const title = model.elements.find((element) => element.id === "scene-2-title");
  assert.deepEqual(capabilities(model, title), ["text", "timing"]);
  const logo = model.elements.find((element) => element.id === "scene-2-logo");
  assert.deepEqual(capabilities(model, logo), []);
  assert.equal(childrenOf(model, "scene-2-section").length, 6);
});

test("section replacement keeps the other scenes byte-identical", () => {
  const changed = renderSingleDoc(
    scenes.map((scene) =>
      scene.sceneId === "scene-2" ? { ...scene, title: "changed" } : scene,
    ),
  );
  const rewritten = replaceSectionHtml(
    baseHtml,
    "scene-2",
    sectionHtml(changed, "scene-2"),
  );
  const unchanged = otherSectionsUnchanged(baseHtml, rewritten, [
    "scene-1",
    "scene-3",
    "scene-4",
  ]);
  assert.ok(unchanged.every((entry) => entry.unchanged));
  assert.equal(sceneSections(rewritten).length, 4);
  const model = documentModel(rewritten);
  assert.equal(model.duration, 15);
  assert.equal(
    model.elements.find((element) => element.id === "scene-2-title").text,
    "changed",
  );
});

test("validation rejects duplicate scenes and duration changes", async () => {
  const expected = {
    width: 1280,
    height: 720,
    duration: 15,
    sceneIds: scenes.map((scene) => scene.sceneId),
  };
  assert.equal((await validateDocument(baseHtml, expected)).ok, true);
  const duplicate = baseHtml.replace(
    'data-scene-id="scene-1"',
    'data-scene-id="scene-2"',
  );
  const duplicateResult = await validateDocument(duplicate, expected);
  assert.equal(duplicateResult.ok, false);
  assert.ok(duplicateResult.errors.some((error) => error.includes("missing scenes")));
  const shortDuration = baseHtml.replace('data-duration="15"', 'data-duration="14"');
  const durationResult = await validateDocument(shortDuration, expected);
  assert.equal(durationResult.ok, false);
  assert.ok(durationResult.errors.some((error) => error.includes("duration")));
});

test("extended inspect is derived from the content file only", async () => {
  const dir = await mkdtemp(resolve(tmpdir(), "p3-inspect-"));
  try {
    await mkdir(resolve(dir, "assets"), { recursive: true });
    await writeFile(resolve(dir, "assets/gsap.min.js"), "// gsap");
    await writeFile(resolve(dir, "index.html"), baseHtml);
    await writeFile(
      resolve(dir, "project.json"),
      JSON.stringify({ entry: "index.html", assets: ["assets/gsap.min.js"] }),
    );
    const first = await inspectExtended(dir);
    assert.equal(first.scenes.length, 4);
    assert.deepEqual(
      first.scenes.map((scene) => [scene.sceneId, scene.order, scene.start, scene.duration]),
      scenes.map((scene) => [scene.sceneId, scene.order, scene.start, scene.duration]),
    );
    const scene2 = first.scenes.find((scene) => scene.sceneId === "scene-2");
    assert.equal(scene2.elements.length, 6);
    assert.ok(scene2.elements.every((element) => element.stableId.startsWith("scene-2-")));
    assert.deepEqual(
      scene2.elements.find((element) => element.stableId === "scene-2-title").capabilities,
      ["text", "timing"],
    );

    await writeFile(
      resolve(dir, "index.html"),
      baseHtml.replace("人工修改先发生", "内容才是唯一真相"),
    );
    const second = await inspectExtended(dir);
    assert.notEqual(second.revision, first.revision);
    assert.equal(
      second.scenes
        .find((scene) => scene.sceneId === "scene-3")
        .elements.find((element) => element.stableId === "scene-3-title").text,
      "内容才是唯一真相",
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
