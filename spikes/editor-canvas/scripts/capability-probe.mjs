#!/usr/bin/env node
// P3-005-B capability probe: which direct-manipulation writes can actually be
// persisted by the shipped worker today, and which only exist in the SDK.
//
// No engine code is modified: the probe uses the public worker/client protocol
// for protocol-level writes, and a throwaway project copy + the SDK's public
// editing API to show what a Host-side style write would do outside the
// worker. The second half demonstrates that regenerating a scene (the current
// scene.update path) overwrites element-level style edits.
import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { CanvasHarness, REPO_ROOT, SPIKE_ROOT } from "./lib/worker-harness.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const WORKER_ROOT = resolve(REPO_ROOT, "packages/video-engine-worker");
const SDK_ENTRY = resolve(WORKER_ROOT, "node_modules/@hyperframes/sdk/dist/index.js");
const SDK_FS_ADAPTER = resolve(
  WORKER_ROOT,
  "node_modules/@hyperframes/sdk/dist/adapters/fs.js",
);
const OUT = resolve(SPIKE_ROOT, "evidence");

function sha256Hex(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function titlePosition(html) {
  const match = html.match(
    /<h1[^>]*data-hf-id="scene-1-title"[^>]*style="([^"]*)"[^>]*>/,
  );
  return match ? { style: match[1] } : null;
}

async function readSnapshotEntry(harness, revision) {
  const snapshot = await harness.createSnapshot(revision);
  const entry = await readFile(
    resolve(harness.previewRoot, snapshot.snapshotId, snapshot.entry),
    "utf8",
  );
  return { snapshot, entry };
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
    kind: "p3-005b-capability-probe",
    startedAt: new Date().toISOString(),
    versions: { node: process.version },
    worker: {},
    sdk: {},
    regeneration: {},
    merge: {},
    matrix: [],
    proposals: {},
    failures: [],
  };
  const harness = new CanvasHarness({
    runDir: await mkdtemp(resolve(SPIKE_ROOT, "artifacts", "capability-run-")),
  });
  let staticClient = null;
  try {
    await harness.initialize();
    await harness.createProject();
    evidence.versions.worker = harness.doctor;
    let inspected = await harness.inspect();
    const initialRevision = inspected.revision;
    evidence.worker.initial = {
      projectId: harness.project.projectId,
      revision: initialRevision,
      duration: inspected.duration,
      scenes: inspected.scenes.map((scene) => ({
        sceneId: scene.sceneId,
        start: scene.start,
        duration: scene.duration,
      })),
      capabilities: harness.buildCatalogue(inspected).map((entry) => ({
        stableId: entry.stableId,
        capabilities: entry.capabilities,
      })),
    };
    const client = harness.client;

    // 1) Text write through the typed edit protocol.
    const textEdit = await client.edit({
      projectId: harness.project.projectId,
      expectedRevision: inspected.revision,
      operationId: "cap-text",
      ops: [{ type: "text", target: "scene-1-title", text: "文字写回已验证" }],
    });
    inspected = await harness.inspect();
    evidence.worker.text = {
      revisionBefore: initialRevision,
      revisionAfter: textEdit.revision,
      persisted: inspected.elements.find((e) => e.stableId === "scene-1-title")?.text,
      operationId: textEdit.operationId,
    };

    // 2) Timing write through the typed edit protocol.
    const timingEdit = await client.edit({
      projectId: harness.project.projectId,
      expectedRevision: inspected.revision,
      operationId: "cap-timing",
      ops: [
        { type: "timing", target: "scene-2-subtitle", start: 5.3, duration: 3.5 },
      ],
    });
    inspected = await harness.inspect();
    evidence.worker.timing = {
      revisionBefore: textEdit.revision,
      revisionAfter: timingEdit.revision,
      persisted: inspected.elements.find((e) => e.stableId === "scene-2-subtitle")
        ?.timing,
    };

    // 3) Direct-manipulation op types are not part of the protocol.
    const unsupported = [];
    for (const op of [
      { type: "layout", target: "scene-1-title", box: { left: 120, top: 240, width: 800, height: 80 }, unit: "composition-px" },
      { type: "style", target: "scene-1-title", styles: { color: "#ff0000" } },
      { type: "move", target: "scene-1-title", dx: 10, dy: 10 },
      { type: "resize", target: "scene-1-title", width: 800, height: 80 },
      { type: "color", target: "scene-1-title", color: "#ff0000" },
    ]) {
      try {
        await client.edit({
          projectId: harness.project.projectId,
          expectedRevision: inspected.revision,
          operationId: `cap-op-${op.type}`,
          ops: [op],
        });
        unsupported.push({ op: op.type, accepted: true });
      } catch (error) {
        unsupported.push({ op: op.type, accepted: false, code: error.code, message: error.message });
      }
    }
    evidence.worker.unsupportedEditOps = unsupported;

    // 4) Scene-level visual fields are persistable via whole-scene rewrite.
    const positionsBefore = titlePosition(
      (await readSnapshotEntry(harness, inspected.revision)).entry,
    );
    const sceneUpdate = await client.sceneUpdate({
      projectId: harness.project.projectId,
      expectedRevision: inspected.revision,
      operationId: "cap-scene-color",
      sceneId: "scene-1",
      template: {
        duration: 5,
        title: "文字写回已验证",
        color: "#123456",
        accent: "#abcdef",
      },
    });
    const afterScene = await readSnapshotEntry(harness, sceneUpdate.revision);
    evidence.worker.sceneLevel = {
      revisionAfter: sceneUpdate.revision,
      colorPersisted: afterScene.entry.includes("background:#123456"),
      accentPersisted: afterScene.entry.includes("background:#abcdef"),
      positionsBefore,
      positionsAfter: titlePosition(afterScene.entry),
      note: "scene.update rewrites the whole scene from the template model; it can persist scene color/accent/logo/shot/duration but not element-level layout/styles.",
    };
    const positionStable =
      positionsBefore && titlePosition(afterScene.entry)
        ? positionsBefore.style === titlePosition(afterScene.entry).style
        : false;
    evidence.worker.sceneLevel.positionsTemplateFixed = positionStable;

    // 5) SDK-level element style write on a throwaway project copy.
    const copyRoot = resolve(harness.runDir, "sdk-copy");
    const copyDir = resolve(copyRoot, "project");
    await cp(harness.projectDir, copyDir, { recursive: true });
    const sdk = await import(pathToFileURL(SDK_ENTRY).href);
    const fsAdapter = await import(pathToFileURL(SDK_FS_ADAPTER).href);
    const copyHtml = await readFile(resolve(copyDir, "index.html"), "utf8");
    const copyHashBefore = sha256Hex(Buffer.from(copyHtml));
    const composition = await sdk.openComposition(copyHtml, {
      persist: fsAdapter.createFsAdapter({ root: copyDir }),
      persistPath: "index.html",
    });
    let styleWrite = { attempted: true };
    try {
      composition.setStyle("scene-1-title", {
        left: "160px",
        top: "260px",
        width: "800px",
        height: "96px",
        color: "#ff0000",
      });
      await composition.flush();
      styleWrite = { attempted: true, flushed: true };
    } catch (error) {
      styleWrite = {
        attempted: true,
        flushed: false,
        code: error?.code,
        message: String(error?.message ?? error),
      };
    } finally {
      composition.dispose();
    }
    const copyHtmlAfter = await readFile(resolve(copyDir, "index.html"), "utf8");
    const appliedStyle = titlePosition(copyHtmlAfter)?.style ?? null;
    evidence.sdk = {
      package: "@hyperframes/sdk",
      version: JSON.parse(
        await readFile(
          resolve(WORKER_ROOT, "node_modules/@hyperframes/sdk/package.json"),
          "utf8",
        ),
      ).version,
      methods: Object.getOwnPropertyNames(Object.getPrototypeOf(composition)),
      styleWrite,
      copyHashBefore,
      copyHashAfter: sha256Hex(Buffer.from(copyHtmlAfter)),
      persistedTitleStyle: appliedStyle,
      persistedElementStyle: {
        left: /left:\s*160px/.test(appliedStyle ?? ""),
        top: /top:\s*260px/.test(appliedStyle ?? ""),
        width: /width:\s*800px/.test(appliedStyle ?? ""),
        height: /height:\s*96px/.test(appliedStyle ?? ""),
        color: /color:\s*(#ff0000|rgb\(255, 0, 0\))/.test(appliedStyle ?? ""),
      },
      note: "The SDK can persist inline element styles on a Host-owned copy, but the shipped worker exposes no typed op for them (see unsupportedEditOps).",
    };

    // 6) Worker scene regeneration after the SDK edit: the current scene.*
    //    path rebuilds the document from the scene model and drops element
    //    style deltas.
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
      operationId: "cap-regenerate",
      sceneId: "scene-1",
      template: { duration: 5, title: "文字写回已验证" },
    });
    const copyHtmlRegenerated = await readFile(resolve(copyDir, "index.html"), "utf8");
    evidence.regeneration = {
      openedRevision: openedCopy.revision,
      revisionAfter: regenerated.revision,
      titleStyleAfterRegeneration: titlePosition(copyHtmlRegenerated)?.style ?? null,
      sdkStyleSurvived:
        /left:\s*160px/.test(titlePosition(copyHtmlRegenerated)?.style ?? "") ||
        /top:\s*260px/.test(titlePosition(copyHtmlRegenerated)?.style ?? ""),
      note: "scene.update regenerates the whole document from the template model; element-level style/position deltas written by the SDK are overwritten. A future layout/style op must be integrated into the generator + history + merge path, not implemented as an ad-hoc SDK write.",
    };

    // 7) Merge signature already carries inlineStyles (static source evidence),
    //    which is where element-level style changes would have to participate.
    const mergeSource = await readFile(
      resolve(REPO_ROOT, "packages/video-engine-worker/src/merge.mjs"),
      "utf8",
    );
    const signatureLine = mergeSource
      .split("\n")
      .findIndex((line) => line.includes("inlineStyles: element.inlineStyles"));
    evidence.merge = {
      file: "packages/video-engine-worker/src/merge.mjs",
      inlineStylesInSignature: signatureLine >= 0,
      snippet: mergeSource.split("\n").slice(signatureLine, signatureLine + 3).join("\n"),
      note: "human/AI merge compares inlineStyles per stableId; a typed style/layout op would flow through the same element signature and could conflict, while scene.* regeneration currently bypasses element deltas.",
    };

    // 8) Capability matrix + minimal typed-op proposals.
    evidence.matrix = [
      {
        capability: "文字内容",
        currentPath: "edit {type:'text',target,text}",
        persisted: true,
        evidence: "worker.text.persisted",
      },
      {
        capability: "元素显式时间",
        currentPath: "edit {type:'timing',target,start?,duration?}",
        persisted: true,
        evidence: "worker.timing.persisted",
      },
      {
        capability: "Scene 颜色/强调色/Logo/截图/时长/标题",
        currentPath: "scene.update（整 Scene 重写）",
        persisted: true,
        evidence: "worker.sceneLevel",
      },
      {
        capability: "元素位置 left/top",
        currentPath: "无 worker 方法；SDK setStyle 仅在 Host 自有副本生效",
        persisted: false,
        evidence: "worker.unsupportedEditOps + sdk.styleWrite",
      },
      {
        capability: "元素尺寸 width/height",
        currentPath: "无 worker 方法；SDK setStyle 仅副本",
        persisted: false,
        evidence: "worker.unsupportedEditOps + sdk.styleWrite",
      },
      {
        capability: "元素颜色/字体/字重等样式",
        currentPath: "无 worker 方法（scene.update 只能改 Scene 级颜色）",
        persisted: false,
        evidence: "worker.unsupportedEditOps",
      },
      {
        capability: "拖动/缩放直接操纵",
        currentPath: "无协议方法；canvas 仅编辑层暂态 + 提交被拒",
        persisted: false,
        evidence: "canvas-evidence.json gap.*",
      },
      {
        capability: "层级/z-index/旋转",
        currentPath: "无方法",
        persisted: false,
        evidence: "worker.unsupportedEditOps",
      },
    ];
    evidence.proposals = {
      layoutOp: {
        shape: {
          type: "layout",
          target: "<stableId>",
          box: { left: "number", top: "number", width: "number", height: "number" },
          unit: "composition-px",
        },
        constraints: [
          "composition coordinates are integer-ish CSS px in the document viewport (0..data-width/height)",
          "only elements with an explicit layout capability (absolutely positioned text/media in the controlled template) accept it",
          "must go through expectedRevision + operationId idempotency and recordWrite history like text/timing",
          "must not change GSAP timeline entries: inline left/top are the static base position, GSAP y/scaleX animations are relative transforms",
          "min size and canvas bounds must be validated; rejects return E_PARAMS/E_REVISION_CONFLICT as today",
        ],
      },
      styleOp: {
        shape: {
          type: "style",
          target: "<stableId>",
          styles: { "<property>": "<string|null>" },
        },
        allowlist: ["color", "fontSize", "fontWeight", "textAlign", "letterSpacing"],
        constraints: [
          "property/value allowlist validated in the worker, not in the UI",
          "style changes participate in the existing stableId merge signature (merge.mjs includes inlineStyles)",
          "scene.update/project.revise regeneration must either preserve element deltas or return an explicit conflict instead of silently dropping them",
        ],
      },
      hostContract: {
        coordinates: "Host↔sandbox messages use composition CSS px; Host maps letterbox/scale; screen coordinates never cross the boundary",
        unit: "composition-px, document viewport (data-width×data-height)",
        revision: "every commit carries expectedRevision from the displayed snapshot; stale commits surface E_REVISION_CONFLICT",
      },
    };
    evidence.summary = {
      persistedCapabilities: evidence.matrix.filter((row) => row.persisted).map((row) => row.capability),
      gapCapabilities: evidence.matrix.filter((row) => !row.persisted).map((row) => row.capability),
      unsupportedOpCodes: unsupported.map((entry) => `${entry.op}:${entry.code}`),
      sdkStylePersistedButWorkerUnreachable:
        Object.values(evidence.sdk.persistedElementStyle).filter(Boolean).length >= 3,
      regenerationDropsElementStyle: evidence.regeneration.sdkStyleSurvived === false,
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
        .replaceAll(SPIKE_ROOT, "<spike>"),
    );
    sanitized.evidenceFile = "evidence/capability-evidence.json";
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
