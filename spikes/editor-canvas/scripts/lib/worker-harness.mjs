// Worker harness for the P3-005-B canvas spike. It drives the shipped
// 0.2.1 worker/client (unchanged) exactly like a future Host backend would:
// create a controlled multi-scene project, open/inspect it, create preview
// snapshots, apply typed edits with expectedRevision+operationId, and extract
// reference frames for playback comparison.
import { createHash } from "node:crypto";
import { deflateSync } from "node:zlib";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
export const SPIKE_ROOT = resolve(HERE, "../..");
export const REPO_ROOT = resolve(HERE, "../../../..");
const WORKER_ENTRY = resolve(
  REPO_ROOT,
  "packages/video-engine-worker/src/worker.mjs",
);

async function loadClientModule() {
  return import(
    pathToFileURL(
      resolve(REPO_ROOT, "packages/video-engine-client/src/index.mjs"),
    ).href
  );
}

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

// ── tiny solid-color PNG encoder (fixtures only; no image dependency) ─────
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();
function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([length, body, crc]);
}
export function solidPng(width, height, [r, g, b]) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // truecolor RGB
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    const offset = y * (width * 3 + 1);
    raw[offset] = 0;
    for (let x = 0; x < width; x++) {
      raw[offset + 1 + x * 3] = r;
      raw[offset + 2 + x * 3] = g;
      raw[offset + 3 + x * 3] = b;
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// ── managed worker environment ───────────────────────────────────────────
export class CanvasHarness {
  constructor({ runDir, chromePath }) {
    this.runDir = runDir;
    this.chromePath = chromePath;
    this.client = null;
    this.config = null;
    this.project = null;
    this.latest = null;
    this.snapshots = new Map();
    this.operations = 0;
  }

  get projectsRoot() {
    return resolve(this.runDir, "projects");
  }
  get outputRoot() {
    return resolve(this.runDir, "output");
  }
  get previewRoot() {
    return resolve(this.runDir, "output", "previews");
  }
  get projectDir() {
    return this.project ? resolve(this.projectsRoot, this.project.projectId) : null;
  }

  async initialize() {
    await mkdir(this.projectsRoot, { recursive: true });
    await mkdir(this.outputRoot, { recursive: true });
    await mkdir(resolve(this.runDir, "inbox"), { recursive: true });
    await writeFile(
      resolve(this.runDir, "inbox/logo.png"),
      solidPng(120, 120, [250, 204, 21]),
    );
    await writeFile(
      resolve(this.runDir, "inbox/shot.png"),
      solidPng(240, 140, [34, 211, 238]),
    );
    await writeFile(
      resolve(this.runDir, "registry-data.json"),
      JSON.stringify({ projects: {} }),
    );
    this.config = {
      projectsRoot: this.projectsRoot,
      registryPath: resolve(this.runDir, "registry-data.json"),
      outputRoot: this.outputRoot,
      assetInboxRoot: resolve(this.runDir, "inbox"),
    };
    await writeFile(
      resolve(this.runDir, "registry.json"),
      JSON.stringify(this.config),
    );
    const { WorkerClient } = await loadClientModule();
    this.client = new WorkerClient({
      nodeExecutable: process.execPath,
      workerEntry: WORKER_ENTRY,
      registryPath: resolve(this.runDir, "registry.json"),
      startupTimeoutMs: 15000,
      requestTimeoutMs: 20000,
      shutdownTimeoutMs: 15000,
      forceKillTimeoutMs: 2000,
      maxPending: 64,
      maxLineBytes: 131072,
      maxStderrBytes: 16384,
    });
    this.doctor = await this.client.start();
    return this;
  }

  async createProject() {
    this.project = await this.client.projectCreate({
      templateId: "product-launch-v1",
      title: "画布直接编辑验证",
      assets: [
        { inboxName: "logo.png", name: "logo.png" },
        { inboxName: "shot.png", name: "shot.png" },
      ],
    });
    let revision = this.project.revision;
    const sceneSpecs = [
      {
        sceneId: "scene-2",
        duration: 4,
        title: "第二幕：点选与位置",
        subtitle: "人工修改后 AI 继续编辑",
        badge: "SCENE 2",
      },
      {
        sceneId: "scene-3",
        duration: 2,
        title: "第三幕：结束",
        subtitle: "无场景卡片，不打断画面",
        badge: "SCENE 3",
      },
    ];
    for (const spec of sceneSpecs) {
      const response = await this.client.sceneCreate({
        projectId: this.project.projectId,
        expectedRevision: revision,
        operationId: `harness-scene-${spec.sceneId}`,
        template: {
          sceneId: spec.sceneId,
          duration: spec.duration,
          title: spec.title,
          subtitle: spec.subtitle,
          badge: spec.badge,
        },
      });
      revision = response.revision;
    }
    // Give scene-2 a visual image so overlap/hit tests have a picture object.
    const updated = await this.client.sceneUpdate({
      projectId: this.project.projectId,
      expectedRevision: revision,
      operationId: "harness-scene2-shot",
      sceneId: "scene-2",
      template: {
        duration: 4,
        title: "第二幕：点选与位置",
        subtitle: "人工修改后 AI 继续编辑",
        badge: "SCENE 2",
        shot: "assets/shot.png",
      },
    });
    this.latest = { revision: updated.revision };
    return this.project;
  }

  async inspect() {
    const inspected = await this.client.inspect(this.project.projectId);
    return inspected;
  }

  buildCatalogue(inspected) {
    return inspected.elements
      .filter(
        (element) =>
          element.stableId !== "hf-main" &&
          !element.stableId.endsWith("-section"),
      )
      .map((element) => ({
        stableId: element.stableId,
        sceneId: element.sceneId,
        capabilities: element.capabilities ?? [],
        text: element.text,
        timing: element.timing,
      }));
  }

  async currentSession() {
    const inspected = await this.inspect();
    const snapshot = await this.createSnapshot(inspected.revision);
    return {
      project: {
        projectId: this.project.projectId,
        revision: inspected.revision,
        width: inspected.width,
        height: inspected.height,
        duration: inspected.duration,
      },
      catalogue: this.buildCatalogue(inspected),
      snapshot: {
        snapshotId: snapshot.snapshotId,
        entry: snapshot.entry,
        files: snapshot.files,
        expiresAt: snapshot.expiresAt,
      },
      entryUrl: `/preview/${snapshot.snapshotId}/${snapshot.entry}`,
    };
  }

  async createSnapshot(revision) {
    // Release the previous preview snapshot first: never keep two snapshots
    // alive for one canvas instance (P3-004 review: Host owns lifetime).
    for (const snapshotId of [...this.snapshots.keys()]) {
      await this.releaseSnapshot(snapshotId);
    }
    const snapshot = await this.client.previewSnapshot({
      projectId: this.project.projectId,
      revision,
      ttlMs: 120000,
    });
    this.snapshots.set(snapshot.snapshotId, snapshot);
    return snapshot;
  }

  async releaseSnapshot(snapshotId) {
    this.snapshots.delete(snapshotId);
    return this.client
      .previewRelease({ snapshotId })
      .catch((error) => ({ released: false, code: error.code }));
  }

  async applyEdit({ expectedRevision, operationId, ops }) {
    this.operations += 1;
    try {
      const result = await this.client.edit({
        projectId: this.project.projectId,
        expectedRevision,
        operationId,
        ops,
      });
      const inspected = await this.inspect();
      const session = await this.currentSession();
      return { ok: true, result: { edit: result, session } };
    } catch (error) {
      return {
        ok: false,
        error: { code: error.code, message: error.message, stage: error.stage },
      };
    }
  }

  async frame(revision, time) {
    const job = await this.client.frame({
      projectId: this.project.projectId,
      revision,
      time,
      timeoutMs: 120000,
    });
    let status;
    for (let attempt = 0; attempt < 600; attempt++) {
      status = await this.client.status(job.jobId);
      if (["succeeded", "failed", "cancelled", "timed_out"].includes(status.state))
        break;
      await new Promise((wait) => setTimeout(wait, 100));
    }
    if (status?.state !== "succeeded")
      throw new Error(`frame job ${status?.state}: ${JSON.stringify(status?.error)}`);
    const bytes = await readFile(resolve(this.outputRoot, status.artifact.name));
    return {
      bytes,
      sha256: sha256(bytes),
      artifact: status.artifact,
      elapsedMs: status.progress === undefined ? null : null,
    };
  }

  async reopenProject() {
    await this.client.close(this.project.projectId);
    const opened = await this.client.open(this.project.projectId);
    const inspected = await this.inspect();
    return { opened, inspected };
  }

  async restartWorker() {
    await this.client.dispose();
    // Capture the worker-exit cleanup state before starting the new process.
    this.previewsAfterWorkerExit = await this.previewDirectoryEntries();
    const { WorkerClient } = await loadClientModule();
    this.client = new WorkerClient({
      nodeExecutable: process.execPath,
      workerEntry: WORKER_ENTRY,
      registryPath: resolve(this.runDir, "registry.json"),
      startupTimeoutMs: 15000,
      requestTimeoutMs: 20000,
      shutdownTimeoutMs: 15000,
      forceKillTimeoutMs: 2000,
      maxPending: 64,
      maxLineBytes: 131072,
      maxStderrBytes: 16384,
    });
    this.doctor = await this.client.start();
    const opened = await this.client.open(this.project.projectId);
    return opened;
  }

  async chmodProject(mode) {
    const { chmod } = await import("node:fs/promises");
    await chmod(this.projectDir, mode);
  }

  async previewDirectoryEntries() {
    const { readdir } = await import("node:fs/promises");
    return readdir(this.previewRoot).catch((error) =>
      error.code === "ENOENT" ? [] : Promise.reject(error),
    );
  }

  async cleanup() {
    for (const snapshotId of [...this.snapshots.keys()])
      await this.releaseSnapshot(snapshotId);
    if (this.client) await this.client.dispose().catch(() => {});
    await rm(this.runDir, { recursive: true, force: true }).catch(() => {});
    return { runDirRemoved: true };
  }
}

export async function createHarness({ chromePath } = {}) {
  await mkdir(resolve(SPIKE_ROOT, "artifacts"), { recursive: true });
  const runDir = await mkdtemp(
    resolve(SPIKE_ROOT, "artifacts", "canvas-run-"),
  );
  const harness = new CanvasHarness({ runDir, chromePath });
  await harness.initialize();
  return harness;
}

export { sha256, WORKER_ENTRY };
