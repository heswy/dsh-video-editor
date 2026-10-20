import { mkdir, mkdtemp, rm, readFile, rename, stat } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID, createHash } from "node:crypto";
import { runOwned } from "./process.mjs";
import { fail, number } from "./errors.mjs";
const packageRoot = fileURLToPath(new URL("../", import.meta.url));
const cli = resolve(packageRoot, "node_modules/hyperframes/dist/cli.js");
const terminal = new Set(["succeeded", "failed", "cancelled", "timed_out"]);
export const MAX_FRAME_TIMES = 4;
const FRAME_TILE_MAX_WIDTH = 480;
const CONTACT_SHEET_TIMEOUT_MS = 30000;

/**
 * Canonical millisecond label shared by the HyperFrames `--keep` still name
 * (`at-<label>s.png`) and the duplicate check, so two accepted `times` entries
 * can never resolve to the same still.
 */
export function frameTimeLabel(time) {
  return String(Number(time.toFixed(3)));
}

/**
 * Validate the batch `times` frame parameter: 1..MAX_FRAME_TIMES seconds,
 * canonical to millisecond precision (the `--keep` filename granularity),
 * distinct by that canonical value and ascending. Host input is already
 * normalized; normalizing again here keeps a direct JSONL caller deterministic.
 */
export function normalizeFrameTimes(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_FRAME_TIMES)
    fail("E_PARAMS", `times must list 1-${MAX_FRAME_TIMES} frame times`);
  const seen = new Set();
  const times = [];
  for (const entry of value) {
    number(entry, 0, 3599.999);
    const canonical = Number(entry.toFixed(3));
    if (seen.has(canonical))
      fail("E_PARAMS", "Frame times must be distinct at millisecond precision");
    seen.add(canonical);
    times.push(canonical);
  }
  times.sort((left, right) => left - right);
  return times;
}

/**
 * Horizontal contact-sheet geometry. Every tile is downscaled to
 * width = min(480, doc.width) with a proportional even height, then tiled
 * side by side: sheet width = tile width * count, sheet height = tile height.
 * Four 3840-wide tiles stay well under the 3840-wide sheet bound.
 */
export function contactSheetLayout(width, height, count) {
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 1 ||
    height < 1 ||
    !Number.isInteger(count) ||
    count < 2 ||
    count > MAX_FRAME_TIMES
  )
    fail("E_PARAMS", "Invalid contact-sheet geometry");
  const tileWidth = Math.min(FRAME_TILE_MAX_WIDTH, width);
  let tileHeight = Math.round((height * tileWidth) / width);
  if (tileHeight % 2 === 1) tileHeight -= 1;
  if (tileHeight < 2) tileHeight = 2;
  return {
    tileWidth,
    tileHeight,
    sheetWidth: tileWidth * count,
    sheetHeight: tileHeight,
  };
}

/** ffmpeg argv that tiles already-captured same-size PNG stills horizontally. */
export function contactSheetArgs(frames, layout, output) {
  const args = ["ffmpeg", "-y", "-v", "error"];
  for (const frame of frames) args.push("-i", frame);
  const filters = frames.map(
    (_, index) =>
      `[${index}:v]scale=${layout.tileWidth}:${layout.tileHeight}:flags=lanczos,setsar=1[v${index}]`,
  );
  filters.push(
    `${frames.map((_, index) => `[v${index}]`).join("")}hstack=inputs=${frames.length}[sheet]`,
  );
  args.push(
    "-filter_complex",
    filters.join(";"),
    "-map",
    "[sheet]",
    "-frames:v",
    "1",
    output,
  );
  return args;
}

/** PNG signature plus IHDR dimensions must match the expected frame size. */
function validPng(bytes, width, height) {
  return (
    bytes.length >= 24 &&
    bytes.readUInt32BE(0) === 0x89504e47 &&
    bytes.readUInt32BE(16) === width &&
    bytes.readUInt32BE(20) === height
  );
}

/**
 * SHA-256 of the exact published bytes (the same digest as projects.mjs `sha`).
 * Kept local so this job module — and its pure unit tests — import no
 * HyperFrames SDK dependency.
 */
function artifactHash(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}
export class Jobs {
  constructor(projects, config) {
    this.tools = versions(config);
    this.projects = projects;
    this.config = config;
    this.jobs = new Map();
    this.closing = false;
  }
  view(job) {
    const { controller, promise, temp, ...publicFields } = job;
    // An artifact is public only after the job reaches its terminal success
    // state. This keeps cancel during the final cleanup from exposing a file
    // that the worker must subsequently retract.
    if (job.state !== "succeeded") delete publicFields.artifact;
    return publicFields;
  }
  get(id) {
    const job = this.jobs.get(id);
    if (!job) fail("E_JOB_NOT_FOUND", "Unknown worker job", "status");
    return job;
  }
  async start(kind, p) {
    if (this.closing) fail("E_SHUTDOWN", "Worker is shutting down", "job");
    this.projects.assertActive(p.projectId);
    if (
      [...this.jobs.values()].filter((j) => !terminal.has(j.state)).length >=
        4 ||
      this.jobs.size >= 256
    )
      fail("E_LIMIT", "Job limit reached", "job");
    const job = {
      jobId: randomUUID(),
      projectId: p.projectId,
      revision: p.revision,
      kind,
      tools: this.tools,
      state: "queued",
      stage: "snapshot",
      controller: new AbortController(),
      progress: 0,
    };
    this.jobs.set(job.jobId, job);
    // Register promise before returning: shutdown/EOF can always drain it.
    job.promise = new Promise((r) => setImmediate(r)).then(() =>
      this.run(job, p),
    );
    return this.view(job);
  }
  cancel(job) {
    if (!terminal.has(job.state)) {
      job.state = "cancelling";
      job.controller.abort();
    }
    return this.view(job);
  }
  async drain(projectId) {
    for (const j of this.jobs.values())
      if (!projectId || j.projectId === projectId) this.cancel(j);
    await Promise.all(
      [...this.jobs.values()]
        .filter((j) => !projectId || j.projectId === projectId)
        .map((j) => j.promise),
    );
  }
  env(temp, kind) {
    return {
      ...process.env,
      TMPDIR: resolve(temp, "tmp"),
      HYPERFRAMES_BROWSER_PATH:
        this.config.browserPath ||
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      PRODUCER_BROWSER_GPU_MODE: "software",
      HYPERFRAMES_NO_TELEMETRY: "1",
      DO_NOT_TRACK: "1",
      HEYGEN_CONFIG_DIR: resolve(temp, "auth"),
      XDG_STATE_HOME: resolve(temp, "state"),
      HYPERFRAMES_FONT_CACHE_DIR: resolve(temp, "fonts"),
      HYPERFRAMES_EXTRACT_CACHE_DIR: "off",
      // BUG-001: HyperFrames' static-frame-dedup verification opens a second
      // page, after which the primary capture page silently loses its
      // 1280x720 device-metrics override (innerHeight falls to the real
      // headless window content height). The render then keeps CDP's
      // captureBeyondViewport=false and clips the bottom rows black. Our
      // controlled adapter disables dedup for render jobs only; capture frames
      // stay the same revision/HTML and the composition is never cropped,
      // stretched or filled. Revisit when the upstream page lifecycle is fixed.
      ...(kind === "render" ? { HF_STATIC_DEDUP: "false" } : {}),
    };
  }
  async run(job, p) {
    let final = "failed";
    try {
      await mkdir(this.config.outputRoot, { recursive: true });
      job.temp = await mkdtemp(resolve(this.config.outputRoot, ".job-"));
      const snapshot = resolve(job.temp, "project");
      const meta = await this.projects.snapshot(
        job.projectId,
        job.revision,
        snapshot,
      );
      if (job.controller.signal.aborted) {
        final = "cancelled";
        return;
      }
      const { buildDocument } = await import("@hyperframes/sdk");
      const doc = buildDocument(
        (await readFile(resolve(snapshot, meta.entry))).toString(),
      );
      if (!(
        doc.width > 0 &&
        doc.width <= 3840 &&
        doc.height > 0 &&
        doc.height <= 2160 &&
        doc.compositionDuration > 0 &&
        doc.compositionDuration <= 3600
      ))
        fail(
          "E_PROJECT",
          "Unsupported composition dimensions/duration",
          "snapshot",
        );
      const fps = 30;
      let args, produced;
      if (job.kind === "frame") {
        if (p.time !== undefined && p.times !== undefined)
          fail("E_PARAMS", "Provide exactly one of time or times");
        const times =
          p.time !== undefined ? [p.time] : normalizeFrameTimes(p.times);
        for (const time of times)
          number(time, 0, doc.compositionDuration - 1 / 30);
        if (times.length === 1) {
          // A single time behaves exactly like the legacy frame contract: one
          // full-size PNG, metadata time/frame, no sheet.
          job.time = times[0];
          job.frame = times[0] * fps;
        } else {
          // One HyperFrames launch captures every still; the published artifact
          // is the single horizontally tiled contact sheet built below.
          job.times = times.slice();
        }
        const frames = resolve(job.temp, "frames");
        const at =
          p.time !== undefined
            ? String(p.time)
            : times.map(frameTimeLabel).join(",");
        args = [
          "snapshot",
          snapshot,
          "--at",
          at,
          "--no-end",
          "--keep",
          "--describe",
          "false",
          "--no-browser-gpu",
          "-o",
          frames,
        ];
        if (times.length === 1)
          produced = resolve(frames, `at-${frameTimeLabel(times[0])}s.png`);
      } else {
        produced = resolve(job.temp, "render.mp4");
        args = [
          "render",
          snapshot,
          "-c",
          meta.entry,
          "-o",
          produced,
          "--fps",
          "30",
          "--format",
          "mp4",
          "--quality",
          "standard",
          "--workers",
          "1",
          "--no-browser-gpu",
        ];
      }
      await mkdir(resolve(job.temp, "tmp"));
      job.state = "running";
      job.stage = "engine";
      const result = await runOwned([process.execPath, cli, ...args], {
        temp: job.temp,
        cwd: packageRoot,
        env: this.env(job.temp, job.kind),
        signal: job.controller.signal,
        timeoutMs: p.timeoutMs ?? 120000,
        onOutput: (s) => {
          const m = s.match(/Streaming frame (\d+)\/(\d+)/);
          if (m) {
            job.stage = "capture";
            job.progress = Number(m[1]) / Number(m[2]);
          }
        },
      });
      job.ownedPids = result.ownedPids || [];
      job.survivors = result.survivors || [];
      if (result.status === "cancelled" || job.controller.signal.aborted) {
        final = "cancelled";
        return;
      }
      if (result.status === "timed_out") {
        final = "timed_out";
        return;
      }
      if (result.status !== "complete")
        fail("E_RENDER", "Upstream engine failed", "engine");
      job.stage = "validate";
      let bytes;
      let metadata;
      if (job.kind === "render") {
        bytes = await readFile(produced);
        const probeRun = await runOwned(
          [
            "ffprobe",
            "-v",
            "error",
            "-count_frames",
            "-select_streams",
            "v:0",
            "-show_entries",
            "stream=codec_name,width,height,r_frame_rate,nb_read_frames:format=duration",
            "-of",
            "json",
            produced,
          ],
          {
            temp: job.temp,
            cwd: packageRoot,
            env: this.env(job.temp, job.kind),
            signal: job.controller.signal,
            timeoutMs: 15000,
          },
        );
        job.ownedPids.push(...(probeRun.ownedPids || []));
        if (probeRun.status === "cancelled" || job.controller.signal.aborted) {
          final = "cancelled";
          return;
        }
        if (probeRun.status === "timed_out") {
          final = "timed_out";
          return;
        }
        if (probeRun.status !== "complete")
          fail("E_METADATA", "Metadata probe failed", "validate");
        const probe = JSON.parse(probeRun.output);
        const stream = probe.streams?.[0];
        const frames = Math.round(doc.compositionDuration * fps);
        if (
          stream?.codec_name !== "h264" ||
          stream.width !== doc.width ||
          stream.height !== doc.height ||
          stream.r_frame_rate !== "30/1" ||
          Number(stream.nb_read_frames) !== frames ||
          Math.abs(Number(probe.format.duration) - doc.compositionDuration) >
            1 / fps
        )
          fail("E_METADATA", "MP4 metadata validation failed", "validate");
        metadata = { ...stream, duration: Number(probe.format.duration) };
      } else if (job.times !== undefined) {
        // Every still from the single snapshot run must be a valid full-size
        // PNG before it is tiled; a skipped or clipped capture fails the job.
        const frames = job.times.map((time) =>
          resolve(job.temp, "frames", `at-${frameTimeLabel(time)}s.png`),
        );
        for (const frame of frames) {
          let frameBytes;
          try {
            frameBytes = await readFile(frame);
          } catch {
            fail("E_METADATA", "PNG validation failed", "validate");
          }
          if (!validPng(frameBytes, doc.width, doc.height))
            fail("E_METADATA", "PNG validation failed", "validate");
        }
        const layout = contactSheetLayout(
          doc.width,
          doc.height,
          frames.length,
        );
        const sheet = resolve(job.temp, "contact-sheet.png");
        job.stage = "sheet";
        const sheetRun = await runOwned(
          contactSheetArgs(frames, layout, sheet),
          {
            temp: job.temp,
            cwd: packageRoot,
            env: this.env(job.temp, job.kind),
            signal: job.controller.signal,
            timeoutMs: CONTACT_SHEET_TIMEOUT_MS,
          },
        );
        job.ownedPids.push(...(sheetRun.ownedPids || []));
        if (sheetRun.status === "cancelled" || job.controller.signal.aborted) {
          final = "cancelled";
          return;
        }
        if (sheetRun.status === "timed_out") {
          final = "timed_out";
          return;
        }
        if (sheetRun.status !== "complete")
          fail("E_RENDER", "Contact sheet composition failed", "sheet");
        job.stage = "validate";
        produced = sheet;
        bytes = await readFile(produced);
        if (!validPng(bytes, layout.sheetWidth, layout.sheetHeight))
          fail("E_METADATA", "PNG validation failed", "validate");
        metadata = {
          width: layout.sheetWidth,
          height: layout.sheetHeight,
          times: job.times.slice(),
          tileWidth: layout.tileWidth,
          tileHeight: layout.tileHeight,
          sheetWidth: layout.sheetWidth,
          sheetHeight: layout.sheetHeight,
        };
      } else {
        bytes = await readFile(produced);
        if (!validPng(bytes, doc.width, doc.height))
          fail("E_METADATA", "PNG validation failed", "validate");
        metadata = {
          width: doc.width,
          height: doc.height,
          time: job.time,
          frame: job.frame,
        };
      }
      if (job.controller.signal.aborted) {
        final = "cancelled";
        return;
      }
      const name = job.jobId + (job.kind === "render" ? ".mp4" : ".png");
      await rename(produced, resolve(this.config.outputRoot, name));
      job.artifact = {
        projectId: job.projectId,
        revision: job.revision,
        jobId: job.jobId,
        name,
        hash: artifactHash(bytes),
        bytes: bytes.length,
        metadata,
        tools: this.tools,
      };
      final = "succeeded";
    } catch (e) {
      job.error = {
        code: e.code?.startsWith("E_") ? e.code : "E_RENDER",
        message: "Job failed without publishing an artifact",
        stage: job.stage,
      };
    } finally {
      try {
        if (job.temp) await rm(job.temp, { recursive: true, force: true });
        job.cleaned = true;
      } catch {
        final = "failed";
        job.error = {
          code: "E_CLEANUP",
          message: "Private job cleanup failed",
          stage: "cleanup",
        };
      }
      // A cancellation can arrive while the private directory is being
      // removed. The UUID output belongs exclusively to this job, so retract
      // it before publishing a terminal cancelled/failed result.
      if (final !== "succeeded" || job.controller.signal.aborted) {
        if (job.artifact) {
          try {
            await rm(resolve(this.config.outputRoot, job.artifact.name), {
              force: true,
            });
            delete job.artifact;
          } catch {
            final = "failed";
            job.error = {
              code: "E_CLEANUP",
              message: "Published artifact cleanup failed",
              stage: "cleanup",
            };
          }
        }
        if (job.controller.signal.aborted && job.error?.code !== "E_CLEANUP")
          final = "cancelled";
      }
      job.state = final;
      job.stage = "finished";
    }
  }
}
export function versions(config = {}) {
  const version = (exe, args) => {
    try {
      return execFileSync(exe, args, {
        encoding: "utf8",
        timeout: 5000,
        maxBuffer: 8192,
        stdio: ["ignore", "pipe", "pipe"],
      })
        .split("\n")[0]
        .trim();
    } catch {
      return "unavailable";
    }
  };
  const pkg = (name) =>
    JSON.parse(
      readFileSync(resolve(packageRoot, "node_modules", name, "package.json")),
    ).version;
  return {
    node: process.version,
    platform: process.platform,
    hyperframes: pkg("hyperframes"),
    sdk: pkg("@hyperframes/sdk"),
    gsap: pkg("gsap"),
    fps: 30,
    browser: version(
      config.browserPath ||
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      ["--version"],
    ),
    ffmpeg: version("ffmpeg", ["-version"]),
    ffprobe: version("ffprobe", ["-version"]),
  };
}
