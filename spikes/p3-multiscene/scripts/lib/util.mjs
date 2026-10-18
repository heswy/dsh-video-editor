import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const root = fileURLToPath(new URL("../../", import.meta.url));
export const artifacts = resolve(root, "artifacts");
export const evidenceDir = resolve(root, "evidence");
export const cli = resolve(root, "node_modules/hyperframes/dist/cli.js");
export const gsapDist = resolve(root, "node_modules/gsap/dist");
export const systemFont = "/System/Library/Fonts/STHeiti Medium.ttc";
export const chromePath =
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

export const sha256 = (bytes) =>
  createHash("sha256").update(bytes).digest("hex");

export async function resetDir(path) {
  await rm(path, { recursive: true, force: true });
  await mkdir(path, { recursive: true });
}

export async function writeJson(path, value) {
  await mkdir(resolve(path, ".."), { recursive: true });
  await writeFile(path, JSON.stringify(value, null, 2) + "\n");
}

export async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

export async function copyAssets(projectDir, { font = false } = {}) {
  const assets = resolve(projectDir, "assets");
  await mkdir(assets, { recursive: true });
  for (const name of ["gsap.min.js", "MotionPathPlugin.min.js"])
    await copyFile(resolve(gsapDist, name), resolve(assets, name));
  if (font) await copyFile(systemFont, resolve(assets, "Heiti.ttc"));
}

// Local environment for the official CLI: no network, deterministic caches and
// software GPU, mirroring the accepted worker's launch conventions.
export function cliEnv(temp) {
  return {
    ...process.env,
    TMPDIR: resolve(temp, "tmp"),
    HYPERFRAMES_BROWSER_PATH: chromePath,
    PRODUCER_BROWSER_GPU_MODE: "software",
    HYPERFRAMES_NO_TELEMETRY: "1",
    DO_NOT_TRACK: "1",
    HEYGEN_CONFIG_DIR: resolve(temp, "auth"),
    XDG_STATE_HOME: resolve(temp, "state"),
    HYPERFRAMES_FONT_CACHE_DIR: resolve(temp, "fonts"),
    HYPERFRAMES_EXTRACT_CACHE_DIR: "off",
  };
}

export async function ensureTemp(temp) {
  for (const dir of ["tmp", "auth", "state", "fonts"])
    await mkdir(resolve(temp, dir), { recursive: true });
}

export function runCli(args, { cwd, temp, timeoutMs = 180000 }) {
  const started = performance.now();
  const stdout = execFileSync(
    process.execPath,
    [cli, ...args],
    {
      cwd,
      env: cliEnv(temp),
      encoding: "utf8",
      timeout: timeoutMs,
      maxBuffer: 16 * 1024 * 1024,
    },
  );
  return { stdout, ms: Math.round(performance.now() - started) };
}

export function ffprobe(file) {
  const stdout = execFileSync(
    "ffprobe",
    [
      "-v",
      "error",
      "-count_frames",
      "-select_streams",
      "v:0",
      "-show_entries",
      "stream=codec_name,width,height,r_frame_rate,avg_frame_rate,nb_frames,nb_read_frames:format=duration,size",
      "-of",
      "json",
      file,
    ],
    { encoding: "utf8" },
  );
  return JSON.parse(stdout);
}

// Read one pixel of a frame from an MP4/PNG through ffmpeg, so scene/asset
// checks are based on decoded real bytes instead of image metadata.
export function samplePixel(file, { x, y, time }) {
  const args = ["-v", "error"];
  if (time !== undefined) args.push("-ss", String(time));
  args.push(
    "-i",
    file,
    "-vf",
    `crop=1:1:${x}:${y}:exact=1,format=rgb24`,
    "-frames:v",
    "1",
    "-f",
    "rawvideo",
    "-",
  );
  const bytes = execFileSync("ffmpeg", args, {
    maxBuffer: 1024,
    encoding: "buffer",
  });
  return { rgb: [...bytes.subarray(0, 3)], hex: "#" + [...bytes.subarray(0, 3)].map((b) => b.toString(16).padStart(2, "0")).join("") };
}

export async function listFilesRecursive(dir, prefix = "") {
  const out = [];
  for (const entry of await readdir(resolve(dir, prefix), { withFileTypes: true })) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...(await listFilesRecursive(dir, path)));
    else out.push(path);
  }
  return out.sort();
}
