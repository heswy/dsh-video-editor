// Preview snapshots are private, read-only copies of one exact project
// revision. They exist for the editor canvas (Host reads them through precise
// per-snapshot relative paths); they never enter the project revision, history
// or edit pipeline, and the worker is their only writer.
import { randomBytes } from "node:crypto";
import {
  mkdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import { fail } from "./errors.mjs";
import { inside, sha256 } from "./registry.mjs";

export const PREVIEW_DIR = "previews";
export const MIN_PREVIEW_TTL_MS = 100;
export const DEFAULT_PREVIEW_TTL_MS = 10 * 60 * 1000;
export const MAX_PREVIEW_TTL_MS = 30 * 60 * 1000;
// Previews copy exactly what read() already accepted: entry + declared assets
// (manifest upper bound 64 assets). The byte ceiling mirrors the project limit.
export const MAX_PREVIEW_FILES = 65;
export const MAX_PREVIEW_BYTES = 128 * 1024 * 1024;
const SNAPSHOT_ID = /^[a-f0-9]{32}$/;

export function validSnapshotId(value) {
  return typeof value === "string" && SNAPSHOT_ID.test(value);
}

// Path safety for copied files: project read() already restricts names, but the
// preview writer re-checks every relative path and rejects escapes/symlink
// targets before creating anything under the snapshot root.
function relativePath(name) {
  if (
    typeof name !== "string" ||
    !name ||
    name.length > 256 ||
    isAbsolute(name) ||
    name.includes("\\") ||
    name.includes(":") ||
    name.split("/").some((part) => !part || part === "." || part === "..")
  )
    fail("E_PATH", "Only declared relative project files can be snapshotted", "preview");
  return name;
}

export class Previews {
  constructor(config, diagnostic = () => {}) {
    this.config = config;
    this.diagnostic = diagnostic;
    this.root = resolve(config.outputRoot, PREVIEW_DIR);
    this.entries = new Map();
    this.initialized = false;
  }
  // A restarted worker cannot know whether a previous process left valid
  // snapshots behind, so it discards the whole private preview root first.
  // The directory is created lazily on the first snapshot: a worker that never
  // previews a project leaves outputRoot exactly as before (P2 behavior).
  async initialize() {
    await rm(this.root, { recursive: true, force: true });
    this.initialized = true;
  }
  async ensureInitialized() {
    if (!this.initialized) await this.initialize();
  }
  schedule(snapshot, ttlMs) {
    snapshot.timer = setTimeout(() => {
      void this.expire(snapshot.snapshotId);
    }, ttlMs);
    snapshot.timer.unref?.();
  }
  async expire(snapshotId) {
    const snapshot = this.entries.get(snapshotId);
    if (!snapshot) return;
    this.entries.delete(snapshotId);
    clearTimeout(snapshot.timer);
    try {
      await rm(snapshot.dir, { recursive: true, force: true });
    } catch {
      this.diagnostic("preview expiry cleanup failed");
    }
  }
  // Remove a snapshot that was created but cannot be published (for example
  // because the project revision changed during the copy). Best effort.
  discard(snapshotId) {
    return this.expire(snapshotId);
  }
  async create({ projectId, revision, entry, files, entries, ttlMs }) {
    await this.ensureInitialized();
    if (
      !Number.isInteger(ttlMs) ||
      ttlMs < MIN_PREVIEW_TTL_MS ||
      ttlMs > MAX_PREVIEW_TTL_MS
    )
      fail("E_PARAMS", "Invalid preview TTL", "preview");
    if (!Array.isArray(entries) || entries.length !== files.size)
      fail("E_PERSIST", "Snapshot manifest does not match project files", "preview");
    if (entries.length > MAX_PREVIEW_FILES)
      fail("E_LIMIT", "Preview snapshot has too many files", "preview");
    let total = 0;
    for (const declared of entries) total += declared.bytes;
    if (total > MAX_PREVIEW_BYTES)
      fail("E_LIMIT", "Preview snapshot exceeds 128 MiB", "preview");
    const snapshotId = randomBytes(16).toString("hex");
    const dir = resolve(this.root, snapshotId);
    if (!inside(this.root, dir))
      fail("E_PATH", "Snapshot directory escapes preview root", "preview");
    const expected = new Map(entries.map((declared) => [declared.path, declared]));
    try {
      await mkdir(this.root, { recursive: true });
      await mkdir(dir, { recursive: false });
      for (const [name, bytes] of files) {
        const target = resolve(dir, relativePath(name));
        if (!inside(dir, target))
          fail("E_PATH", "Snapshot file escapes snapshot root", "preview");
        await mkdir(dirname(target), { recursive: true });
        await writeFile(target, bytes);
      }
      // Re-read every copied file from disk and compare bytes/hash with the
      // manifest read() computed before the copy. A mismatch means the private
      // copy is not faithful and must not be published.
      const copied = [];
      for (const name of [...files.keys()].sort()) {
        const target = resolve(dir, relativePath(name));
        if (!inside(dir, target))
          fail("E_PATH", "Snapshot file escapes snapshot root", "preview");
        let info;
        try {
          info = await stat(target);
        } catch {
          fail("E_PERSIST", "Snapshot readback failed", "preview");
        }
        if (!info.isFile())
          fail("E_PERSIST", "Snapshot readback is not a regular file", "preview");
        const bytes = await readFile(target);
        const declared = expected.get(name);
        if (
          !declared ||
          bytes.length !== declared.bytes ||
          bytes.length !== info.size ||
          sha256(bytes) !== declared.sha256 ||
          !bytes.equals(files.get(name))
        )
          fail("E_PERSIST", "Snapshot manifest mismatch", "preview");
        copied.push({
          path: name,
          bytes: bytes.length,
          sha256: sha256(bytes),
        });
      }
      if (copied.length !== entries.length)
        fail("E_PERSIST", "Snapshot manifest is incomplete", "preview");
      const expiresAt = Date.now() + ttlMs;
      const snapshot = {
        snapshotId,
        projectId,
        revision,
        entry,
        files: copied,
        dir,
        expiresAt,
      };
      this.schedule(snapshot, ttlMs);
      this.entries.set(snapshotId, snapshot);
      return {
        snapshotId,
        projectId,
        revision,
        entry,
        files: copied,
        expiresAt: new Date(expiresAt).toISOString(),
        maxBytes: MAX_PREVIEW_BYTES,
      };
    } catch (error) {
      try {
        await rm(dir, { recursive: true, force: true });
      } catch {
        // The partial copy stays out of the snapshot table either way; a later
        // worker start discards the whole private preview root.
        this.diagnostic("preview copy cleanup failed");
      }
      throw error;
    }
  }
  async release(snapshotId) {
    const snapshot = this.entries.get(snapshotId);
    if (!snapshot)
      fail(
        "E_SNAPSHOT_NOT_FOUND",
        "Unknown or expired preview snapshot",
        "preview",
      );
    clearTimeout(snapshot.timer);
    try {
      await rm(snapshot.dir, { recursive: true, force: true });
    } catch {
      // Keep the snapshot tracked so a later release or the TTL sweep can
      // retry; nothing was half-deleted from the caller's point of view.
      this.schedule(
        snapshot,
        Math.max(snapshot.expiresAt - Date.now(), MIN_PREVIEW_TTL_MS),
      );
      fail("E_PERSIST", "Preview snapshot cleanup failed", "preview");
    }
    this.entries.delete(snapshotId);
    return {
      snapshotId,
      projectId: snapshot.projectId,
      revision: snapshot.revision,
      released: true,
    };
  }
  async releaseProject(projectId) {
    for (const [snapshotId, snapshot] of [...this.entries]) {
      if (snapshot.projectId === projectId) await this.expire(snapshotId);
    }
  }
  async releaseAll() {
    for (const snapshotId of [...this.entries.keys()]) await this.expire(snapshotId);
  }
  async shutdown() {
    await this.releaseAll();
  }
}
