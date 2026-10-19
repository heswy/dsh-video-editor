import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  artifacts,
  evidenceDir,
  resetDir,
  samplePixel,
  sha256,
  writeJson,
} from "./lib/util.mjs";
import {
  scenesFixture,
  TOTAL_DURATION,
  renderMasterNested,
  renderSceneTemplate,
  renderSingleDoc,
} from "./lib/scene-templates.mjs";
import {
  generateTestImages,
  installProjectAssets,
} from "./lib/assets.mjs";
import {
  inspectExtended,
  replaceSectionHtml,
  sectionHtml,
} from "./lib/doc.mjs";
import { mergeDocument } from "./lib/merge.mjs";
import {
  copyProject,
  createClient,
  prepareRuntime,
  waitStatus,
  writeRegistry,
} from "./lib/worker.mjs";

const work = resolve(artifacts, "q2-q5");
await resetDir(work);
const runtime = await prepareRuntime(work);
const { images, hashes: imageHashes } = await generateTestImages(
  resolve(work, "images"),
);
const scenes = scenesFixture();
const demoDir = resolve(runtime.projectsRoot, "demo");
await mkdir(demoDir, { recursive: true });
const assets = await installProjectAssets(demoDir, images);
await writeFile(resolve(demoDir, "index.html"), renderSingleDoc(scenes));
await writeFile(
  resolve(demoDir, "project.json"),
  JSON.stringify({ entry: "index.html", assets }, null, 2),
);

// A nested project is registered too, to record the current worker's behaviour
// on nested compositions (inspect/edit gap for Q1/Q2).
const nestedDir = resolve(runtime.projectsRoot, "nested");
await mkdir(nestedDir, { recursive: true });
const nestedAssets = await installProjectAssets(nestedDir, images);
await mkdir(resolve(nestedDir, "compositions"), { recursive: true });
await writeFile(resolve(nestedDir, "index.html"), renderMasterNested(scenes));
for (const scene of scenes)
  await writeFile(
    resolve(nestedDir, "compositions", `${scene.sceneId}.html`),
    renderSceneTemplate(scene),
  );
await writeFile(
  resolve(nestedDir, "project.json"),
  JSON.stringify(
    {
      entry: "index.html",
      assets: [...nestedAssets, ...scenes.map((scene) => `compositions/${scene.sceneId}.html`)],
    },
    null,
    2,
  ),
);

const registryPath = await writeRegistry(runtime, {
  demo: demoDir,
  nested: nestedDir,
});
const client = createClient(runtime, registryPath);
const report = {
  generatedAt: new Date().toISOString(),
  node: process.version,
  assets: imageHashes,
  q2: {},
  q5: { scenarios: {} },
};

async function frame(time) {
  const job = await client.frame({ projectId: "demo", revision: await currentRevision(), time });
  const done = await waitStatus(client, job.jobId);
  return {
    ...done,
    file: resolve(runtime.outputRoot, done.artifact.name),
    pixel: { x: 40, y: 40 },
  };
}

async function currentRevision() {
  const inspected = await client.inspect("demo");
  return inspected.revision;
}

try {
  await client.start();
  const opened = await client.open("demo");
  report.q2.workerOpen = {
    revision: opened.revision,
    duration: opened.duration,
    width: opened.width,
    height: opened.height,
    elementCount: opened.elements.length,
    sceneSectionsVisible: opened.elements.filter((element) => element.stableId?.includes("-section")).length,
    sample: opened.elements
      .filter((element) => ["scene-2-section", "scene-2-title"].includes(element.stableId))
      .map((element) => ({ stableId: element.stableId, text: element.text, timing: element.timing, capabilities: element.capabilities })),
    hasSceneMetadata: opened.elements.some((element) => "sceneId" in element),
  };

  // Q2: extended inspect is derived from content only (no second truth). A
  // manual file edit must be visible on the next inspect, including revision.
  const baseHtml = await readFile(resolve(demoDir, "index.html"), "utf8");
  const inspectBefore = await inspectExtended(demoDir);
  const changedCopy = resolve(work, "inspect-copy");
  await copyProject(demoDir, changedCopy);
  await writeFile(
    resolve(changedCopy, "index.html"),
    baseHtml.replace("人工修改先发生", "内容文件才是唯一真相"),
  );
  const inspectAfter = await inspectExtended(changedCopy);
  report.q2.extendedInspect = {
    base: {
      revision: inspectBefore.revision,
      duration: inspectBefore.duration,
      width: inspectBefore.width,
      height: inspectBefore.height,
      sceneCount: inspectBefore.scenes.length,
      scenes: inspectBefore.scenes.map((scene) => ({
        sceneId: scene.sceneId,
        order: scene.order,
        start: scene.start,
        duration: scene.duration,
        elementCount: scene.elements.length,
      })),
      scene2: inspectBefore.scenes.find((scene) => scene.sceneId === "scene-2"),
    },
    rederivedFromContent: {
      revision: inspectAfter.revision,
      revisionChanged: inspectAfter.revision !== inspectBefore.revision,
      scene3Title: inspectAfter.scenes
        .find((scene) => scene.sceneId === "scene-3")
        .elements.find((element) => element.stableId === "scene-3-title")?.text,
    },
  };

  // Nested candidate: root inspect sees hosts only; a scene-targeted edit via the
  // existing worker is rejected. This is the Q1/Q2 gap that candidate B avoids.
  const nestedOpened = await client.open("nested");
  report.q2.nestedCurrentWorker = {
    revision: nestedOpened.revision,
    duration: nestedOpened.duration,
    elementCount: nestedOpened.elements.length,
    stableIds: nestedOpened.elements.map((element) => element.stableId),
    editNestedElement: await client
      .edit({
        projectId: "nested",
        expectedRevision: nestedOpened.revision,
        operationId: "nested-edit-probe",
        ops: [{ type: "text", target: "scene-1-title", text: "不能直接改" }],
      })
      .then(() => ({ ok: true }))
      .catch((error) => ({ ok: false, code: error.code, stage: error.stage })),
  };

  // Q5: human typed edit through the accepted worker's existing edit method.
  const humanEdit = await client.edit({
    projectId: "demo",
    expectedRevision: opened.revision,
    operationId: "p3-human-title",
    ops: [
      { type: "text", target: "scene-2-title", text: "人工修改的 Scene 2 标题" },
      // Existing typed edit uses GLOBAL composition time; a scene-aware Host
      // would convert a scene-local time (0) to the global offset (4).
      { type: "timing", target: "scene-2-title", start: 4, duration: 3.75 },
    ],
  });
  const humanHtml = await readFile(resolve(demoDir, "index.html"), "utf8");
  const humanInspect = await client.inspect("demo");
  report.q5.humanEdit = {
    revision: humanEdit.revision,
    revisionChanged: humanEdit.revision !== opened.revision,
    workerInspectTitle: humanInspect.elements.find((element) => element.stableId === "scene-2-title")?.text,
    workerInspectTiming: humanInspect.elements.find((element) => element.stableId === "scene-2-title")?.timing,
  };

  // Controlled candidate documents (simulated AI rewrite: generated by the same
  // template module, no model call).
  function candidate(overrides) {
    return renderSingleDoc(
      scenes.map((scene) => ({ ...scene, ...(overrides[scene.sceneId] ?? {}) })),
    );
  }

  async function scenario(name, aiHtml, { apply = false } = {}) {
    const merged = await mergeDocument({
      sceneId: "scene-2",
      baseHtml,
      humanHtml,
      aiHtml,
    });
    const entry = {
      mergeOk: merged.ok,
      conflicts: (merged.conflicts ?? []).map((conflict) => ({
        sceneId: conflict.sceneId,
        stableId: conflict.stableId,
        reason: conflict.reason,
        human: conflict.human,
        ai: conflict.ai,
      })),
      conflictReasons: (merged.conflicts ?? []).map((conflict) => conflict.reason),
      unsupported: merged.unsupported,
      added: merged.added,
      removed: merged.removed,
      elementCount: merged.elementCount,
      otherSectionsUnchanged: merged.otherSections,
    };
    if (apply && merged.ok) {
      await writeFile(resolve(demoDir, "index.html"), merged.html);
      const inspected = await client.inspect("demo");
      const rendered = await frame(5);
      entry.applied = {
        newRevision: inspected.revision,
        note: inspected.elements.find((element) => element.stableId === "scene-2-note")?.text ?? null,
        humanTitleStillThere: inspected.elements.find((element) => element.stableId === "scene-2-title")?.text,
        aiSubtitle: inspected.elements.find((element) => element.stableId === "scene-2-subtitle")?.text,
        frame: {
          state: rendered.state,
          sha256: sha256(await readFile(rendered.file)),
          background: samplePixel(rendered.file, { x: 40, y: 40 }),
          logo: samplePixel(rendered.file, { x: 1100, y: 158 }),
          shot3: samplePixel(rendered.file, { x: 925, y: 505 }),
        },
      };
      // Restore the human revision for the following scenarios.
      await writeFile(resolve(demoDir, "index.html"), humanHtml);
      await client.inspect("demo");
    }
    report.q5.scenarios[name] = entry;
    return entry;
  }

  const baseRevision = opened.revision;

  // S1: AI changes a different object than the human did → auto merge.
  await scenario(
    "S1_ai_changes_other_object",
    candidate({ "scene-2": { subtitle: "AI 改写的副标题（其他对象）" } }),
    { apply: true },
  );

  // S2: both changed the same object → explicit conflict, no write.
  await scenario(
    "S2_both_modify_same_object",
    candidate({ "scene-2": { title: "AI 重写的标题" } }),
  );

  // S3: AI deletes an object the human changed → conflict. The AI candidate is
  // generated from the same base revision and deletes the badge; the human
  // document changed the badge text.
  const humanBadgeEdit = await (async () => {
    const current = await client.inspect("demo");
    const result = await client.edit({
      projectId: "demo",
      expectedRevision: current.revision,
      operationId: "p3-human-badge",
      ops: [{ type: "text", target: "scene-2-badge", text: "人工改徽标" }],
    });
    return { result, html: await readFile(resolve(demoDir, "index.html"), "utf8") };
  })();
  report.q5.scenarioBasis = {
    badgeChanged: humanBadgeEdit.html.includes("人工改徽标"),
    humanBadgeRevision: humanBadgeEdit.result.revision,
  };
  // For this scenario the merge base is the badge-edited document, human is the
  // same document, AI deletes the badge.
  if (humanBadgeEdit.html.includes("人工改徽标")) {
    const merged = await mergeDocument({
      sceneId: "scene-2",
      baseHtml,
      humanHtml: humanBadgeEdit.html,
      aiHtml: baseHtml.replace(
        /<div data-hf-id="scene-2-badge"[\s\S]*?<\/div>\n/,
        "",
      ),
    });
    report.q5.scenarios.S3_ai_deletes_human_changed = {
      mergeOk: merged.ok,
      conflicts: (merged.conflicts ?? []).map((conflict) => ({
        sceneId: conflict.sceneId,
        stableId: conflict.stableId,
        reason: conflict.reason,
        human: conflict.human,
        ai: conflict.ai,
      })),
      conflictReasons: (merged.conflicts ?? []).map((conflict) => conflict.reason),
    };
  }
  // Restore badge text by writing humanHtml back (content-only reversal).
  await writeFile(resolve(demoDir, "index.html"), humanHtml);
  await client.inspect("demo");

  // S4: AI adds a new object; human edit is preserved; render merged result.
  const aiWithAddition = candidate({
    "scene-2": { title: scenes[1].title },
  }).replace(
    /(<img data-hf-id="scene-2-shot"[^>]*>)/,
    `$1\n    <div data-hf-id="scene-2-note" style="position:absolute;left:88px;top:430px;width:560px;font-size:24px;color:#ffffff">AI 新增说明文本</div>`,
  );
  await scenario("S4_ai_adds_new_object", aiWithAddition, { apply: true });

  // S5: AI changes scene-level timing/order → explicit scene operation needed.
  await scenario(
    "S5_ai_changes_scene_meta",
    renderSingleDoc(
      scenes.map((scene) =>
        scene.sceneId === "scene-2" ? { ...scene, duration: 3, start: 4 } : scene,
      ),
    ),
  );

  // S6: AI changes the tag/parent structure of an object → manual coordination.
  await scenario(
    "S6_ai_changes_structure",
    humanHtml.replace(
      /<h1 data-hf-id="scene-2-title"([\s\S]*?)<\/h1>/,
      '<div data-hf-id="scene-2-title"$1</div>',
    ),
  );

  // S7: human-added object is preserved even when the AI changes other objects.
  const aiDisjoint = candidate({ "scene-2": { subtitle: "AI 再次改写副标题" } });
  const humanWithAddition = humanHtml.replace(
    /(<img data-hf-id="scene-2-shot"[^>]*>)/,
    `$1\n    <div data-hf-id="scene-2-human-note" style="position:absolute;left:88px;top:500px;width:560px;font-size:22px;color:#ffffff">人工新增说明</div>`,
  );
  const mergedAddition = await mergeDocument({
    sceneId: "scene-2",
    baseHtml,
    humanHtml: humanWithAddition,
    aiHtml: aiDisjoint,
  });
  report.q5.scenarios.S7_human_addition_preserved = {
    mergeOk: mergedAddition.ok,
    conflicts: mergedAddition.conflicts ?? [],
    added: mergedAddition.added,
    humanAdditionKept: mergedAddition.ok
      ? mergedAddition.html.includes("scene-2-human-note")
      : false,
    aiSubtitleAdopted: mergedAddition.ok
      ? mergedAddition.html.includes("AI 再次改写副标题")
      : false,
  };

  report.q5.mergeAlgorithm = {
    baseRevision,
    humanRevision: humanEdit.revision,
    sceneId: "scene-2",
    description:
      "element-level three-way merge keyed by stableId; scene-level timing/order and tag/parent changes are manual",
  };
} finally {
  await client.dispose();
}

await writeJson(resolve(evidenceDir, "q2-inspect.json"), {
  generatedAt: report.generatedAt,
  node: report.node,
  assets: report.assets,
  q2: report.q2,
});
await writeJson(resolve(evidenceDir, "q5-merge.json"), {
  generatedAt: report.generatedAt,
  node: report.node,
  assets: report.assets,
  q5: report.q5,
});
console.log(
  JSON.stringify(
    {
      q2: {
        workerOpen: report.q2.workerOpen,
        extendedScenes: report.q2.extendedInspect.base.sceneCount,
        nested: report.q2.nestedCurrentWorker,
      },
      q5: {
        humanEdit: report.q5.humanEdit,
        scenarios: Object.fromEntries(
          Object.entries(report.q5.scenarios).map(([name, value]) => [
            name,
            {
              mergeOk: value.mergeOk,
              conflictReasons: value.conflictReasons,
              applied: value.applied
                ? {
                    newRevision: value.applied.newRevision,
                    humanTitleStillThere: value.applied.humanTitleStillThere,
                    aiSubtitle: value.applied.aiSubtitle,
                    frame: value.applied.frame,
                  }
                : undefined,
            },
          ]),
        ),
      },
    },
    null,
    2,
  ),
);
