import { mkdir, mkdtemp, rm, readFile, rename, stat } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { buildDocument } from "@hyperframes/sdk";
import { runOwned } from "./process.mjs";
import { sha } from "./projects.mjs";
import { fail, number } from "./errors.mjs";
const packageRoot = fileURLToPath(new URL("../", import.meta.url));
const cli = resolve(packageRoot, "node_modules/hyperframes/dist/cli.js");
const terminal = new Set(["succeeded", "failed", "cancelled", "timed_out"]);
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
  env(temp) {
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
        number(p.time, 0, doc.compositionDuration - 1 / 30);
        job.time = p.time;
        job.frame = p.time * fps;
        args = [
          "snapshot",
          snapshot,
          "--at",
          String(p.time),
          "--no-end",
          "--keep",
          "--describe",
          "false",
          "--no-browser-gpu",
          "-o",
          resolve(job.temp, "frames"),
        ];
        produced = resolve(
          job.temp,
          "frames",
          `at-${Number(p.time.toFixed(3))}s.png`,
        );
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
        env: this.env(job.temp),
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
      const bytes = await readFile(produced);
      let metadata;
      if (job.kind === "render") {
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
            env: this.env(job.temp),
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
      } else {
        if (
          bytes.length < 24 ||
          bytes.readUInt32BE(0) !== 0x89504e47 ||
          bytes.readUInt32BE(16) !== doc.width ||
          bytes.readUInt32BE(20) !== doc.height
        )
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
        hash: sha(bytes),
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
        if (
          job.controller.signal.aborted &&
          job.error?.code !== "E_CLEANUP"
        )
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
