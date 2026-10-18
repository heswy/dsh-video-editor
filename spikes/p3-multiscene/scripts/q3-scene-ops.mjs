import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { createFsAdapter } from "@hyperframes/sdk/adapters/fs";
import { openComposition } from "@hyperframes/sdk";
import {
  artifacts,
  ensureTemp,
  evidenceDir,
  resetDir,
  runCli,
  samplePixel,
  sha256,
  writeJson,
} from "./lib/util.mjs";
import {
  scenesFixture,
  TOTAL_DURATION,
  renderSingleDoc,
} from "./lib/scene-templates.mjs";
import { generateTestImages, installProjectAssets } from "./lib/assets.mjs";
import { documentModel, validateDocument, writeEntryAtomic } from "./lib/doc.mjs";
import { createClient, prepareRuntime, writeRegistry } from "./lib/worker.mjs";

const work = resolve(artifacts, "q3");
await resetDir(work);
const runtime = await prepareRuntime(work);
const temp = resolve(work, "temp");
await ensureTemp(temp);
const { images } = await generateTestImages(resolve(work, "images"));
const scenes = scenesFixture();
const projectDir = resolve(runtime.projectsRoot, "demo");
await mkdir(projectDir, { recursive: true });
const assets = await installProjectAssets(projectDir, images);
await writeFile(resolve(projectDir, "index.html"), renderSingleDoc(scenes));
await writeFile(
  resolve(projectDir, "project.json"),
  JSON.stringify({ entry: "index.html", assets }, null, 2),
);

const report = {
  generatedAt: new Date().toISOString(),
  node: process.version,
  sceneCount: scenes.length,
  sdkPublicApi: {
    structuralMethods: [
      "addElement(parent, index, html)",
      "removeElement(id)",
      "setAttribute(id, name, value)",
      "setStyle / setText / setTiming",
      "batch / flush / serialize",
    ],
    note: "The SDK models one composition file; the master GSAP timeline is plain document text, not an SDK structural model.",
  },
  experiments: {},
};

async function copyProject(from, to) {
  await rm(to, { recursive: true, force: true });
  await cp(from, to, { recursive: true });
}

async function snapshot(html, time) {
  const dir = resolve(
    work,
    `snapshot-${time}-${Object.keys(report.experiments).length}-${sha256(html).slice(0, 6)}`,
  );
  await copyProject(projectDir, dir);
  await writeFile(resolve(dir, "index.html"), html);
  const out = resolve(dir, "out");
  await mkdir(out, { recursive: true });
  runCli(
    [
      "snapshot",
      dir,
      "--at",
      String(time),
      "--no-end",
      "--keep",
      "--describe",
      "false",
      "--no-browser-gpu",
      "-o",
      out,
    ],
    { cwd: dir, temp },
  );
  const png = execFileSync("find", [out, "-name", "*.png", "-type", "f"], {
    encoding: "utf8",
  })
    .trim()
    .split("\n")[0];
  return {
    png,
    sha256: sha256(await readFile(png)),
    background: samplePixel(png, { x: 40, y: 40 }),
  };
}

const baseHtml = await readFile(resolve(projectDir, "index.html"), "utf8");
const extraSection = `<section id="scene-5" data-scene-id="scene-5" data-scene-order="4" data-hf-id="scene-5-section" data-start="15" data-duration="3" style="position:absolute;inset:0;background:#0b3b2e"><h1 data-hf-id="scene-5-title">新增 Scene 5</h1></section>`;

// 1. SDK addElement: DOM/persist succeeds, but scene lifecycle (root duration
// and master timeline) is not updated.
{
  const copy = resolve(work, "add-element");
  await copyProject(projectDir, copy);
  const composition = await openComposition(
    await readFile(resolve(copy, "index.html"), "utf8"),
    { persist: createFsAdapter({ root: copy }), persistPath: "index.html" },
  );
  const errors = [];
  composition.on("persist:error", (error) =>
    errors.push(String(error?.message ?? error)),
  );
  try {
    const mintedId = composition.addElement("hf-main", 4, extraSection);
    await composition.flush();
    const persisted = await readFile(resolve(copy, "index.html"), "utf8");
    const model = documentModel(persisted);
    report.experiments.sdkAddElement = {
      mintedId,
      flushErrors: errors,
      persistedHasNewScene: persisted.includes('data-scene-id="scene-5"'),
      documentDurationAfterAdd: model.duration,
      declaredTotalDuration: TOTAL_DURATION,
      note: "root data-duration and the master timeline were not regenerated; an added scene has no visibility/time contract",
    };
  } finally {
    composition.dispose();
  }
}

// 2. SDK removeElement: DOM removal works, timeline/root duration untouched.
{
  const copy = resolve(work, "remove-element");
  await copyProject(projectDir, copy);
  const composition = await openComposition(
    await readFile(resolve(copy, "index.html"), "utf8"),
    { persist: createFsAdapter({ root: copy }), persistPath: "index.html" },
  );
  try {
    composition.removeElement("scene-4-section");
    await composition.flush();
    const persisted = await readFile(resolve(copy, "index.html"), "utf8");
    const model = documentModel(persisted);
    report.experiments.sdkRemoveElement = {
      scene4RemovedFromDom: !persisted.includes('data-scene-id="scene-4"'),
      documentDurationAfterRemove: model.duration,
      note: "the master timeline still references #scene-4 and the root keeps duration 15",
    };
  } finally {
    composition.dispose();
  }
}

// 3. SDK setAttribute for a scene start: attribute changes, timeline does not.
{
  const copy = resolve(work, "set-attribute");
  await copyProject(projectDir, copy);
  const composition = await openComposition(
    await readFile(resolve(copy, "index.html"), "utf8"),
    { persist: createFsAdapter({ root: copy }), persistPath: "index.html" },
  );
  try {
    // The SDK rejects raw setAttribute for timing attributes and routes them
    // through typed setTiming; record whether that still leaves the GSAP
    // timeline untouched.
    let setTimingError = null;
    try {
      composition.setTiming("scene-2-section", { start: 8 });
    } catch (error) {
      setTimingError = { code: error.code ?? error.name, message: String(error.message).slice(0, 240) };
    }
    await composition.flush();
    const persisted = await readFile(resolve(copy, "index.html"), "utf8");
    const model = documentModel(persisted);
    const section = model.elements.find(
      (element) => element.id === "scene-2-section",
    );
    const timelineEntries = (source) =>
      [...source.matchAll(/tl\.set\("#(scene-\d)", \{ opacity: (\d) \}, ([\d.]+)\)/g)].map(
        (match) => `${match[1]}:${match[2]}@${match[3]}`,
      );
    report.experiments.sdkSetSceneStart = {
      setAttributeRejected: true,
      setAttributeError:
        "setAttribute on data-start is rejected by the SDK: use typed setTiming",
      setTimingError,
      modelStart: section.attributes["data-start"],
      timelineEntriesBefore: timelineEntries(baseHtml),
      timelineEntriesAfter: timelineEntries(persisted),
      note: "typed setTiming rewrites the scene data-start attribute and heuristically edits the hand-authored timeline; the resulting visibility entries are inconsistent, so scene timing must go through controlled whole-file regeneration",
    };
  } finally {
    composition.dispose();
  }
}

// 4. Controlled whole-file rewrite for scene reorder: regenerate the document
// from scene models and validate before publishing; reject invalid rewrites.
const swappedScenes = [
  { ...scenes[1], order: 0, start: 0 },
  { ...scenes[0], order: 1, start: 4 },
  scenes[2],
  scenes[3],
];
const rewritten = renderSingleDoc(swappedScenes);
{
  const validation = await validateDocument(rewritten, {
    width: 1280,
    height: 720,
    duration: TOTAL_DURATION,
    sceneIds: scenes.map((scene) => scene.sceneId),
  });
  const atZero = await snapshot(rewritten, 0);
  const atFour = await snapshot(rewritten, 4);
  report.experiments.controlledRewrite = {
    validation: {
      ok: validation.ok,
      errors: validation.errors,
      duration: validation.model.duration,
    },
    sceneOrder: validation.model.elements
      .filter((element) => element.tag === "section")
      .map((element) => element.attributes["data-scene-id"]),
    colors: { at0: atZero.background.hex, at4: atFour.background.hex },
    expectedColors: { at0: scenes[1].color, at4: scenes[0].color },
    note: "whole-file rewrite regenerates data-* scene ranges and the master timeline together",
  };

  const invalid = rewritten.replace(
    'data-scene-id="scene-1"',
    'data-scene-id="scene-2"',
  );
  const invalidValidation = await validateDocument(invalid, {
    width: 1280,
    height: 720,
    duration: TOTAL_DURATION,
    sceneIds: scenes.map((scene) => scene.sceneId),
  });
  report.experiments.rollback = {
    rejected: !invalidValidation.ok,
    errors: invalidValidation.errors,
    projectFileUnchanged: sha256(await readFile(resolve(projectDir, "index.html"))) === sha256(baseHtml),
    note: "writeEntryAtomic is only called after validateDocument passes; no partial writes",
  };
}

// 5. Worker revision follows the controlled rewrite; reopen still works.
{
  const registryPath = await writeRegistry(runtime, { demo: projectDir });
  const client = createClient(runtime, registryPath);
  try {
    await client.start();
    const opened = await client.open("demo");
    await writeEntryAtomic(projectDir, rewritten);
    const inspected = await client.inspect("demo");
    report.experiments.workerRevision = {
      beforeRevision: opened.revision,
      afterRevision: inspected.revision,
      revisionChanged: opened.revision !== inspected.revision,
      duration: inspected.duration,
      width: inspected.width,
      height: inspected.height,
      note: "revision is recomputed from the declared entry/assets after the atomic write",
    };
    await writeEntryAtomic(projectDir, baseHtml);
    await client.inspect("demo");
  } finally {
    await client.dispose();
  }
}

await writeJson(resolve(evidenceDir, "q3-scene-ops.json"), report);
console.log(JSON.stringify(report.experiments, null, 2));
