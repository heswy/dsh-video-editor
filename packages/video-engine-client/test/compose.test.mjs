// P3-012: client contract for the complete-composition methods.
// - the fake recording worker proves the exact JSONL frames WorkerClient sends;
// - the real worker proves projectSource/projectCompose work end-to-end with
//   the frozen result/error shapes.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { WorkerClient, WorkerClientError } from "../src/index.mjs";

const fakeWorker = resolve(import.meta.dirname, "fixtures/compose-worker.mjs");
const workerEntry = resolve(
  import.meta.dirname,
  "../../video-engine-worker/src/worker.mjs",
);
const TEMPLATE = "product-launch-v1";
const REVISION = "a".repeat(64);

const COMPOSITION_HTML = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>client compose</title>
<style>html,body{margin:0;overflow:hidden;background:#0b1220}</style>
<script src="./assets/gsap.min.js"></script>
</head>
<body>
<div id="main" data-composition-id="main" data-width="1280" data-height="720" data-fps="30" data-start="0" data-duration="5">
<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720">
<rect width="1280" height="720" fill="#0b1220"/>
<circle id="thing" cx="200" cy="360" r="80" fill="#4ade80"/>
</svg>
<script>
const tl = gsap.timeline({ paused: true });
tl.to("#thing", { x: 100, duration: 1 }, 0);
window.__timelines = { main: tl };
tl.seek(0);
</script>
</div>
</body>
</html>
`;

function options(registry) {
  return {
    nodeExecutable: process.execPath,
    workerEntry,
    registryPath: registry,
    startupTimeoutMs: 15000,
    requestTimeoutMs: 15000,
    shutdownTimeoutMs: 15000,
    forceKillTimeoutMs: 2000,
    maxPending: 32,
    maxLineBytes: 131072,
    maxStderrBytes: 16384,
  };
}

async function recorder() {
  const dir = await mkdtemp(resolve(tmpdir(), "dsh-engine-client-compose-"));
  const recordPath = resolve(dir, "frames.jsonl");
  const registry = resolve(dir, "registry.json");
  await writeFile(registry, JSON.stringify({ mode: "compose", recordPath }));
  await writeFile(recordPath, "");
  const client = new WorkerClient({
    ...options(registry),
    workerEntry: fakeWorker,
    startupTimeoutMs: 2000,
    requestTimeoutMs: 2000,
    shutdownTimeoutMs: 2000,
    forceKillTimeoutMs: 500,
  });
  return {
    client,
    recordPath,
    cleanup: () => rm(dir, { recursive: true, force: true }),
  };
}

async function managed() {
  const dir = await mkdtemp(resolve(tmpdir(), "p3012-client-"));
  const projectsRoot = resolve(dir, "projects");
  const outputRoot = resolve(dir, "output");
  const assetInboxRoot = resolve(dir, "inbox");
  const dataPath = resolve(dir, "registry-data.json");
  const configPath = resolve(dir, "registry.json");
  await mkdir(projectsRoot, { recursive: true });
  await mkdir(outputRoot, { recursive: true });
  await mkdir(assetInboxRoot, { recursive: true });
  await writeFile(dataPath, JSON.stringify({ projects: {} }));
  await writeFile(
    configPath,
    JSON.stringify({ projectsRoot, registryPath: dataPath, outputRoot, assetInboxRoot }),
  );
  const client = new WorkerClient(options(configPath));
  return {
    dir,
    client,
    async cleanup() {
      await client.dispose().catch(() => {});
      await rm(dir, { recursive: true, force: true });
    },
  };
}

test("WorkerClient sends the exact project.compose/project.source JSONL frames", async () => {
  const f = await recorder();
  const composeParams = {
    projectId: "proj-fake",
    expectedRevision: REVISION,
    operationId: "compose-1",
    html: COMPOSITION_HTML,
  };
  const sourceParams = { projectId: "proj-fake" };
  try {
    assert.equal(typeof f.client.projectCompose, "function");
    assert.equal(typeof f.client.projectSource, "function");
    await f.client.start();
    const composed = await f.client.projectCompose(composeParams);
    assert.deepEqual(composed, {
      projectId: "proj-fake",
      revision: REVISION,
      publishedRevision: REVISION,
      written: true,
      unchanged: false,
      scenes: [],
      entry: "index.html",
      width: 1280,
      height: 720,
      duration: 5,
      bytes: Buffer.byteLength(COMPOSITION_HTML, "utf8"),
      assets: ["assets/gsap.min.js"],
      elements: [],
      files: [],
      preview: {
        mode: "snapshot",
        status: "ready",
        checked: "composition+snapshot",
        revision: REVISION,
      },
    });
    assert.deepEqual(await f.client.projectSource(sourceParams), {
      projectId: "proj-fake",
      revision: REVISION,
      entry: "index.html",
      bytes: 653,
      assets: ["assets/gsap.min.js"],
      html: "<!doctype html>",
    });
    // The worker's own structured error (with the P3-012 code/stage) surfaces
    // as a WorkerClientError; the client adds no retry or rewriting.
    await assert.rejects(
      f.client.projectCompose({
        ...composeParams,
        operationId: "compose-bad",
        html: "INVALID",
      }),
      (error) =>
        error instanceof WorkerClientError &&
        error.code === "E_COMPOSE_INVALID" &&
        error.stage === "compose" &&
        error.message === "bad composition",
    );
    await f.client.dispose();
    assert.equal(f.client.debug().pending, 0);

    const frames = (await readFile(f.recordPath, "utf8"))
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));
    // Exact frame order: doctor on start, one frame per call, shutdown on
    // dispose. No hidden probe/retry frames.
    assert.deepEqual(
      frames.map((frame) => frame.method),
      [
        "doctor",
        "project.compose",
        "project.source",
        "project.compose",
        "shutdown",
      ],
    );
    const composeFrames = frames.filter(
      (frame) => frame.method === "project.compose",
    );
    const [composeFrame, rejectedFrame] = composeFrames;
    assert.deepEqual(Object.keys(composeFrame).sort(), [
      "id",
      "method",
      "params",
      "v",
    ]);
    assert.equal(composeFrame.v, 1);
    assert.equal(typeof composeFrame.id, "string");
    assert.notEqual(composeFrame.id, rejectedFrame.id);
    assert.deepEqual(composeFrame.params, composeParams);
    assert.deepEqual(rejectedFrame.params, {
      ...composeParams,
      operationId: "compose-bad",
      html: "INVALID",
    });
    const sourceFrame = frames.find(
      (frame) => frame.method === "project.source",
    );
    assert.deepEqual(Object.keys(sourceFrame).sort(), [
      "id",
      "method",
      "params",
      "v",
    ]);
    assert.deepEqual(sourceFrame.params, sourceParams);
  } finally {
    await f.client.dispose().catch(() => {});
    await f.cleanup();
  }
});

test("projectSource/projectCompose round-trip through the real worker", async () => {
  const f = await managed();
  try {
    await f.client.start();
    const project = await f.client.projectCreate({
      templateId: TEMPLATE,
      title: "client compose",
    });
    const projectId = project.projectId;
    const initial = await f.client.projectSource({ projectId });
    assert.equal(initial.revision, project.revision);
    assert.equal(initial.entry, "index.html");
    assert.equal(initial.bytes, Buffer.byteLength(initial.html, "utf8"));
    assert.deepEqual(initial.assets, ["assets/gsap.min.js"]);

    const published = await f.client.projectCompose({
      projectId,
      expectedRevision: initial.revision,
      operationId: "client-compose-1",
      html: COMPOSITION_HTML,
    });
    assert.equal(published.projectId, projectId);
    assert.notEqual(published.revision, initial.revision);
    assert.equal(published.publishedRevision, published.revision);
    assert.equal(published.written, true);
    assert.equal(published.unchanged, false);
    assert.deepEqual(published.scenes, []);
    const roundTrip = await f.client.projectSource({ projectId });
    assert.equal(roundTrip.revision, published.revision);
    assert.equal(roundTrip.html, COMPOSITION_HTML);
    assert.equal(roundTrip.bytes, Buffer.byteLength(COMPOSITION_HTML, "utf8"));

    // Stale expectedRevision and invalid HTML are typed worker errors.
    await assert.rejects(
      f.client.projectCompose({
        projectId,
        expectedRevision: initial.revision,
        operationId: "client-compose-stale",
        html: COMPOSITION_HTML.replace("第一版", "x").replace("client compose", "stale"),
      }),
      (error) =>
        error instanceof WorkerClientError &&
        error.code === "E_REVISION_CONFLICT" &&
        error.stage === "compose",
    );
    await assert.rejects(
      f.client.projectCompose({
        projectId,
        expectedRevision: published.revision,
        operationId: "client-compose-invalid",
        html: "<div>fragment</div>",
      }),
      (error) =>
        error instanceof WorkerClientError &&
        error.code === "E_COMPOSE_INVALID" &&
        error.stage === "compose",
    );

    // Identical bytes: explicit unchanged success without a new revision.
    const unchanged = await f.client.projectCompose({
      projectId,
      expectedRevision: published.revision,
      operationId: "client-compose-same",
      html: COMPOSITION_HTML,
    });
    assert.equal(unchanged.unchanged, true);
    assert.equal(unchanged.written, false);
    assert.equal(unchanged.revision, published.revision);
    assert.equal(unchanged.publishedRevision, published.revision);
    assert.equal(
      (await f.client.projectSource({ projectId })).html,
      COMPOSITION_HTML,
    );
  } finally {
    await f.cleanup();
  }
});
