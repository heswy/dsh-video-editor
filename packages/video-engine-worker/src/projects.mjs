import {
  realpath,
  readFile,
  mkdir,
  writeFile,
  rm,
  stat,
} from "node:fs/promises";
import { resolve, relative, isAbsolute, dirname } from "node:path";
import { createHash } from "node:crypto";
import { openComposition, buildDocument } from "@hyperframes/sdk";
import { createFsAdapter } from "@hyperframes/sdk/adapters/fs";
import { fail, keys, string, number, revision } from "./errors.mjs";
export const sha = (value) => createHash("sha256").update(value).digest("hex");
export function inside(root, path) {
  const r = relative(root, path);
  return r === "" || (!r.startsWith("..") && !isAbsolute(r));
}
function localName(p) {
  if (
    typeof p !== "string" ||
    !p ||
    p.length > 256 ||
    isAbsolute(p) ||
    p.includes("\\") ||
    p.split("/").some((s) => !s || s === "." || s === "..") ||
    p.includes(":")
  )
    fail(
      "E_PATH",
      "Only declared relative project files are supported",
      "project",
    );
  return p;
}
function capabilities(e) {
  const caps = [];
  if (
    ["h1", "h2", "h3", "h4", "p", "span", "div"].includes(e.tag) &&
    !e.children.length
  )
    caps.push("text");
  if (
    !e.attributes["data-composition-id"] &&
    e.start !== null &&
    Number(e.attributes["data-duration"]) > 0
  )
    caps.push("timing");
  return caps;
}
export class Projects {
  constructor(config) {
    this.config = config;
    this.handles = new Map();
    this.queues = new Map();
    this.operations = new Map();
  }
  queue(id, fn) {
    const next = (this.queues.get(id) || Promise.resolve()).then(fn);
    this.queues.set(
      id,
      next.catch(() => {}),
    );
    return next;
  }
  async open(id) {
    string(id);
    const registered = Object.hasOwn(this.config.projects, id)
      ? this.config.projects[id]
      : undefined;
    if (!registered)
      fail("E_PROJECT_NOT_FOUND", "Project is not registered", "open");
    let root, dir;
    try {
      root = await realpath(this.config.root);
      dir = await realpath(registered);
    } catch {
      fail("E_PROJECT_NOT_FOUND", "Registered project unavailable", "open");
    }
    if (!inside(root, dir))
      fail("E_PATH", "Project escapes registered root", "open");
    this.handles.set(id, dir);
    try {
      return await this.inspect(id);
    } catch (e) {
      this.handles.delete(id);
      throw e;
    }
  }
  async read(id) {
    const dir = this.handles.get(id);
    if (!dir) fail("E_PROJECT_NOT_OPEN", "Open project first", "project");
    let manifest;
    try {
      const p = await realpath(resolve(dir, "project.json"));
      if (!inside(dir, p))
        fail("E_PATH", "Manifest escapes project", "project");
      if ((await stat(p)).size > 16384)
        fail("E_PROJECT", "Manifest exceeds limit", "project");
      manifest = JSON.parse(await readFile(p, "utf8"));
    } catch (e) {
      if (e.code === "E_PATH") throw e;
      fail("E_PROJECT", "Invalid project manifest", "project");
    }
    keys(manifest, ["entry", "assets"], ["entry", "assets"]);
    if (manifest.entry !== "index.html")
      fail("E_PROJECT", "v1 requires index.html entry", "project");
    if (!Array.isArray(manifest.assets) || manifest.assets.length > 64)
      fail("E_PROJECT", "Invalid declared asset list", "project");
    const names = [
      localName(manifest.entry),
      ...manifest.assets.map(localName),
    ].sort();
    if (new Set(names).size !== names.length || names.includes("project.json"))
      fail("E_PROJECT", "Duplicate or reserved path", "project");
    const files = new Map();
    let total = 0;
    for (const name of names) {
      let p, bytes;
      try {
        p = await realpath(resolve(dir, name));
        if (!inside(dir, p))
          fail("E_PATH", "Declared file escapes project", "project");
        const s = await stat(p);
        if (!s.isFile() || s.size > 64 * 1024 * 1024)
          fail("E_LIMIT", "Project file exceeds limit", "project");
        total += s.size;
        if (total > 128 * 1024 * 1024)
          fail("E_LIMIT", "Project exceeds limit", "project");
        bytes = await readFile(p);
      } catch (e) {
        if (["E_PATH", "E_LIMIT"].includes(e.code)) throw e;
        fail("E_ASSET_MISSING", "Declared file unavailable", "project");
      }
      files.set(name, bytes);
    }
    const entries = [...files].map(([path, b]) => ({
      path,
      bytes: b.length,
      sha256: sha(b),
    }));
    return {
      dir,
      manifest,
      files,
      revision: sha(JSON.stringify({ entry: manifest.entry, files: entries })),
      entries,
    };
  }
  async inspect(id) {
    const p = await this.read(id);
    const comp = await openComposition(
      p.files.get(p.manifest.entry).toString(),
    );
    try {
      const elements = comp.getElements().map((e) => ({
        stableId: e.scopedId,
        text: e.text,
        timing: {
          start: e.start,
          duration:
            e.attributes["data-duration"] !== undefined
              ? Number(e.attributes["data-duration"])
              : e.duration,
        },
        capabilities: capabilities(e),
      }));
      const doc = buildDocument(comp.serialize());
      return {
        projectId: id,
        revision: p.revision,
        width: doc.width,
        height: doc.height,
        duration: doc.compositionDuration,
        elements,
        files: p.entries,
      };
    } finally {
      comp.dispose();
    }
  }
  async edit(id, p) {
    return this.queue(id, async () => {
      const signature = sha(
        JSON.stringify(p, (_key, value) =>
          value && typeof value === "object" && !Array.isArray(value)
            ? Object.fromEntries(
                Object.entries(value).sort(([a], [b]) => a.localeCompare(b)),
              )
            : value,
        ),
      );
      const opKey = id + "\0" + p.operationId;
      const previous = this.operations.get(opKey);
      if (previous) {
        if (previous.signature !== signature)
          fail(
            "E_OPERATION_REUSED",
            "operationId already has a different request",
            "edit",
          );
        return previous.result;
      }
      if (this.operations.size >= 2048)
        fail("E_LIMIT", "Operation history full; restart worker", "edit");
      const current = await this.read(id);
      if (current.revision !== p.expectedRevision)
        fail("E_REVISION_CONFLICT", "Project changed before edit", "edit");
      const comp = await openComposition(
        current.files.get(current.manifest.entry).toString(),
        {
          persist: createFsAdapter({ root: current.dir }),
          persistPath: current.manifest.entry,
        },
      );
      const errors = [];
      comp.on("persist:error", (e) => errors.push(e));
      try {
        const duration = buildDocument(comp.serialize()).compositionDuration;
        const timing = new Map();
        for (const op of p.ops) {
          const el = comp.getElement(op.target);
          if (!el || !capabilities(el).includes(op.type))
            fail(
              "E_UNSUPPORTED_EDIT",
              "Element does not support this edit",
              "edit",
            );
          if (op.type === "timing") {
            const current = timing.get(op.target) || {
              start: el.start,
              duration: Number(el.attributes["data-duration"]),
            };
            const next = {
              start: op.start ?? current.start,
              duration: op.duration ?? current.duration,
            };
            if (next.start + next.duration > duration)
              fail("E_PARAMS", "Timing extends beyond composition", "edit");
            timing.set(op.target, next);
          }
        }
        if ((await this.read(id)).revision !== current.revision)
          fail(
            "E_REVISION_CONFLICT",
            "Project changed before persistence",
            "edit",
          );
        comp.batch(() => {
          for (const op of p.ops) {
            if (op.type === "text") comp.setText(op.target, op.text);
            else
              comp.setTiming(op.target, {
                start: op.start,
                duration: op.duration,
              });
          }
        });
        await comp.flush();
        if (errors.length)
          fail("E_PERSIST", "SDK persistence failed", "persist");
        const saved = await this.read(id);
        if (
          saved.files.get(current.manifest.entry).toString() !==
          comp.serialize()
        )
          fail("E_PERSIST", "Persisted HTML failed readback", "persist");
        const result = {
          projectId: id,
          revision: saved.revision,
          operationId: p.operationId,
        };
        this.operations.set(opKey, { signature, result });
        return result;
      } finally {
        comp.dispose();
      }
    });
  }
  async snapshot(id, revision, destination) {
    return this.queue(id, async () => {
      const p = await this.read(id);
      if (p.revision !== revision)
        fail(
          "E_REVISION_CONFLICT",
          "Requested revision is no longer current",
          "snapshot",
        );
      if ((await this.read(id)).revision !== revision)
        fail(
          "E_REVISION_CONFLICT",
          "Files changed while snapshotting",
          "snapshot",
        );
      try {
        for (const [name, b] of p.files) {
          const path = resolve(destination, name);
          await mkdir(dirname(path), { recursive: true });
          await writeFile(path, b);
        }
        return {
          projectId: id,
          revision,
          entry: p.manifest.entry,
          files: p.entries,
        };
      } catch {
        await rm(destination, { recursive: true, force: true });
        fail("E_SNAPSHOT", "Could not create private snapshot", "snapshot");
      }
    });
  }
}
export function validateEdit(p) {
  keys(
    p,
    ["projectId", "expectedRevision", "operationId", "ops"],
    ["projectId", "expectedRevision", "operationId", "ops"],
  );
  string(p.projectId);
  revision(p.expectedRevision);
  string(p.operationId);
  if (!Array.isArray(p.ops) || !p.ops.length || p.ops.length > 32)
    fail("E_PARAMS", "Expected 1–32 typed ops");
  for (const op of p.ops) {
    if (op?.type === "text") {
      keys(op, ["type", "target", "text"], ["type", "target", "text"]);
      if (typeof op.text !== "string" || op.text.length > 2048)
        fail("E_PARAMS", "Invalid text");
    } else if (op?.type === "timing") {
      keys(op, ["type", "target", "start", "duration"], ["type", "target"]);
      if (op.start === undefined && op.duration === undefined)
        fail("E_PARAMS", "Timing change missing");
      if (op.start !== undefined) number(op.start, 0, 3600);
      if (op.duration !== undefined) number(op.duration, 1 / 240, 3600);
    } else fail("E_PARAMS", "Unsupported edit type");
    string(op.target, 256);
  }
}
