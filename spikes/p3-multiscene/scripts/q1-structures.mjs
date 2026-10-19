import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { copyFile } from "node:fs/promises";
import {
  artifacts,
  evidenceDir,
  gsapDist,
  resetDir,
  runCli,
  samplePixel,
  ffprobe,
  sha256,
  writeJson,
  ensureTemp,
} from "./lib/util.mjs";
import {
  scenesFixture,
  TOTAL_DURATION,
  renderSceneTemplate,
  renderMasterNested,
  renderSingleDoc,
} from "./lib/scene-templates.mjs";
import {
  generateTestImages,
  installProjectAssets,
  projectAssets,
} from "./lib/assets.mjs";
import { sectionHtml, replaceSectionHtml } from "./lib/doc.mjs";

const work = resolve(artifacts, "q1");
await resetDir(work);
const temp = resolve(work, "temp");
await ensureTemp(temp);
const { images, hashes: imageHashes } = await generateTestImages(
  resolve(work, "images"),
);
const scenes = scenesFixture();
const times = [1.5, 5, 9.5, 13.5];

async function makeProject(name, build) {
  const dir = resolve(work, name);
  await mkdir(dir, { recursive: true });
  const assets = await installProjectAssets(dir, images);
  await build(dir);
  return { dir, projectJson: { entry: "index.html", assets } };
}

async function writeManifest(dir, assets, extra = []) {
  await writeFile(
    resolve(dir, "project.json"),
    JSON.stringify({ entry: "index.html", assets: [...assets, ...extra] }, null, 2),
  );
}

const a = await makeProject("A-nested", async (dir) => {
  await mkdir(resolve(dir, "compositions"), { recursive: true });
  await writeFile(resolve(dir, "index.html"), renderMasterNested(scenes));
  for (const scene of scenes)
    await writeFile(
      resolve(dir, "compositions", `${scene.sceneId}.html`),
      renderSceneTemplate(scene),
    );
  await writeManifest(
    dir,
    [...projectAssets(), "assets/logo.png", ...scenes.map((s) => `assets/shot-${s.order + 1}.png`)].filter((value, index, all) => all.indexOf(value) === index),
    scenes.map((scene) => `compositions/${scene.sceneId}.html`),
  );
});

const b = await makeProject("B-single-doc", async (dir) => {
  await writeFile(resolve(dir, "index.html"), renderSingleDoc(scenes));
  await writeManifest(dir, projectAssets());
});

// Candidate C: one composition file per scene plus a manifest, but no aggregate
// index.html. The CLI is expected to reject the project (evidence, not a block).
const c = await makeProject("C-multi-entry", async (dir) => {
  await mkdir(resolve(dir, "compositions"), { recursive: true });
  for (const scene of scenes)
    await writeFile(
      resolve(dir, "compositions", `${scene.sceneId}.html`),
      renderSceneTemplate(scene, { assetPrefix: "../assets" }),
    );
  await writeFile(
    resolve(dir, "manifest.json"),
    JSON.stringify(
      {
        version: 1,
        scenes: scenes.map((scene) => ({
          sceneId: scene.sceneId,
          entry: `compositions/${scene.sceneId}.html`,
          start: scene.start,
          duration: scene.duration,
        })),
      },
      null,
      2,
    ),
  );
});

function tryCli(args, options) {
  try {
    const result = runCli(args, options);
    return { ok: true, ms: result.ms, stdout: result.stdout };
  } catch (error) {
    const stderr = (error.stderr || error.message).toString();
    return { ok: false, stderr: stderr.slice(0, 1500), firstLine: stderr.split("\n").find((line) => line.trim())?.trim() };
  }
}

async function snapshot(dir, label, time) {
  const outDir = resolve(work, "snapshots", `${label}-${time}`);
  await mkdir(outDir, { recursive: true });
  try {
    const started = performance.now();
    runCli(
      ["snapshot", dir, "--at", String(time), "--no-end", "--keep", "--describe", "false", "--no-browser-gpu", "-o", outDir],
      { cwd: dir, temp },
    );
    const files = execFileSync("find", [outDir, "-name", "*.png", "-type", "f"], { encoding: "utf8" })
      .trim()
      .split("\n")
      .filter(Boolean);
    const bytes = await readFile(files[0]);
    return {
      file: files[0].replace(outDir + "/", ""),
      sha256: sha256(bytes),
      bytes: bytes.length,
      sample: samplePixel(files[0], { x: 40, y: 40 }),
      ms: Math.round(performance.now() - started),
    };
  } catch (error) {
    return { error: (error.stderr || error.message).toString().slice(0, 800) };
  }
}

async function snapshotsFor(dir, label) {
  const result = {};
  for (const time of times) result[time] = await snapshot(dir, label, time);
  return result;
}

async function renderProject(dir, label) {
  const output = resolve(work, `${label}.mp4`);
  const log = resolve(artifacts, "q1", `render-${label}.log`);
  const started = performance.now();
  const result = runCli(
    ["render", dir, "-c", "index.html", "-o", output, "--fps", "30", "--format", "mp4", "--quality", "standard", "--workers", "1", "--no-browser-gpu"],
    { cwd: dir, temp, timeoutMs: 300000 },
  );
  await writeFile(log, result.stdout);
  const bytes = await readFile(output);
  const probe = ffprobe(output);
  return {
    output: output.replace(root(), ""),
    ms: Math.round(performance.now() - started),
    bytes: bytes.length,
    sha256: sha256(bytes),
    first: samplePixel(output, { x: 40, y: 40, time: 1.5 }),
    frames: Object.fromEntries(times.map((time) => [time, samplePixel(output, { x: 40, y: 40, time })])),
    probe,
    log,
  };
}

function root() {
  return resolve(import.meta.dirname, "..");
}

const report = {
  generatedAt: new Date().toISOString(),
  node: process.version,
  totalDuration: TOTAL_DURATION,
  assets: {
    colors: { logo: "#facc15", shots: ["#22d3ee", "#a3e635", "#f472b6", "#c084fc"] },
    hashes: imageHashes,
  },
  structures: {
    A: {
      projectDir: a.dir,
      compositions: tryCli(["compositions", a.dir, "--json"], { cwd: a.dir, temp }),
      snapshots: await snapshotsFor(a.dir, "A"),
      render: await renderProject(a.dir, "A-nested"),
    },
    B: {
      projectDir: b.dir,
      compositions: tryCli(["compositions", b.dir, "--json"], { cwd: b.dir, temp }),
      snapshots: await snapshotsFor(b.dir, "B"),
      render: await renderProject(b.dir, "B-single-doc"),
    },
    C: {
      projectDir: c.dir,
      compositions: tryCli(["compositions", c.dir, "--json"], { cwd: c.dir, temp }),
      renderWithoutRoot: tryCli(["render", c.dir, "-o", resolve(work, "C.mp4")], { cwd: c.dir, temp }),
      renderSpecificComposition: tryCli(
        ["render", "-c", "compositions/scene-1.html", "-o", resolve(work, "C-scene1.mp4")],
        { cwd: c.dir, temp },
      ),
    },
  },
};

// Single-scene rewrite isolation (candidate B): replace one section and prove
// the other scenes stay byte-identical and their rendered frames do not change.
const beforeHtml = await readFile(resolve(b.dir, "index.html"), "utf8");
const modified = scenes.map((scene) =>
  scene.sceneId === "scene-2"
    ? { ...scene, title: "重写后的 Scene 2", color: "#0ea5e9", accent: "#e0f2fe" }
    : scene,
);
const aiHtml = renderSingleDoc(modified);
const rewritten = replaceSectionHtml(
  beforeHtml,
  "scene-2",
  sectionHtml(aiHtml, "scene-2"),
);
await writeFile(resolve(b.dir, "index.html"), rewritten);
report.singleSceneRewrite = {
  changedScene: "scene-2",
  otherSectionsUnchanged: scenes
    .filter((scene) => scene.sceneId !== "scene-2")
    .map((scene) => ({
      sceneId: scene.sceneId,
      unchanged: sectionHtml(beforeHtml, scene.sceneId) === sectionHtml(rewritten, scene.sceneId),
    })),
  snapshotsBefore: report.structures.B.snapshots,
  snapshotsAfter: await snapshotsFor(b.dir, "B-rewritten"),
  frameAtScene2Before: report.structures.B.snapshots["5"]?.sha256,
  frameAtScene2After: (await snapshot(b.dir, "B-rewritten-detail", 5)).sha256,
};

await writeJson(resolve(evidenceDir, "q1-structures.json"), report);
console.log(
  JSON.stringify(
    {
      evidence: resolve(evidenceDir, "q1-structures.json"),
      A: { renderMs: report.structures.A.render.ms, probe: report.structures.A.render.probe, colors: report.structures.A.render.frames },
      B: { renderMs: report.structures.B.render.ms, probe: report.structures.B.render.probe, colors: report.structures.B.render.frames },
      C: report.structures.C.compositions.firstLine,
      singleScene: report.singleSceneRewrite.otherSectionsUnchanged,
    },
    null,
    2,
  ),
);
