#!/usr/bin/env node
// P3-006-B capability probe on the 0.3.0 engine: which direct-manipulation
// writes now persist through the shared worker, how scene regeneration and
// three-way merge treat them, and what remains unsupported.
//
// Writes a NEW evidence file (default spikes/editor-canvas/evidence/p3-006b/);
// the committed 0.2.1 capability evidence is never overwritten.
import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  CanvasHarness,
  REPO_ROOT,
  SPIKE_ROOT,
} from "./lib/worker-harness.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const WORKER_ROOT = resolve(REPO_ROOT, "packages/video-engine-worker");
const SDK_ENTRY = resolve(WORKER_ROOT, "node_modules/@hyperframes/sdk/dist/index.js");
const SDK_FS_ADAPTER = resolve(
  WORKER_ROOT,
  "node_modules/@hyperframes/sdk/dist/adapters/fs.js",
);
const OUT_INDEX = process.argv.indexOf("--out");
const OUT =
  OUT_INDEX >= 0
    ? resolve(process.argv[OUT_INDEX + 1])
    : resolve(SPIKE_ROOT, "evidence", "p3-006b");

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

const sceneSpec = (overrides = {}) => ({
  duration: 5,
  title: "能力矩阵场景",
  subtitle: "副标题",
  badge: "AI",
  logo: "assets/logo.png",
  ...overrides,
});

async function snapshotEntry(harness, revision) {
  const snapshot = await harness.createSnapshot(revision);
  return readFile(
    resolve(harness.previewRoot, snapshot.snapshotId, snapshot.entry),
    "utf8",
  );
}

async function loadStaticWorker(clientModule, configPath) {
  const client = new clientModule.WorkerClient({
    nodeExecutable: process.execPath,
    workerEntry: resolve(REPO_ROOT, "packages/video-engine-worker/src/worker.mjs"),
    registryPath: configPath,
    startupTimeoutMs: 15000,
    requestTimeoutMs: 20000,
    shutdownTimeoutMs: 15000,
    forceKillTimeoutMs: 2000,
    maxPending: 32,
    maxLineBytes: 131072,
    maxStderrBytes: 16384,
  });
  await client.start();
  return client;
}

async function main() {
  await mkdir(OUT, { recursive: true });
  await mkdir(resolve(SPIKE_ROOT, "artifacts"), { recursive: true });
  const evidence = {
    kind: "p3-006b-capability-probe",
    startedAt: new Date().toISOString(),
    engine: null,
    versions: { node: process.version },
    worker: {},
    unsupported: {},
    sceneRegeneration: {},
    merge: {},
    sdk: {},
    matrix: [],
    proposals: {},
    failures: [],
  };
  const harness = new CanvasHarness({
    runDir: await mkdtemp(resolve(SPIKE_ROOT, "artifacts", "p3-006b-probe-")),
  });
  let staticClient = null;
  try {
    await harness.initialize();
    await harness.createProject();
    let inspected = await harness.inspect();
    const scene = await harness.client.sceneUpdate({
      projectId: harness.project.projectId,
      expectedRevision: inspected.revision,
      operationId: "probe-scene",
      sceneId: "scene-1",
      template: sceneSpec(),
    });
    inspected = await harness.inspect();
    const workerPkg = JSON.parse(
      await readFile(resolve(WORKER_ROOT, "package.json"), "utf8"),
    );
    const clientPkg = JSON.parse(
      await readFile(
        resolve(REPO_ROOT, "packages/video-engine-client/package.json"),
        "utf8",
      ),
    );
    evidence.engine = {
      worker: `${workerPkg.name}@${workerPkg.version}`,
      client: `${clientPkg.name}@${clientPkg.version}`,
      fixedEngineBase: "df4b74f (0.2.1)",
    };
    evidence.versions.worker = harness.doctor;
    evidence.worker.initial = {
      revision: inspected.revision,
      title: inspected.elements.find((e) => e.stableId === "scene-1-title"),
      logo: inspected.elements.find((e) => e.stableId === "scene-1-logo"),
    };

    const layoutEdit = await harness.client.edit({
      projectId: harness.project.projectId,
      expectedRevision: scene.revision,
      operationId: "probe-layout-style",
      ops: [
        { type: "text", target: "scene-1-title", text: "持久化标题" },
        { type: "timing", target: "scene-1-subtitle", start: 0.4, duration: 4.4 },
        {
          type: "layout",
          target: "scene-1-title",
          unit: "composition-px",
          box: { left: 200.1234, top: 250 },
        },
        {
          type: "style",
          target: "scene-1-title",
          styles: { color: "#00FF00", fontSize: 88, fontWeight: 700, textAlign: "center" },
        },
        {
          type: "layout",
          target: "scene-1-logo",
          unit: "composition-px",
          box: { left: 900, top: 300, width: 240, height: 240 },
        },
      ],
    });
    inspected = await harness.inspect();
    const title = inspected.elements.find((e) => e.stableId === "scene-1-title");
    const logo = inspected.elements.find((e) => e.stableId === "scene-1-logo");
    const snapshotHtml = await snapshotEntry(harness, inspected.revision);
    evidence.worker.layoutStyle = {
      revision: inspected.revision,
      title: { text: title.text, layout: title.layout, style: title.style },
      logo: { layout: logo.layout },
      htmlHasManagedStyles:
        /left:\s*200\.123px/.test(snapshotHtml) &&
        /color:\s*#00ff00/.test(snapshotHtml) &&
        /width:\s*240px/.test(snapshotHtml),
      snapshotOmitsTransform: !/transform:/.test(snapshotHtml),
      capabilities: title.capabilities,
    };

    const unsupported = [];
    for (const op of [
      { type: "move", target: "scene-1-title", dx: 10, dy: 10 },
      { type: "resize", target: "scene-1-title", width: 800, height: 80 },
      { type: "color", target: "scene-1-title", color: "#ff0000" },
      { type: "style", target: "scene-1-title", styles: { transform: "rotate(5deg)" } },
      { type: "style", target: "scene-1-rule", styles: { color: "#ffffff" } },
      { type: "layout", target: "scene-1-section", unit: "composition-px", box: { left: 10 } },
    ]) {
      try {
        await harness.client.edit({
          projectId: harness.project.projectId,
          expectedRevision: inspected.revision,
          operationId: `probe-op-${op.type}-${op.styles ? Object.keys(op.styles)[0] : op.target}`,
          ops: [op],
        });
        unsupported.push({ op: op.type, target: op.target, accepted: true });
      } catch (error) {
        unsupported.push({
          op: op.type,
          target: op.target,
          accepted: false,
          code: error.code,
        });
      }
    }
    evidence.unsupported = unsupported;

    const updated = await harness.client.sceneUpdate({
      projectId: harness.project.projectId,
      expectedRevision: inspected.revision,
      operationId: "probe-scene-update",
      sceneId: "scene-1",
      template: sceneSpec({ title: "改名后场景", duration: 6 }),
    });
    inspected = await harness.inspect();
    const updatedTitle = inspected.elements.find((e) => e.stableId === "scene-1-title");
    const updatedLogo = inspected.elements.find((e) => e.stableId === "scene-1-logo");
    evidence.sceneRegeneration = {
      revision: updated.revision,
      title: { text: updatedTitle.text, layout: updatedTitle.layout, style: updatedTitle.style },
      logo: { layout: updatedLogo.layout },
      preserved:
        updatedTitle.layout.left === 200.123 &&
        updatedTitle.style.color === "#00ff00" &&
        updatedLogo.layout.width === 240,
    };

    const current = await harness.inspect();
    const baseRevision = current.revision;
    const humanLayout = await harness.client.edit({
      projectId: harness.project.projectId,
      expectedRevision: baseRevision,
      operationId: "probe-merge-layout",
      ops: [
        {
          type: "layout",
          target: "scene-1-title",
          unit: "composition-px",
          box: { top: 260 },
        },
      ],
    });
    const merged = await harness.client.projectRevise({
      projectId: harness.project.projectId,
      baseRevision,
      expectedRevision: humanLayout.revision,
      operationId: "probe-merge",
      sceneId: "scene-1",
      template: sceneSpec({ title: "AI 改写文案", duration: 6 }),
    });
    const mergedInspect = await harness.inspect();
    const mergedTitle = mergedInspect.elements.find((e) => e.stableId === "scene-1-title");
    evidence.merge = {
      written: merged.written,
      text: mergedTitle.text,
      layout: mergedTitle.layout,
      style: mergedTitle.style,
      mergedHumanLayoutWithAiText:
        merged.written === true &&
        mergedTitle.text === "AI 改写文案" &&
        mergedTitle.layout.top === 260 &&
        mergedTitle.layout.left === 200.123,
    };

    const conflictBase = mergedInspect.revision;
    const humanText = await harness.client.edit({
      projectId: harness.project.projectId,
      expectedRevision: conflictBase,
      operationId: "probe-conflict-human",
      ops: [{ type: "text", target: "scene-1-title", text: "人工文案" }],
    });
    const conflict = await harness.client.projectRevise({
      projectId: harness.project.projectId,
      baseRevision: conflictBase,
      expectedRevision: humanText.revision,
      operationId: "probe-conflict",
      sceneId: "scene-1",
      template: sceneSpec({ title: "AI 文案冲突", duration: 6 }),
    });
    evidence.merge.conflict = {
      written: conflict.written,
      conflicts: conflict.conflicts.map((entry) => ({
        stableId: entry.stableId,
        reason: entry.reason,
        field: entry.field,
        humanValue: entry.humanValue,
        aiValue: entry.aiValue,
      })),
    };

    const copyRoot = resolve(harness.runDir, "sdk-copy");
    const copyDir = resolve(copyRoot, "project");
    await cp(harness.projectDir, copyDir, { recursive: true });
    const sdk = await import(pathToFileURL(SDK_ENTRY).href);
    const fsAdapter = await import(pathToFileURL(SDK_FS_ADAPTER).href);
    const copyHtml = await readFile(resolve(copyDir, "index.html"), "utf8");
    const composition = await sdk.openComposition(copyHtml, {
      persist: fsAdapter.createFsAdapter({ root: copyDir }),
      persistPath: "index.html",
    });
    try {
      composition.setStyle("scene-1-title", {
        left: "320px",
        top: "240px",
        color: "#0000ff",
        transform: "rotate(5deg)",
      });
      await composition.flush();
    } finally {
      composition.dispose();
    }
    const sdkStyledHtml = await readFile(resolve(copyDir, "index.html"), "utf8");
    const staticConfigPath = resolve(harness.runDir, "static-config.json");
    await writeFile(
      staticConfigPath,
      JSON.stringify({
        root: copyRoot,
        projects: { copy: copyDir },
        outputRoot: resolve(harness.runDir, "static-output"),
      }),
    );
    const clientModule = await import(
      pathToFileURL(
        resolve(REPO_ROOT, "packages/video-engine-client/src/index.mjs"),
      ).href
    );
    staticClient = await loadStaticWorker(clientModule, staticConfigPath);
    const openedCopy = await staticClient.open("copy");
    const regenerated = await staticClient.sceneUpdate({
      projectId: "copy",
      expectedRevision: openedCopy.revision,
      operationId: "probe-regenerate",
      sceneId: "scene-1",
      template: sceneSpec({ title: "SDK 副本重生成", duration: 5 }),
    });
    const copyAfter = await readFile(resolve(copyDir, "index.html"), "utf8");
    const titleTag =
      copyAfter.match(/<h1[^>]*data-hf-id="scene-1-title"[^>]*>/)?.[0] ?? "";
    evidence.sdk = {
      package: "@hyperframes/sdk",
      version: JSON.parse(
        await readFile(
          resolve(WORKER_ROOT, "node_modules/@hyperframes/sdk/package.json"),
          "utf8",
        ),
      ).version,
      methods: Object.getOwnPropertyNames(Object.getPrototypeOf(composition)),
      styledHtmlHash: sha256(Buffer.from(sdkStyledHtml)),
      regenerationRevision: regenerated.revision,
      titleStyleAfterRegeneration: titleTag,
      supportedStylePreserved:
        /left:\s*320px/.test(titleTag) && /color:\s*#0000ff/.test(titleTag),
      unsupportedTransformDropped: !/rotate\(5deg\)/.test(titleTag),
      note: "0.3.0 regenerates scenes but transplants supported manual layout/style deltas; arbitrary CSS outside the controlled model (e.g. rotate) is still dropped and must not be used for persistence.",
    };

    evidence.matrix = [
      {
        capability: "文字内容",
        currentPath: "edit {type:'text'}",
        persisted: true,
        evidence: "worker.layoutStyle.title.text",
      },
      {
        capability: "元素显式时间",
        currentPath: "edit {type:'timing'}",
        persisted: true,
        evidence: "worker.layoutStyle (atomic batch)",
      },
      {
        capability: "元素位置 left/top（静态基座）",
        currentPath: "edit {type:'layout', unit:'composition-px', box:{left,top}}",
        persisted: true,
        evidence: "worker.layoutStyle + sceneRegeneration.preserved",
      },
      {
        capability: "元素尺寸 width/height",
        currentPath: "edit {type:'layout', box:{width,height}}",
        persisted: true,
        evidence: "worker.layoutStyle.logo.layout + sceneRegeneration.preserved",
      },
      {
        capability: "文字颜色/字号/字重/对齐",
        currentPath: "edit {type:'style', styles:{color,fontSize,fontWeight,textAlign}}",
        persisted: true,
        evidence: "worker.layoutStyle.title.style",
      },
      {
        capability: "人工 layout/style + AI 文案合并",
        currentPath: "project.revise 字段级三方合并",
        persisted: true,
        evidence: "merge.mergedHumanLayoutWithAiText",
      },
      {
        capability: "同字段双改 / AI 删除人工覆盖对象的显式冲突（不静默覆盖）",
        currentPath: "written:false conflicts[{field,humanValue,aiValue}] / AI_DELETE_HUMAN_MODIFY",
        persisted: true,
        evidence: "merge.conflict",
        note: "handled as explicit conflict; no silent overwrite",
      },
      {
        capability: "拖动/缩放的任意 CSS、旋转、层级",
        currentPath: "无受控模型；move/resize/color 形状仍 E_PARAMS",
        persisted: false,
        evidence: "unsupported",
      },
      {
        capability: "字体族/多选/清除覆盖",
        currentPath: "v1 不支持",
        persisted: false,
        evidence: "README limits",
      },
    ];
    evidence.proposals = {
      layoutOp: {
        shape: {
          type: "layout",
          target: "<stableId>",
          unit: "composition-px",
          box: { left: "number?", top: "number?", width: "number?", height: "number?" },
        },
        constraints: [
          "non-empty patch; 1/1000 px normalization; canvas bounds when sizes are known",
          "static composition base, never the animated rect or a transform",
          "template leaf capability only (title/subtitle/badge/rule/logo/shot)",
        ],
      },
      styleOp: {
        shape: {
          type: "style",
          target: "<stableId>",
          styles: { color: "string?", fontSize: "number?", fontWeight: "number?", textAlign: "string?" },
        },
        constraints: [
          "controlled allowlist only; arbitrary CSS/url/transform rejected",
          "text-bearing template leaves only (title/subtitle/badge)",
        ],
      },
    };
    evidence.summary = {
      persistedCapabilities: evidence.matrix
        .filter((row) => row.persisted)
        .map((row) => row.capability),
      gapCapabilities: evidence.matrix
        .filter((row) => !row.persisted)
        .map((row) => row.capability),
      sceneRegenerationPreserved: evidence.sceneRegeneration.preserved,
      mergePreserved: evidence.merge.mergedHumanLayoutWithAiText,
      fieldConflict: evidence.merge.conflict.conflicts[0]?.field ?? null,
      unsupportedCodes: evidence.unsupported.map((entry) => `${entry.op}:${entry.code}`),
    };
  } catch (error) {
    evidence.failures.push(String(error?.stack ?? error));
    process.exitCode = 1;
  } finally {
    if (staticClient) await staticClient.dispose().catch(() => {});
    await harness.cleanup().catch(() => {});
    evidence.finishedAt = new Date().toISOString();
    const sanitized = JSON.parse(
      JSON.stringify(evidence)
        .replaceAll(REPO_ROOT, "<repo>")
        .replaceAll(SPIKE_ROOT, "<spike>")
        .replaceAll(OUT, "<evidence>"),
    );
    sanitized.evidenceFile = "evidence/p3-006b/capability-evidence.json";
    await writeFile(
      resolve(OUT, "capability-evidence.json"),
      JSON.stringify(sanitized, null, 2) + "\n",
    );
    console.log(
      JSON.stringify({
        summary: evidence.summary,
        failures: evidence.failures.map((entry) => entry.split("\n")[0]),
        evidence: resolve(OUT, "capability-evidence.json"),
      }),
    );
  }
}

main();
