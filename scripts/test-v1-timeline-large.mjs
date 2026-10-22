/** Real Host -> worker media integration, isolated from the user's data root. */
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  rm,
  open,
} from "node:fs/promises";
import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { VideoBridge } from "../host/bridge.js";
import { createMediaRoute } from "../host/media-routes.js";
import { pathToFileURL } from "node:url";
import { loadStagedHost } from "./lib/staged-host.mjs";
import {
  snapshotRealDataRoot,
  assertRealDataRootUnchanged,
} from "./lib/data-root-isolation.mjs";
import { WorkerClient } from "../packages/video-engine-client/src/index.mjs";
const base = await mkdtemp(join(tmpdir(), "m2-real-host-"));
let bridge;
const realRootBefore = await snapshotRealDataRoot();
const stagingArg = process.argv.indexOf("--staging");
const staging = stagingArg >= 0 ? resolve(process.argv[stagingArg + 1]) : null;
const staged = staging ? await loadStagedHost(staging) : null;
const Bridge = staged ? staged.VideoBridge : VideoBridge;
const mediaRoute = staged
  ? (
      await import(
        pathToFileURL(join(staging, "bundle/host/media-routes.js")).href
      )
    ).createMediaRoute
  : createMediaRoute;
if (staged) await import(pathToFileURL(join(staging, "bundle/index.js")).href);
try {
  const ctx = {
    connection: { fetch: { register: () => () => {} } },
    logger: { warn: () => {} },
    subprocess: { resolveExecutable: async (command) => command },
  };
  let rawConfig = {
    workerNode: process.execPath,
    workerEntry: resolve("packages/video-engine-worker/src/worker.mjs"),
    workerCwd: base,
    registryPath: join(base, "old-registry.json"),
    artifactRoot: join(base, "old-output"),
    allowedProjects: ["demo"],
    dataRoot: join(base, "data"),
    legacyDataRoots: [],
    requestTimeoutMs: 120000,
  };
  if (staged)
    rawConfig = {
      ...staged.config,
      dataRoot: join(base, "data"),
      legacyDataRoots: [staging],
      requestTimeoutMs: 120000,
    };
  const bridgeOptions = {
    ctx,
    rawConfig,
    ...(staged
      ? {}
      : {
          engineLoader: async () => ({
            WorkerClient,
            workerEntry: rawConfig.workerEntry,
            clientVersion: "0.6.0",
            workerVersion: "0.6.0",
          }),
        }),
  };
  bridge = new Bridge(bridgeOptions);
  const created = await bridge.invoke(
    "project.create",
    { templateId: "product-launch-v1", title: "M2 fixture" },
    { source: "http" },
  );
  const projectId = created.projectId;
  const inspected = await bridge.invoke(
    "inspect",
    { projectId },
    { source: "http" },
  );
  const path = join(base, "source.mp4");
  execFileSync("ffmpeg", [
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "color=c=blue:s=64x64:r=30:d=1",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:duration=1",
    "-c:a",
    "aac",
    "-shortest",
    "-c:v",
    "libx264",
    path,
  ]);
  const large = process.argv.includes("--large");
  if (large) {
    const file = await open(path, "r+");
    await file.truncate(1024 * 1024 * 1024);
    await file.close();
  }
  const size = (await import("node:fs/promises")).stat;
  const bytes = (await size(path)).size;
  const memoryBefore = process.memoryUsage().rss;
  let peak = memoryBefore;
  const timer = setInterval(() => {
    peak = Math.max(peak, process.memoryUsage().rss);
  }, 10);
  let receipt;
  try {
    const response = await bridge.uploadAsset(
      new Request("http://localhost/api/dsh-video/asset-upload", {
        method: "POST",
        duplex: "half",
        headers: {
          "content-type": "video/mp4",
          "content-length": String(bytes),
          "x-dsh-project-id": projectId,
          "x-dsh-file-name": encodeURIComponent("测试视频.mp4"),
        },
        body: Readable.toWeb(createReadStream(path)),
      }),
    );
    receipt = await response.json();
    assert.equal(response.status, 200, JSON.stringify(receipt));
  } finally {
    clearInterval(timer);
  }
  const imported = await bridge.invoke(
    "asset.importMedia",
    { projectId, receiptId: receipt.receiptId, operationId: "import-one" },
    { source: "http" },
  );
  assert.deepEqual(
    await bridge.invoke(
      "asset.importMedia",
      { projectId, receiptId: receipt.receiptId, operationId: "import-one" },
      { source: "http" },
    ),
    imported,
  );
  assert.equal(imported.asset.bytes, bytes);
  assert.equal(imported.asset.name, "测试视频.mp4");
  const listed = await bridge.invoke(
    "asset.list",
    { projectId },
    { source: "http" },
  );
  assert.equal(listed.total, 1);
  assert.equal(imported.asset.media.hasAudio, true);
  assert.equal(listed.indexRevision, imported.indexRevision);
  assert.ok(!JSON.stringify(listed).includes(base));
  assert.equal(
    (await bridge.invoke("inspect", { projectId }, { source: "http" }))
      .revision,
    inspected.revision,
  );
  await bridge.invoke(
    "asset.derive",
    { projectId, assetId: imported.asset.assetId, kind: "thumb" },
    { source: "http" },
  );
  const route = mediaRoute(bridge);
  const response = await route.fetch(
    new Request(
      "http://localhost/api/dsh-video/media?projectId=" +
        projectId +
        "&assetId=" +
        imported.asset.assetId,
      {
        headers: { range: "bytes=0-31" },
      },
    ),
  );
  assert.equal(response.status, 206);
  assert.equal((await response.arrayBuffer()).byteLength, 32);
  await assert.rejects(
    () =>
      bridge.invoke(
        "asset.remove",
        { projectId, assetId: imported.asset.assetId },
        { source: "tool" },
      ),
    (e) => e.code === "E_METHOD",
  );
  const timeline = await bridge.invoke(
    "timeline.inspect",
    { projectId },
    { source: "http" },
  );
  const changed = await bridge.invoke(
    "timeline.apply",
    {
      projectId,
      expectedRevision: timeline.revision,
      operationId: "put-on-track",
      ops: [
        { op: "clip.delete", clipId: timeline.tracks[0].clips[0].clipId },
        {
          op: "clip.insert",
          assetId: imported.asset.assetId,
          trackId: "tr_v1",
          startFrame: 0,
        },
      ],
    },
    { source: "http" },
  );
  const workerPid = bridge.client.child.pid;
  const rss = () =>
    Number(
      execFileSync("ps", ["-o", "rss=", "-p", String(workerPid)], {
        encoding: "utf8",
      }).trim(),
    ) * 1024;
  const workerBefore = rss(),
    hostBefore = process.memoryUsage().rss;
  const snapshot = await bridge.invoke(
    "preview.snapshot",
    { projectId, revision: changed.revision },
    { source: "http" },
  );
  const media = snapshot.files.find((f) => f.media);
  assert.equal(media.bytes, bytes);
  const record = bridge.snapshots.records.get(snapshot.snapshotId),
    declared = record.files.get(media.path);
  const streamed = await bridge.snapshots.serveFile(
    record,
    media.path,
    declared,
    new Request("http://local", { headers: { range: "bytes=0-99" } }),
  );
  assert.equal(streamed.status, 206);
  assert.equal((await streamed.arrayBuffer()).byteLength, 100);
  const workerDelta = rss() - workerBefore,
    hostDelta = process.memoryUsage().rss - hostBefore;
  assert.ok(workerDelta < 128 * 1024 * 1024);
  assert.ok(hostDelta < 128 * 1024 * 1024);
  await assert.rejects(
    () =>
      bridge.invoke(
        "asset.remove",
        { projectId, assetId: imported.asset.assetId },
        { source: "http" },
      ),
    (e) => e.code === "E_ASSET_REFERENCED",
  );
  console.log(
    JSON.stringify({
      timelineSnapshot: {
        bytes,
        workerDelta,
        hostDelta,
        range: true,
        referenceProtected: true,
      },
    }),
  );
  await bridge.dispose();
  bridge = new Bridge(bridgeOptions);
  assert.equal(
    (await bridge.invoke("asset.list", { projectId }, { source: "http" }))
      .total,
    1,
  );
  await bridge.invoke("open", { projectId }, { source: "http" });
  const restored = await bridge.invoke(
    "timeline.inspect",
    { projectId },
    { source: "http" },
  );
  assert.equal(restored.revision, changed.revision);
  assert.equal(restored.tracks[0].clips[0].assetId, imported.asset.assetId);
  if (large)
    assert.ok(
      peak - memoryBefore < 256 * 1024 * 1024,
      "Upload memory grew more than 256 MiB",
    );
  console.log(
    JSON.stringify({
      ok: true,
      staging,
      bytes,
      uploadRssDelta: peak - memoryBefore,
      checks: [
        "stream upload",
        "real worker import/probe",
        "derive",
        "Range",
        "revision unchanged",
        "tool write refused",
        "Host restart",
        "timeline snapshot / 1GiB hardlink / bounded RSS / referenced deletion / restart",
      ],
    }),
  );
} finally {
  if (bridge) await bridge.dispose();
  await rm(base, { recursive: true, force: true });
  await assertRealDataRootUnchanged(realRootBefore);
  if (staged) await loadStagedHost(staging);
}
