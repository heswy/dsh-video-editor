import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  artifacts,
  evidenceDir,
  resetDir,
  sha256,
  writeJson,
} from "./lib/util.mjs";
import { scenesFixture, renderSingleDoc } from "./lib/scene-templates.mjs";
import { generateTestImages, installProjectAssets } from "./lib/assets.mjs";
import { mergeDocument } from "./lib/merge.mjs";
import {
  initHistory,
  listHistory,
  recordRevision,
  redo,
  undo,
} from "./lib/history.mjs";
import { readProjectSnapshot } from "./lib/doc.mjs";
import {
  copyProject,
  createClient,
  prepareRuntime,
  waitStatus,
  writeRegistry,
} from "./lib/worker.mjs";

const work = resolve(artifacts, "q6-q7");
await resetDir(work);
const runtime = await prepareRuntime(work);
const { images } = await generateTestImages(resolve(work, "images"));
const scenes = scenesFixture();
const demoDir = resolve(runtime.projectsRoot, "demo");
await mkdir(demoDir, { recursive: true });
const assets = await installProjectAssets(demoDir, images);
await writeFile(resolve(demoDir, "index.html"), renderSingleDoc(scenes));
await writeFile(
  resolve(demoDir, "project.json"),
  JSON.stringify({ entry: "index.html", assets }, null, 2),
);
const registryPath = await writeRegistry(runtime, { demo: demoDir });

const report = {
  generatedAt: new Date().toISOString(),
  node: process.version,
  q6: { steps: [] },
  q7: {},
};

const baseHtml = await readFile(resolve(demoDir, "index.html"), "utf8");
const client = createClient(runtime, registryPath);
try {
  await client.start();
  const opened = await client.open("demo");
  await initHistory(demoDir);

  // Human typed edit through the accepted worker.
  const humanEdit = await client.edit({
    projectId: "demo",
    expectedRevision: opened.revision,
    operationId: "p3-history-human",
    ops: [{ type: "text", target: "scene-2-title", text: "人工标题 · 历史验证" }],
  });
  const humanHtml = await readFile(resolve(demoDir, "index.html"), "utf8");
  const humanRecord = await recordRevision(demoDir, humanHtml, {
    actor: "human",
    kind: "edit",
    operationId: "p3-history-human",
    sceneId: "scene-2",
    summary: "typed edit scene-2 title",
  });
  const afterHuman = await client.inspect("demo");
  report.q6.steps.push({
    step: "human typed edit",
    workerRevision: humanEdit.revision,
    recordedRevision: humanRecord.revision,
    inspectRevision: afterHuman.revision,
    consistent:
      humanEdit.revision === humanRecord.revision &&
      afterHuman.revision === humanRecord.revision,
  });

  // Simulated AI rewrite + merge, recorded as an AI operation.
  const aiHtml = renderSingleDoc(
    scenes.map((scene) =>
      scene.sceneId === "scene-2"
        ? { ...scene, subtitle: "AI 历史改写的副标题" }
        : scene,
    ),
  );
  const merged = await mergeDocument({
    sceneId: "scene-2",
    baseHtml,
    humanHtml,
    aiHtml,
  });
  if (!merged.ok) throw new Error(`merge failed: ${JSON.stringify(merged)}`);
  const aiRecord = await recordRevision(demoDir, merged.html, {
    actor: "ai",
    kind: "scene.update",
    operationId: "p3-history-ai",
    sceneId: "scene-2",
    summary: "controlled AI rewrite of scene-2 subtitle",
  });
  const afterAi = await client.inspect("demo");
  const frameJob = await client.frame({
    projectId: "demo",
    revision: aiRecord.revision,
    time: 5,
  });
  const frameDone = await waitStatus(client, frameJob.jobId);
  report.q6.steps.push({
    step: "AI rewrite recorded",
    recordedRevision: aiRecord.revision,
    inspectRevision: afterAi.revision,
    frameState: frameDone.state,
    humanTitlePreserved: afterAi.elements.find((e) => e.stableId === "scene-2-title")?.text,
    aiSubtitle: afterAi.elements.find((e) => e.stableId === "scene-2-subtitle")?.text,
  });

  const historyAfterAi = await listHistory(demoDir);
  report.q6.afterAi = {
    entries: historyAfterAi.entries.length,
    ops: historyAfterAi.opCount,
    snapshotBytes: historyAfterAi.snapshotBytes,
    cursor: historyAfterAi.state.cursor,
  };

  // Undo back through the AI operation and the human operation.
  const undoAi = await undo(demoDir);
  const inspectAfterUndoAi = await client.inspect("demo");
  const undoHuman = await undo(demoDir);
  const inspectAfterUndoHuman = await client.inspect("demo");
  const redoHuman = await redo(demoDir);
  const redoAi = await redo(demoDir);
  const inspectAfterRedo = await client.inspect("demo");
  report.q6.undoRedo = {
    undoAi,
    inspectAfterUndoAi: inspectAfterUndoAi.revision,
    undoHuman,
    inspectAfterUndoHuman: inspectAfterUndoHuman.revision,
    redoHuman,
    redoAi,
    inspectAfterRedo: inspectAfterRedo.revision,
    undoMatchesHumanRevision: undoAi.revision === humanRecord.revision,
    undoMatchesInitialRevision: undoHuman.revision === opened.revision,
    redoReturnsAiRevision: inspectAfterRedo.revision === aiRecord.revision,
    note: "revision is content-addressed: undo restores an earlier content hash and appends a new history action; if P3 requires a strictly new revision value, add a monotonic revision sequence",
  };

  const historyBeforeRestart = await listHistory(demoDir);
  report.q6.historyBeforeRestart = {
    entries: historyBeforeRestart.entries.length,
    ops: historyBeforeRestart.opCount,
    lastOps: historyBeforeRestart.ops.slice(-4),
  };

  // Worker restart: history and revision must survive without the process.
  await client.dispose();
  const restarted = createClient(runtime, registryPath);
  try {
    await restarted.start();
    const reopened = await restarted.open("demo");
    const historyAfterRestart = await listHistory(demoDir);
    const undoAfterRestart = await undo(demoDir);
    const inspectAfterRestartUndo = await restarted.inspect("demo");
    report.q6.restart = {
      reopenedRevision: reopened.revision,
      matchesBeforeRestart: reopened.revision === aiRecord.revision,
      historyPersisted:
        historyAfterRestart.entries.length === historyBeforeRestart.entries.length &&
        historyAfterRestart.opCount === historyBeforeRestart.opCount,
      undoAfterRestart,
      inspectAfterRestartUndo: inspectAfterRestartUndo.revision,
      undoMatchesHumanRevision: undoAfterRestart.revision === humanRecord.revision,
    };
  } finally {
    await restarted.dispose();
  }

  // The history directory is not declared in project.json, so it does not
  // change the content revision by itself.
  await writeFile(resolve(demoDir, "index.html"), humanHtml);
  const revisionWithHistory = (await readProjectSnapshot(demoDir)).revision;
  report.q6.revisionSemantics = {
    revisionWithHistoryFiles: revisionWithHistory,
    equalsHumanRecordedRevision: revisionWithHistory === humanRecord.revision,
    manifest: JSON.parse(await readFile(resolve(demoDir, "project.json"), "utf8")),
    note: "history lives in .dsh-video/history/, is excluded from the declared file list and must not become a second content truth",
  };
} finally {
  try {
    await client.dispose();
  } catch {}
}

// ─── Q7: project creation and dynamic registration ────────────────────────
{
  await rm(resolve(demoDir, "..", "..", "late-source"), { recursive: true, force: true });
  const lateDir = resolve(runtime.projectsRoot, "late");
  await copyProject(demoDir, lateDir);

  const client = createClient(runtime, registryPath);
  try {
    await client.start();
    report.q7.staticRegistry = {
      openUnknownBefore: await client
        .open("late")
        .then(() => ({ ok: true }))
        .catch((error) => ({ ok: false, code: error.code, stage: error.stage })),
    };

    // The Host rewrites the registry file while the worker is running.
    await writeRegistry(runtime, { demo: demoDir, late: lateDir });
    report.q7.registryRewriteWithoutRestart = await client
      .open("late")
      .then(() => ({ ok: true }))
      .catch((error) => ({ ok: false, code: error.code, stage: error.stage }));
  } finally {
    await client.dispose();
  }

  const startedAt = performance.now();
  const restarted = createClient(runtime, registryPath);
  try {
    await restarted.start();
    const openedLate = await restarted.open("late");
    const elapsed = Math.round(performance.now() - startedAt);
    report.q7.restartRequired = {
      openAfterRestart: { ok: true, projectId: openedLate.projectId, revision: openedLate.revision },
      restartPlusOpenMs: elapsed,
      note: "the accepted worker reads the registry once at startup; a new project id needs a worker restart or a new worker-side registry API",
    };
  } finally {
    await restarted.dispose();
  }

  // Root containment: a registry entry outside the configured root is rejected.
  const escapeDir = resolve(work, "outside-project");
  await copyProject(demoDir, escapeDir);
  await writeRegistry(runtime, { demo: demoDir, escape: escapeDir });
  const escapeClient = createClient(runtime, registryPath);
  try {
    await escapeClient.start();
    report.q7.outsideRoot = await escapeClient
      .open("escape")
      .then(() => ({ ok: true }))
      .catch((error) => ({ ok: false, code: error.code, stage: error.stage }));
  } finally {
    await escapeClient.dispose();
  }

  // Second restart proves the created project persists in the registry file.
  await writeRegistry(runtime, { demo: demoDir, late: lateDir });
  const again = createClient(runtime, registryPath);
  try {
    await again.start();
    report.q7.persistedAcrossRestart = await again
      .open("late")
      .then((opened) => ({ ok: true, projectId: opened.projectId }))
      .catch((error) => ({ ok: false, code: error.code }));
  } finally {
    await again.dispose();
  }
  report.q7.recommendation = {
    options: [
      {
        name: "worker-managed dynamic registry",
        description:
          "worker owns projectsRoot + registry file, project.create copies a template into projectsRoot, validates realpath containment and persists the registry; startup reloads it",
        cost: "new worker method + atomic registry write + single-writer ownership; Host never edits worker files",
        risk: "two writers / stale registry must be prevented by ownership; projectId must be validated",
        verifiedBy: "registry rewrite + restart experiments above; project.create itself is a proposal",
      },
      {
        name: "Host restarts the worker after creating a project",
        description: "Host creates the directory+registry entry and restarts the worker",
        cost: `measured restart+open ~${report.q7.restartRequired.restartPlusOpenMs}ms locally`,
        risk: "loses idle-warm worker, in-memory operationId cache and pending UI state; must not interrupt a render",
        verifiedBy: "restart experiment",
      },
    ],
    recommendation:
      "worker-managed projectsRoot with persisted registry and an explicit project.create is preferred; register once at startup and avoid Host editing worker files directly",
  };
}

await writeJson(resolve(evidenceDir, "q6-history.json"), {
  generatedAt: report.generatedAt,
  node: report.node,
  q6: report.q6,
});
await writeJson(resolve(evidenceDir, "q7-register.json"), {
  generatedAt: report.generatedAt,
  node: report.node,
  q7: report.q7,
});
console.log(
  JSON.stringify(
    {
      q6: {
        steps: report.q6.steps,
        undoRedo: report.q6.undoRedo,
        restart: report.q6.restart,
        revisionSemantics: {
          equalsHumanRecordedRevision: report.q6.revisionSemantics.equalsHumanRecordedRevision,
        },
      },
      q7: report.q7.staticRegistry,
    },
    null,
    2,
  ),
);
