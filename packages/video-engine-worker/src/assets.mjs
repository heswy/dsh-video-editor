/**
 * Engineering media library for one managed project (V1 M2-01).
 *
 * Media is project-scoped and deliberately OUTSIDE the composition revision:
 *   <projectDir>/media/<sha8>.<ext>   content-addressed bytes (write-once)
 *   <projectDir>/asset-index.json     {version, indexRevision, assets[]}
 *
 * Guiding rules:
 *   - bytes are streamed (never `readFile` a GB asset);
 *   - the same bytes are stored once per project (dedupe by full sha256, so a
 *     renamed/re-encoded copy of the same file reuses the first asset);
 *   - the index is written through temp+rename and carries a deterministic
 *     `indexRevision` over the full persisted fields, independent of the
 *     composition revision and of `project.json`;
 *   - a corrupt index is preserved as `.corrupt-<ts>` and rebuilt by scanning
 *     `media/` (best effort);
 *   - only `<projectDir>/media/...` paths derived from the index are ever
 *     touched: the caller cannot pass a path.
 */
import { createHash, randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { createReadStream, createWriteStream } from "node:fs";
import {
  link,
  mkdir,
  readdir,
  readFile,
  writeFile,
  realpath,
  rename,
  rm,
  stat,
  lstat,
  unlink,
} from "node:fs/promises";
import { basename, dirname, extname, join, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import { inside, sha256 } from "./registry.mjs";
import { fail, keys, number, string } from "./errors.mjs";

export const INDEX_VERSION = 1;
export const INDEX_FILE = "asset-index.json";
export const MEDIA_DIR = "media";
/** Hard caps; Host limits can only lower them (trusted deployment config). */
export const MAX_MEDIA_BYTES = 2 * 1024 * 1024 * 1024;
export const MAX_PROJECT_MEDIA_BYTES = 8 * 1024 * 1024 * 1024;
export const MAX_INDEX_BYTES = 16 * 1024 * 1024;
export const MAX_LIST_LIMIT = 50;
export const MAX_QUERY_LENGTH = 120;
export const PROBE_TIMEOUT_MS = 30000;

export const IMAGE_EXT = Object.freeze([".png", ".jpg", ".jpeg"]);
export const VIDEO_EXT = Object.freeze([".mp4", ".mov", ".m4v", ".webm"]);
export const AUDIO_EXT = Object.freeze([".mp3", ".wav", ".m4a", ".aac", ".flac"]);
export const MEDIA_EXT = Object.freeze([...VIDEO_EXT, ...AUDIO_EXT, ...IMAGE_EXT]);
const EXT_MEDIA_TYPE = Object.freeze({
  ".mp4": "video/mp4",
  ".m4v": "video/mp4",
  ".mov": "video/quicktime",
  ".webm": "video/webm",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".m4a": "audio/mp4",
  ".aac": "audio/aac",
  ".flac": "audio/flac",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
});
const ASSET_ID = /^as_[a-f0-9]{8}$/;
const SAFE_SOURCE = /^[A-Za-z0-9][A-Za-z0-9._ -]{0,180}$/;
const SAFE_NAME_MAX = 120;
const KIND = Object.freeze(["video", "image", "audio"]);
const PROJECT_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

function mediaError(code, message, stage = "asset") {
  fail(code, message, stage);
}

export function normalizeExt(value) {
  const extension = typeof value === "string" ? extname(value).toLowerCase() : "";
  return MEDIA_EXT.includes(extension) ? extension : null;
}

export function kindForExt(extension) {
  if (IMAGE_EXT.includes(extension)) return "image";
  if (VIDEO_EXT.includes(extension)) return "video";
  if (AUDIO_EXT.includes(extension)) return "audio";
  return null;
}

export function mediaTypeForExt(extension) {
  return EXT_MEDIA_TYPE[extension] || "application/octet-stream";
}

export function assetIdForSha(digest) {
  return "as_" + String(digest).slice(0, 8);
}

export function mediaFileName(asset) {
  const digest = typeof asset === "string" ? asset : asset && asset.sha256;
  const extension = typeof asset === "string" ? "" : asset && asset.ext;
  if (typeof digest !== "string" || /^[a-f0-9]{64}$/.test(digest) === false)
    mediaError("E_INTERNAL", "Asset hash is invalid");
  if (typeof extension !== "string" || MEDIA_EXT.includes("." + extension) === false)
    mediaError("E_INTERNAL", "Asset extension is invalid");
  return `${digest.slice(0, 8)}.${extension}`;
}

/**
 * Canonical persisted fields (fixed key order) covered by `indexRevision`.
 * Renames/metadata edits therefore change the revision, while storage order or
 * pretty-printing does not.
 */
export function canonicalAsset(asset) {
  return {
    assetId: asset.assetId,
    kind: asset.kind,
    name: asset.name,
    ext: asset.ext,
    sha256: asset.sha256,
    bytes: asset.bytes,
    media:
      asset.media && typeof asset.media === "object"
        ? Object.fromEntries(
            Object.keys(asset.media)
              .sort()
              .map((key) => [key, asset.media[key]]),
          )
        : null,
    origin: asset.origin,
    createdAt: asset.createdAt,
  };
}

export function canonicalIndexPayload(assets) {
  const sorted = [...assets].sort((left, right) =>
    left.assetId < right.assetId ? -1 : left.assetId > right.assetId ? 1 : 0,
  );
  return JSON.stringify({ version: INDEX_VERSION, assets: sorted.map(canonicalAsset) });
}

export function indexRevisionForAssets(assets) {
  return sha256(canonicalIndexPayload(assets));
}

function sanitizeDisplayName(value, sourceName) {
  const fallback =
    typeof sourceName === "string" && basename(sourceName).length > 0
      ? basename(sourceName)
      : "asset";
  const raw = typeof value === "string" && value.trim().length > 0 ? value.trim() : fallback;
  const cleaned = raw
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .slice(0, SAFE_NAME_MAX)
    .trim();
  if (cleaned.length === 0) mediaError("E_PARAMS", "Invalid asset name");
  return cleaned;
}

function safeLimit(value, fallback, hardCap) {
  if (value === undefined) return fallback;
  if (
    typeof value !== "number" ||
    Number.isFinite(value) === false ||
    value < 1024 ||
    value > hardCap
  ) {
    mediaError("E_PARAMS", "Invalid media limit");
  }
  return Math.floor(value);
}

export function parseLimits(value) {
  const settings = value === undefined || value === null ? {} : value;
  keys(settings, ["maxBytes", "maxProjectBytes"], []);
  return {
    maxBytes: safeLimit(settings.maxBytes, MAX_MEDIA_BYTES, MAX_MEDIA_BYTES),
    maxProjectBytes: safeLimit(
      settings.maxProjectBytes,
      MAX_PROJECT_MEDIA_BYTES,
      MAX_PROJECT_MEDIA_BYTES,
    ),
  };
}

// ─── parameter validation (mirrored in protocol.schema.json) ────────────────

export function validateImportMedia(p) {
  keys(
    p,
    ["projectId", "operationId", "sourceName", "name", "mediaTypeHint", "limits"],
    ["projectId", "sourceName"],
  );
  string(p.projectId);
  string(p.sourceName, 256);
  if (p.operationId !== undefined) string(p.operationId);
  if (p.name !== undefined) string(p.name, SAFE_NAME_MAX);
  if (p.mediaTypeHint !== undefined) string(p.mediaTypeHint, 64);
  if (p.limits !== undefined) parseLimits(p.limits);
}

export function validateAssetList(p) {
  keys(p, ["projectId", "kind", "query", "cursor", "limit"], ["projectId"]);
  string(p.projectId);
  if (p.kind !== undefined && KIND.includes(p.kind) === false)
    mediaError("E_PARAMS", "Invalid asset kind");
  if (p.query !== undefined) string(p.query, MAX_QUERY_LENGTH);
  if (p.cursor !== undefined) {
    string(p.cursor, 12);
    if (/^\d+$/.test(p.cursor) === false) mediaError("E_PARAMS", "Invalid asset cursor");
  }
  if (p.limit !== undefined) {
    number(p.limit, 1, MAX_LIST_LIMIT);
    if (Number.isInteger(p.limit) === false) mediaError("E_PARAMS", "limit must be an integer");
  }
}

export function validateAssetRemove(p) {
  keys(p, ["projectId", "assetId", "operationId"], ["projectId", "assetId"]);
  string(p.projectId);
  if (typeof p.assetId !== "string" || ASSET_ID.test(p.assetId) === false)
    mediaError("E_PARAMS", "Invalid assetId");
  if (p.operationId !== undefined) string(p.operationId);
}

// ─── probing ────────────────────────────────────────────────────────────────

/** Leading-byte signature for the image formats we accept. */
export async function sniffImageFile(path) {
  const chunks = [];
  await new Promise((resolveRead, rejectRead) => {
    const stream = createReadStream(path, { start: 0, end: 15 });
    stream.on("data", (chunk) => chunks.push(chunk));
    stream.on("error", rejectRead);
    stream.on("end", resolveRead);
  });
  const bytes = Buffer.concat(chunks);
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  )
    return "image/png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
    return "image/jpeg";
  return null;
}

/** Run ffprobe for one file with a hard timeout; returns parsed JSON. */
export function runFfprobe(path, timeoutMs = PROBE_TIMEOUT_MS) {
  return new Promise((resolveProbe, rejectProbe) => {
    let settled = false;
    const child = spawn(
      "ffprobe",
      ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", path],
      {
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try {
        child.kill("SIGKILL");
      } catch (_error) {
        /* best effort */
      }
      rejectProbe(Object.assign(new Error("ffprobe timed out"), { code: "E_ASSET_PROBE" }));
    }, timeoutMs);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      if (stdout.length < 4 * 1024 * 1024) stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      if (stderr.length < 16 * 1024) stderr += chunk;
    });
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      rejectProbe(
        Object.assign(new Error("ffprobe is unavailable"), { code: "E_ASSET_PROBE", cause: error }),
      );
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code !== 0) {
        rejectProbe(
          Object.assign(new Error("ffprobe rejected the media"), { code: "E_ASSET_PROBE" }),
        );
        return;
      }
      try {
        resolveProbe(JSON.parse(stdout));
      } catch (_error) {
        rejectProbe(
          Object.assign(new Error("ffprobe output was invalid"), { code: "E_ASSET_PROBE" }),
        );
      }
    });
  });
}

function frameRate(value) {
  if (typeof value !== "string") return undefined;
  const match = /^(\d+)\/(\d+)$/.exec(value);
  if (match === null) return undefined;
  const numerator = Number(match[1]);
  const denominator = Number(match[2]);
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0)
    return undefined;
  return Math.round((numerator / denominator) * 1000) / 1000;
}

function positiveNumber(value) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) && numberValue > 0 ? numberValue : undefined;
}

/**
 * Probe one media file and return `{kind, media, mediaType}`.
 * The extension whitelist decides the expected kind; the real container/stream
 * shape must agree (a renamed .txt or a video declared as audio is rejected).
 */
export async function probeMedia(path, extension) {
  const kind = kindForExt(extension);
  if (kind === null) mediaError("E_ASSET_UNSUPPORTED", "Unsupported media extension");
  if (kind === "image") {
    const signature = await sniffImageFile(path);
    if (signature === null) mediaError("E_ASSET_UNSUPPORTED", "Only PNG/JPEG images are supported");
    if (extension === ".png" && signature !== "image/png")
      mediaError("E_ASSET_UNSUPPORTED", "Image signature does not match .png");
    if (extension !== ".png" && signature !== "image/jpeg")
      mediaError("E_ASSET_UNSUPPORTED", "Image signature does not match .jpg/.jpeg");
    const info = await runFfprobe(path).catch(() => null);
    const stream =
      info !== null && Array.isArray(info.streams)
        ? info.streams.find((entry) => entry.codec_type === "video")
        : null;
    if (!stream || !positiveNumber(stream.width) || !positiveNumber(stream.height))
      mediaError("E_ASSET_UNSUPPORTED", "Image cannot be decoded");
    const media = {};
    const width = stream === null ? undefined : positiveNumber(stream.width);
    const height = stream === null ? undefined : positiveNumber(stream.height);
    if (width !== undefined && height !== undefined) {
      media.width = width;
      media.height = height;
    }
    return { kind, media, mediaType: signature };
  }
  let info;
  try {
    info = await runFfprobe(path);
  } catch (error) {
    mediaError(
      error && error.code === "E_ASSET_PROBE" ? "E_ASSET_PROBE" : "E_ASSET_UNSUPPORTED",
      "Media could not be probed by ffprobe",
    );
  }
  const streams = Array.isArray(info.streams) ? info.streams : [];
  const videoStream = streams.find(
    (entry) =>
      entry.codec_type === "video" &&
      (entry.disposition === undefined || entry.disposition.attached_pic !== 1),
  );
  const audioStream = streams.find((entry) => entry.codec_type === "audio");
  const formatName =
    info.format !== null && typeof info.format === "object"
      ? String(info.format.format_name || "")
      : "";
  const containers = {
    ".mp4": ["mov", "mp4"],
    ".mov": ["mov", "mp4"],
    ".m4v": ["mov", "mp4"],
    ".webm": ["matroska", "webm"],
    ".mp3": ["mp3"],
    ".wav": ["wav"],
    ".m4a": ["mov", "mp4"],
    ".aac": ["aac"],
    ".flac": ["flac"],
  };
  if (!containers[extension]?.some((name) => formatName.split(",").includes(name)))
    mediaError("E_ASSET_UNSUPPORTED", "Media container does not match extension");
  if (kind === "audio" && videoStream)
    mediaError("E_ASSET_UNSUPPORTED", "Audio file contains a video stream");
  const durationSec = positiveNumber(info.format && info.format.duration);
  if (kind === "video") {
    if (durationSec === undefined) mediaError("E_ASSET_UNSUPPORTED", "Video duration is unknown");
    if (videoStream === undefined)
      mediaError("E_ASSET_UNSUPPORTED", "The file has no video stream");
    if (formatName.length === 0)
      mediaError("E_ASSET_UNSUPPORTED", "The video container is unknown");
    const media = {};
    if (durationSec !== undefined) media.durationSec = Math.round(durationSec * 1000) / 1000;
    const width = positiveNumber(videoStream.width);
    const height = positiveNumber(videoStream.height);
    if (width !== undefined) media.width = width;
    if (height !== undefined) media.height = height;
    const fps = frameRate(videoStream.r_frame_rate) ?? frameRate(videoStream.avg_frame_rate);
    if (fps !== undefined) media.fps = fps;
    if (typeof videoStream.codec_name === "string") media.videoCodec = videoStream.codec_name;
    media.hasAudio = audioStream !== undefined;
    if (audioStream !== undefined) {
      const sampleRate = positiveNumber(audioStream.sample_rate);
      if (sampleRate !== undefined) media.sampleRate = sampleRate;
      const channels = positiveNumber(audioStream.channels);
      if (channels !== undefined) media.channels = channels;
      if (typeof audioStream.codec_name === "string") media.audioCodec = audioStream.codec_name;
    }
    return { kind, media, mediaType: mediaTypeForExt(extension) };
  }
  // audio
  if (audioStream === undefined) mediaError("E_ASSET_UNSUPPORTED", "The file has no audio stream");
  if (durationSec === undefined) mediaError("E_ASSET_UNSUPPORTED", "The audio duration is unknown");
  const media = { durationSec: Math.round(durationSec * 1000) / 1000 };
  const sampleRate = positiveNumber(audioStream.sample_rate);
  if (sampleRate !== undefined) media.sampleRate = sampleRate;
  const channels = positiveNumber(audioStream.channels);
  if (channels !== undefined) media.channels = channels;
  if (typeof audioStream.codec_name === "string") media.audioCodec = audioStream.codec_name;
  return { kind, media, mediaType: mediaTypeForExt(extension) };
}

/** Streaming SHA-256 (1 MiB chunks; bounded memory, used for import/recovery). */
export async function sha256File(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path, { highWaterMark: 1024 * 1024 }))
    hash.update(chunk);
  return hash.digest("hex");
}

async function fileExists(path) {
  try {
    return (await stat(path)).isFile();
  } catch (_error) {
    return false;
  }
}

// ─── the library ────────────────────────────────────────────────────────────

export class MediaLibrary {
  constructor(options = {}) {
    this.config = options.config;
    this.diagnostic = typeof options.diagnostic === "function" ? options.diagnostic : () => {};
    this.operations = new Map();
  }

  async projectDirectory(projectId) {
    const registered = Object.prototype.hasOwnProperty.call(this.config.projects, projectId)
      ? this.config.projects[projectId]
      : undefined;
    if (typeof registered !== "string")
      mediaError("E_PROJECT_NOT_FOUND", "Project is not registered");
    let directory;
    let root;
    try {
      directory = await realpath(registered);
      root = await realpath(this.config.root);
    } catch (_error) {
      mediaError("E_PROJECT_NOT_FOUND", "Project is unavailable");
    }
    if (inside(root, directory) === false)
      mediaError("E_PATH", "Project escapes the registered root");
    if ((await stat(directory)).isDirectory() === false)
      mediaError("E_PROJECT_NOT_FOUND", "Project is not a directory");
    return directory;
  }

  indexPath(projectDir) {
    return join(projectDir, INDEX_FILE);
  }

  mediaDir(projectDir) {
    return join(projectDir, MEDIA_DIR);
  }

  /** Read the index, rebuilding it from media/ when the file is unusable. */
  async readIndex(projectDir) {
    const path = this.indexPath(projectDir);
    let info = null;
    try {
      info = await stat(path);
    } catch (error) {
      if (error.code !== "ENOENT") mediaError("E_ASSET_INDEX", "Asset index is unavailable");
      info = null;
    }
    if (info === null) {
      try {
        await stat(this.mediaDir(projectDir));
        return this.recoverIndex(projectDir, "E_INDEX_MISSING");
      } catch {
        return this.emptyIndex();
      }
    }
    if (!(await lstat(path)).isFile()) mediaError("E_PATH", "Asset index must be a regular file");
    if (info.isFile() === false || info.size > MAX_INDEX_BYTES)
      return this.recoverIndex(projectDir, "E_INDEX_SHAPE");
    let parsed;
    try {
      parsed = JSON.parse(await readFile(path, "utf8"));
    } catch (_error) {
      return this.recoverIndex(projectDir, "E_INDEX_JSON");
    }
    if (
      parsed === null ||
      typeof parsed !== "object" ||
      Array.isArray(parsed) ||
      parsed.version !== INDEX_VERSION ||
      Array.isArray(parsed.assets) === false
    ) {
      return this.recoverIndex(projectDir, "E_INDEX_SHAPE");
    }
    const assets = [];
    for (const entry of parsed.assets) {
      if (entry === null || typeof entry !== "object" || Array.isArray(entry))
        return this.recoverIndex(projectDir, "E_INDEX_ENTRY");
      if (typeof entry.assetId !== "string" || ASSET_ID.test(entry.assetId) === false)
        return this.recoverIndex(projectDir, "E_INDEX_ENTRY");
      if (KIND.includes(entry.kind) === false)
        return this.recoverIndex(projectDir, "E_INDEX_ENTRY");
      if (typeof entry.sha256 !== "string" || /^[a-f0-9]{64}$/.test(entry.sha256) === false)
        return this.recoverIndex(projectDir, "E_INDEX_ENTRY");
      if (typeof entry.ext !== "string" || MEDIA_EXT.includes("." + entry.ext) === false)
        return this.recoverIndex(projectDir, "E_INDEX_ENTRY");
      if (!Number.isSafeInteger(entry.bytes) || entry.bytes < 0)
        return this.recoverIndex(projectDir, "E_INDEX_ENTRY");
      if (
        entry.assetId !== assetIdForSha(entry.sha256) ||
        entry.kind !== kindForExt("." + entry.ext) ||
        assets.some((a) => a.assetId === entry.assetId)
      )
        return this.recoverIndex(projectDir, "E_INDEX_ENTRY");
      const metadata = {};
      for (const key of ["durationSec", "width", "height", "fps", "sampleRate", "channels"])
        if (Number.isFinite(entry.media?.[key]) && entry.media[key] > 0)
          metadata[key] = entry.media[key];
      for (const key of ["videoCodec", "audioCodec"])
        if (typeof entry.media?.[key] === "string") metadata[key] = entry.media[key].slice(0, 64);
      if (typeof entry.media?.hasAudio === "boolean") metadata.hasAudio = entry.media.hasAudio;
      assets.push({
        assetId: entry.assetId,
        kind: entry.kind,
        name:
          typeof entry.name === "string" && entry.name.length > 0
            ? entry.name.slice(0, SAFE_NAME_MAX)
            : `${entry.assetId}.${entry.ext}`,
        ext: entry.ext,
        sha256: entry.sha256,
        bytes: entry.bytes,
        media: metadata,
        origin: entry.origin === "recovered" ? "recovered" : "import",
        createdAt:
          typeof entry.createdAt === "string" && entry.createdAt.length <= 40
            ? entry.createdAt
            : new Date(0).toISOString(),
      });
    }
    return { assets, indexRevision: indexRevisionForAssets(assets), recovered: false };
  }

  emptyIndex() {
    return { assets: [], indexRevision: indexRevisionForAssets([]), recovered: false };
  }

  async writeIndex(projectDir, assets) {
    const revision = indexRevisionForAssets(assets);
    const payload = {
      version: INDEX_VERSION,
      indexRevision: revision,
      assets: [...assets]
        .sort((left, right) =>
          left.assetId < right.assetId ? -1 : left.assetId > right.assetId ? 1 : 0,
        )
        .map(canonicalAsset),
    };
    const bytes = JSON.stringify(payload, null, 2) + "\n";
    if (Buffer.byteLength(bytes) > MAX_INDEX_BYTES) mediaError("E_LIMIT", "Asset index is full");
    const temporary = join(projectDir, `.asset-index-${randomBytes(8).toString("hex")}.tmp`);
    try {
      await writeFile(temporary, bytes, { mode: 0o600, flag: "wx" });
      await rename(temporary, this.indexPath(projectDir));
    } finally {
      await rm(temporary, { force: true }).catch(() => {});
    }
    return revision;
  }

  /** Keep the corrupt index bytes, then rebuild from `media/` (best effort). */
  async recoverIndex(projectDir, code) {
    const path = this.indexPath(projectDir);
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    try {
      await rename(path, `${path}.corrupt-${stamp}-${randomBytes(4).toString("hex")}`);
    } catch (error) {
      if (error.code !== "ENOENT")
        mediaError("E_ASSET_INDEX", "Corrupt asset index could not be preserved");
    }
    this.diagnostic("media index recovered");
    const mediaDir = this.mediaDir(projectDir);
    await this.safeMediaDirectory(projectDir, false);
    const assets = [];
    let names = [];
    try {
      names = (await readdir(mediaDir)).sort();
    } catch (_error) {
      names = [];
    }
    for (const name of names) {
      const match = /^([a-f0-9]{8})\.([a-z0-9]+)$/.exec(name);
      if (match === null) continue;
      const extension = "." + match[2];
      if (MEDIA_EXT.includes(extension) === false) continue;
      const filePath = join(mediaDir, name);
      let info;
      try {
        info = await lstat(filePath);
      } catch (_error) {
        continue;
      }
      if (info.isFile() === false) continue;
      let digest;
      try {
        digest = await sha256File(filePath);
      } catch (_error) {
        continue;
      }
      if (digest.slice(0, 8) !== match[1]) {
        // A file whose name does not match its bytes is not safe to expose.
        continue;
      }
      let probed;
      try {
        probed = await probeMedia(filePath, extension);
      } catch (_error) {
        continue;
      }
      assets.push({
        assetId: assetIdForSha(digest),
        kind: probed.kind,
        name: `${match[1]}.${match[2]}`,
        ext: match[2],
        sha256: digest,
        bytes: info.size,
        media: probed.media,
        origin: "recovered",
        createdAt: new Date(info.mtimeMs).toISOString(),
      });
    }
    // Duplicate bytes cannot produce duplicate asset ids; keep the first.
    const unique = new Map();
    for (const asset of assets)
      if (unique.has(asset.assetId) === false) unique.set(asset.assetId, asset);
    const merged = [...unique.values()];
    let revision;
    try {
      revision = await this.writeIndex(projectDir, merged);
    } catch (_error) {
      revision = indexRevisionForAssets(merged);
    }
    return { assets: merged, indexRevision: revision, recovered: true, recoveryCode: code };
  }

  operationResult(projectId, operationId, signature) {
    if (operationId === undefined) return undefined;
    const key = projectId + "\0" + operationId;
    const previous = this.operations.get(key);
    if (previous === undefined) return undefined;
    if (previous.signature !== signature)
      mediaError("E_OPERATION_REUSED", "operationId already has a different request", "operation");
    return previous.result;
  }

  rememberOperation(projectId, operationId, signature, result) {
    if (operationId === undefined) return result;
    if (this.operations.size >= 2048)
      mediaError("E_LIMIT", "Operation history full; restart worker", "operation");
    this.operations.set(projectId + "\0" + operationId, { signature, result });
    return result;
  }

  /** Locate one inbox file (plain basename only; realpath inside the inbox). */
  async inboxFile(sourceName) {
    if (typeof this.config.assetInboxRoot !== "string")
      mediaError("E_CONFIGURATION", "No assetInboxRoot is configured");
    if (typeof sourceName !== "string" || sourceName.length === 0 || sourceName.length > 256)
      mediaError("E_PARAMS", "Invalid sourceName");
    if (
      SAFE_SOURCE.test(sourceName) === false ||
      sourceName.includes("/") ||
      sourceName.includes("\\") ||
      sourceName.includes("..")
    ) {
      mediaError("E_PARAMS", "Invalid sourceName");
    }
    let inbox;
    try {
      inbox = await realpath(this.config.assetInboxRoot);
    } catch (_error) {
      mediaError("E_ASSET_MISSING", "The asset inbox is unavailable");
    }
    let source;
    try {
      source = await realpath(resolve(inbox, sourceName));
    } catch (_error) {
      mediaError("E_ASSET_MISSING", "Inbox asset is unavailable");
    }
    if (inside(inbox, source) === false) mediaError("E_PATH", "Inbox asset escapes assetInboxRoot");
    const info = await stat(source);
    if (info.isFile() === false) mediaError("E_ASSET_MISSING", "Inbox asset is not a file");
    if (info.size <= 0) mediaError("E_PARAMS", "Inbox asset is empty");
    return { source, info, extension: normalizeExt(sourceName) };
  }

  async importMedia(p) {
    const limits = parseLimits(p.limits);
    const signature = sha256(
      JSON.stringify({
        projectId: p.projectId,
        sourceName: p.sourceName,
        name: p.name === undefined ? null : p.name,
        limits,
      }),
    );
    const cached = this.operationResult(p.projectId, p.operationId, signature);
    if (cached !== undefined) return cached;
    if (p.operationId !== undefined && this.operations.size >= 2048)
      mediaError("E_LIMIT", "Operation history full; restart worker", "operation");
    const projectDir = await this.projectDirectory(p.projectId);
    const inbox = await this.inboxFile(p.sourceName);
    if (inbox.extension === null) mediaError("E_ASSET_UNSUPPORTED", "Unsupported media format");
    if (inbox.info.size > limits.maxBytes)
      mediaError("E_LIMIT", "Asset exceeds the per-file media limit");
    const expectedKind = kindForExt(inbox.extension);
    const digest = await sha256File(inbox.source);
    const assetId = assetIdForSha(digest);
    const index = await this.readIndex(projectDir);
    const existing = index.assets.find((asset) => asset.sha256 === digest);
    if (existing !== undefined) {
      // Same bytes under a different name/extension: reuse the first asset.
      const result = {
        projectId: p.projectId,
        asset: existing,
        indexRevision: index.indexRevision,
        deduped: true,
      };
      return this.rememberOperation(p.projectId, p.operationId, signature, result);
    }
    const total = index.assets.reduce((sum, asset) => sum + asset.bytes, 0) + inbox.info.size;
    if (total > limits.maxProjectBytes)
      mediaError("E_LIMIT", "Project media exceeds the project limit");
    const collision = index.assets.find((asset) => asset.assetId === assetId);
    if (collision !== undefined)
      mediaError("E_ASSET_CONFLICT", "Content-addressed asset id collides with different bytes");
    const mediaDir = this.mediaDir(projectDir);
    await this.safeMediaDirectory(projectDir, true);
    const probed = await probeMedia(inbox.source, inbox.extension);
    if (probed.kind !== expectedKind)
      mediaError("E_ASSET_UNSUPPORTED", "Media type does not match the file extension");
    const targetName = mediaFileName({ sha256: digest, ext: inbox.extension.slice(1) });
    const target = join(mediaDir, targetName);
    const realMediaDir = await realpath(mediaDir);
    if (inside(realMediaDir, await realpath(dirname(target)).catch(() => realMediaDir)) === false) {
      mediaError("E_PATH", "Asset target escapes the project media directory");
    }
    if (await fileExists(target)) {
      if (!(await lstat(target)).isFile())
        mediaError("E_PATH", "Media target must be a regular file");
      const existingDigest = await sha256File(target);
      if (existingDigest !== digest)
        mediaError("E_ASSET_CONFLICT", "Media file name collides with different bytes");
    } else {
      // Prefer a same-filesystem hardlink; fall back to a streaming copy.
      try {
        await link(inbox.source, target);
      } catch (_linkError) {
        const temporary = `${target}.${randomBytes(4).toString("hex")}.tmp`;
        try {
          await pipeline(
            createReadStream(inbox.source, { highWaterMark: 1024 * 1024 }),
            createWriteStream(temporary, { mode: 0o600 }),
          );
          await rename(temporary, target);
        } catch (error) {
          await rm(temporary, { force: true }).catch(() => {});
          mediaError("E_ASSET_WRITE", "Could not store the media file", "asset");
        }
      }
    }
    const asset = {
      assetId,
      kind: probed.kind,
      name: sanitizeDisplayName(p.name, p.sourceName),
      ext: inbox.extension.slice(1),
      sha256: digest,
      bytes: inbox.info.size,
      media: probed.media,
      origin: "import",
      createdAt: new Date().toISOString(),
    };
    const assets = [...index.assets, asset];
    let revision;
    try {
      revision = await this.writeIndex(projectDir, assets);
    } catch (error) {
      // The index is the commit point: do not leave an unreferenced media file.
      await rm(target, { force: true }).catch(() => {});
      mediaError("E_ASSET_WRITE", "Could not update the asset index", "asset");
    }
    const result = { projectId: p.projectId, asset, indexRevision: revision, deduped: false };
    return this.rememberOperation(p.projectId, p.operationId, signature, result);
  }

  async list(p) {
    const projectDir = await this.projectDirectory(p.projectId);
    const index = await this.readIndex(projectDir);
    let assets = index.assets.slice();
    if (p.kind !== undefined) assets = assets.filter((asset) => asset.kind === p.kind);
    if (p.query !== undefined && p.query.length > 0) {
      const needle = p.query.toLowerCase();
      assets = assets.filter((asset) => asset.name.toLowerCase().includes(needle));
    }
    assets.sort((left, right) => {
      if (left.createdAt !== right.createdAt) return left.createdAt < right.createdAt ? 1 : -1;
      return left.assetId < right.assetId ? -1 : left.assetId > right.assetId ? 1 : 0;
    });
    const limit = p.limit === undefined ? MAX_LIST_LIMIT : p.limit;
    const offset = p.cursor === undefined ? 0 : Number(p.cursor);
    if (Number.isSafeInteger(offset) === false || offset < 0)
      mediaError("E_PARAMS", "Invalid asset cursor");
    const page = assets.slice(offset, offset + limit);
    const nextCursor = offset + limit < assets.length ? String(offset + limit) : null;
    return {
      projectId: p.projectId,
      assets: page.map(canonicalAsset),
      total: assets.length,
      nextCursor,
      indexRevision: index.indexRevision,
      recovered: index.recovered === true,
    };
  }

  async safeMediaDirectory(projectDir, create) {
    const directory = this.mediaDir(projectDir);
    if (create) await mkdir(directory, { recursive: true, mode: 0o700 });
    try {
      if (!(await lstat(directory)).isDirectory())
        mediaError("E_PATH", "Media directory must not be a symlink");
      const canonical = await realpath(directory);
      if (!inside(projectDir, canonical)) mediaError("E_PATH", "Media directory escapes project");
      return canonical;
    } catch (error) {
      if (!create && error.code === "ENOENT") return directory;
      throw error;
    }
  }

  async safeCacheDirectory(projectDir, create) {
    let directory = projectDir;
    for (const component of [".dsh-video", "media-cache"]) {
      directory = join(directory, component);
      if (create)
        await mkdir(directory, { mode: 0o700 }).catch((error) => {
          if (error.code !== "EEXIST") throw error;
        });
      try {
        if (
          !(await lstat(directory)).isDirectory() ||
          !inside(projectDir, await realpath(directory))
        )
          mediaError("E_PATH", "Cache must stay inside project directories");
      } catch (error) {
        if (!create && error.code === "ENOENT")
          return join(projectDir, ".dsh-video", "media-cache");
        throw error;
      }
    }
    return directory;
  }

  async references(projectDir, asset) {
    const references = [];
    for (const name of ["timeline.json", "project.json", "index.html"]) {
      const path = join(projectDir, name);
      try {
        const info = await lstat(path);
        if (!info.isFile() || info.size > MAX_INDEX_BYTES)
          mediaError("E_ASSET_REFERENCED", "Cannot safely inspect project references");
        const source = await readFile(path, "utf8");
        if (name === "timeline.json") {
          let timeline;
          try {
            timeline = JSON.parse(source);
          } catch {
            mediaError("E_ASSET_REFERENCED", "Timeline references cannot be inspected");
          }
          const visit = (value, owner) => {
            if (!value || typeof value !== "object") return;
            const id =
              typeof value.clipId === "string"
                ? value.clipId
                : typeof value.id === "string"
                  ? value.id
                  : owner;
            if (value.assetId === asset.assetId)
              references.push(String(id || "timeline.json").slice(0, 120));
            for (const child of Object.values(value)) visit(child, id);
          };
          if(timeline.timeline||timeline.schema==="dsh-video/timeline@1"){visit(timeline.timeline?.tracks||timeline.tracks,null);for(const entry of timeline.history||timeline._history||[]){visit(entry.before?.tracks,"undo history");visit(entry.after?.tracks,"undo history");}}else visit(timeline,null);
        } else if (
          source.includes(asset.assetId) ||
          source.includes("media/" + mediaFileName(asset))
        )
          references.push(name);
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
    }
    return references;
  }

  async resolveFile(p) {
    validateAssetRemove({ projectId: p.projectId, assetId: p.assetId });
    const directory = await this.projectDirectory(p.projectId);
    const index = await this.readIndex(directory);
    const asset = index.assets.find((a) => a.assetId === p.assetId);
    if (!asset) mediaError("E_ASSET_MISSING", "Asset is unavailable");
    let root = await this.safeMediaDirectory(directory, false);
    let path = join(root, mediaFileName(asset));
    if (p.kind !== undefined) {
      if (!["thumb", "waveform", "proxy"].includes(p.kind))
        mediaError("E_PARAMS", "Invalid derived kind");
      root = await this.safeCacheDirectory(directory, false);
      path = join(
        root,
        `${asset.assetId}-${asset.sha256}-${p.kind}.${p.kind === "proxy" ? (asset.kind === "audio" ? "m4a" : "mp4") : "png"}`,
      );
    }
    let canonical, info;
    try {
      canonical = await realpath(path);
      info = await lstat(path);
    } catch {
      mediaError("E_ASSET_MISSING", "Media file is unavailable");
    }
    if (!info.isFile() || !inside(directory, canonical) || !inside(root, canonical))
      mediaError("E_PATH", "Media file escapes project");
    return {
      path: canonical,
      size: info.size,
      mediaType:
        p.kind === "proxy"
          ? asset.kind === "audio"
            ? "audio/mp4"
            : "video/mp4"
          : p.kind
            ? "image/png"
            : mediaTypeForExt("." + asset.ext),
      asset,
    };
  }

  async derive(p) {
    if (!["thumb", "waveform", "proxy"].includes(p.kind))
      mediaError("E_PARAMS", "Invalid derived kind");
    const file = await this.resolveFile({ projectId: p.projectId, assetId: p.assetId });
    if (p.kind === "proxy" && file.asset.kind === "image")
      mediaError("E_PARAMS", "Images do not need a compatibility proxy");
    if (p.kind === "waveform" && file.asset.kind === "image")
      mediaError("E_PARAMS", "Images have no waveform");
    if (p.kind === "thumb" && file.asset.kind === "audio")
      mediaError("E_PARAMS", "Audio has no thumbnail");
    try {
      await this.resolveFile(p);
      return { ready: true, assetId: p.assetId, kind: p.kind };
    } catch (e) {
      if (e.code !== "E_ASSET_MISSING") throw e;
    }
    const projectDir = await this.projectDirectory(p.projectId);
    const cache = await this.safeCacheDirectory(projectDir, true);
    const suffix = p.kind === "proxy" ? (file.asset.kind === "audio" ? "m4a" : "mp4") : "png";
    const target = join(cache, `${p.assetId}-${file.asset.sha256}-${p.kind}.${suffix}`);
    const temporary = target + "." + randomBytes(6).toString("hex") + "." + suffix;
    const args = ["-v", "error", "-nostdin", "-y"];
    if (p.kind === "thumb" && file.asset.kind === "video")
      args.push("-ss", String(Math.min(1, (file.asset.media.durationSec || 1) / 3)));
    args.push("-i", file.path);
    if (p.kind === "proxy") {
      if (file.asset.kind === "audio") args.push("-vn", "-c:a", "aac", "-b:a", "128k");
      else
        args.push(
          "-vf",
          "scale=1280:720:force_original_aspect_ratio=decrease:force_divisible_by=2",
          "-r",
          "30",
          "-c:v",
          "libx264",
          "-preset",
          "veryfast",
          "-crf",
          "25",
          "-pix_fmt",
          "yuv420p",
          "-c:a",
          "aac",
        );
      args.push("-movflags", "+faststart");
    } else if (p.kind === "waveform")
      args.push("-filter_complex", "showwavespic=s=320x80:colors=0x8298bd", "-frames:v", "1");
    else args.push("-vf", "scale=320:180:force_original_aspect_ratio=decrease", "-frames:v", "1");
    args.push(temporary);
    try {
      await new Promise((yes, no) => {
        const child = spawn("ffmpeg", args, { stdio: "ignore" });
        const timer = setTimeout(
          () => {
            child.kill("SIGKILL");
          },
          p.kind === "proxy" ? 110000 : 30000,
        );
        child.once("error", () => {
          clearTimeout(timer);
          no(Object.assign(new Error("Media tools unavailable"), { code: "E_ASSET_DERIVE" }));
        });
        child.once("close", (code) => {
          clearTimeout(timer);
          code === 0
            ? yes()
            : no(Object.assign(new Error("Could not derive media"), { code: "E_ASSET_DERIVE" }));
        });
      });
      await rename(temporary, target);
      return { ready: true, assetId: p.assetId, kind: p.kind };
    } catch (error) {
      mediaError(
        "E_ASSET_DERIVE",
        "Could not generate derived media; retry or use a supported codec",
      );
    } finally {
      await rm(temporary, { force: true });
    }
  }

  async remove(p) {
    const projectDir = await this.projectDirectory(p.projectId);
    const signature = sha256(JSON.stringify({ projectId: p.projectId, assetId: p.assetId }));
    const cached = this.operationResult(p.projectId, p.operationId, signature);
    if (cached !== undefined) return cached;
    if (p.operationId !== undefined && this.operations.size >= 2048)
      mediaError("E_LIMIT", "Operation history full; restart worker", "operation");
    const index = await this.readIndex(projectDir);
    const asset = index.assets.find((entry) => entry.assetId === p.assetId);
    if (asset === undefined) {
      const result = {
        projectId: p.projectId,
        assetId: p.assetId,
        removed: false,
        indexRevision: index.indexRevision,
        asset: null,
      };
      return this.rememberOperation(p.projectId, p.operationId, signature, result);
    }
    const references = await this.references(projectDir, asset);
    if (references.length)
      mediaError("E_ASSET_REFERENCED", "Asset is referenced by: " + references.join(", "));
    const mediaDir = await this.safeMediaDirectory(projectDir, false);
    const target = resolve(mediaDir, mediaFileName(asset));
    if (inside(mediaDir, target) === false)
      mediaError("E_PATH", "Asset file escapes the media directory");
    const remaining = index.assets.filter((entry) => entry.assetId !== p.assetId);
    const tombstone = target + ".deleting";
    let moved = false;
    try {
      await rename(target, tombstone);
      moved = true;
    } catch (error) {
      if (error.code !== "ENOENT") mediaError("E_ASSET_REMOVE", "Could not delete media");
    }
    let revision;
    try {
      revision = await this.writeIndex(projectDir, remaining);
    } catch (error) {
      if (moved) await rename(tombstone, target);
      throw error;
    }
    if (moved) await rm(tombstone, { force: true });
    for (const kind of ["thumb", "waveform", "proxy"]) {
      const path = join(
        projectDir,
        ".dsh-video",
        "media-cache",
        `${asset.assetId}-${asset.sha256}-${kind}.${kind === "proxy" ? (asset.kind === "audio" ? "m4a" : "mp4") : "png"}`,
      );
      const canonical = await realpath(path).catch(() => null);
      if (canonical && inside(projectDir, canonical))
        await rm(path, { force: true }).catch(() => {});
    }
    const result = {
      projectId: p.projectId,
      assetId: p.assetId,
      removed: true,
      indexRevision: revision,
      asset,
    };
    return this.rememberOperation(p.projectId, p.operationId, signature, result);
  }
}
