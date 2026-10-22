import { linkMedia } from "./timeline.mjs";
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
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { openComposition, buildDocument } from "@hyperframes/sdk";
import { createFsAdapter } from "@hyperframes/sdk/adapters/fs";
import { fail, keys, string, number, revision, WorkerError } from "./errors.mjs";
import {
  MAX_COMPOSITION_BYTES,
  MAX_COMPOSITION_ESCAPED_BYTES,
  validateComposition,
} from "./composition.mjs";
import {
  DEFAULT_FPS,
  DEFAULT_HEIGHT,
  DEFAULT_WIDTH,
  TEMPLATE_ID,
  buildDocumentHtml,
  defaultScene,
  parseDocument,
  sceneSummaries,
  templateId as validTemplateId,
  sceneId as validSceneId,
  validateDocumentHtml,
  validateSceneSpec,
} from "./scenes.mjs";
import {
  atomicWrite,
  addProjectToRegistry,
  generateProjectId,
  importAsset as importAssetFile,
  inside as registryInside,
  readRegistryFile,
  withProjectLock,
} from "./registry.mjs";
import {
  ensureHistory,
  listHistory,
  loadSnapshot,
  recordOp,
  recordWrite,
  redo as historyRedo,
  undo as historyUndo,
} from "./history.mjs";
import { mergeSceneDocuments } from "./merge.mjs";
import { DEFAULT_PREVIEW_TTL_MS, Previews } from "./previews.mjs";
import {
  LAYOUT_PROPS,
  OVERRIDE_ATTRIBUTE,
  STYLE_PROPS,
  collectManualOverrides,
  formatOverrideAttribute,
  formatNumber,
  layoutToSdkStyles,
  managedValues,
  mergedLayout,
  overrideSummary,
  parseOverrideAttribute,
  styleToSdkStyles,
  templateElementInfo,
  validateLayoutBounds,
  validateLayoutPatch,
  validateStylePatch,
} from "./layout.mjs";

const packageRoot = fileURLToPath(new URL("../", import.meta.url));
// The internal preview-pipeline proof copy of a freshly published revision is
// discarded in the same request, so a short TTL is enough.
const COMPOSE_PREVIEW_TTL_MS = 60 * 1000;
// Stable bounded code for a degraded (post-commit) history write. The concrete
// failure detail stays in the bounded worker diagnostic, never in the result.
const HISTORY_DEGRADED_CODE = "E_HISTORY";
/**
 * P3-016: the optional human-readable project title stored in `project.json`.
 * It is UI metadata only: revision stays the content hash of the declared
 * entry/assets, and renaming never touches the composition or history.
 */
const PROJECT_TITLE_MAX = 120;
export const PROJECT_TITLE_LENGTH = PROJECT_TITLE_MAX;
export const sha = (value) => createHash("sha256").update(value).digest("hex");
/** Trimmed 1..120 title, or E_PARAMS; shared by create and rename. */
export function normalizeProjectTitle(value) {
  if (typeof value !== "string")
    fail("E_PARAMS", "Invalid project title");
  const title = value.trim();
  if (title.length < 1 || title.length > PROJECT_TITLE_MAX)
    fail("E_PARAMS", "Invalid project title");
  return title;
}
const formatSeconds = (value) => String(Number(Number(value).toFixed(3)));
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
function managedInfo(element) {
  return templateElementInfo({
    stableId: element.stableId,
    tag: element.tag,
    parentId: element.parentId,
    sceneId: element.sceneId,
  });
}

/** Managed layout/style + merged capability list for a parsed template leaf. */
function managedView(element) {
  const info = managedInfo(element);
  const managed = managedValues(element.inlineStyles, info);
  return { info, layout: managed.layout, style: managed.style };
}

function withManagedCapabilities(baseCapabilities, info) {
  if (!info) return baseCapabilities;
  const capabilities = [...baseCapabilities];
  for (const capability of info.capabilities)
    if (!capabilities.includes(capability)) capabilities.push(capability);
  return capabilities;
}

/** The same document regenerated from its parsed scene model (template defaults). */
function templateDefaultParsed(parsed) {
  return parseDocument(
    buildDocumentHtml({
      width: parsed.width,
      height: parsed.height,
      scenes: parsed.scenes,
    }),
  );
}

/**
 * Apply manual managed overrides to a freshly generated document by using the
 * SDK's typed setStyle. Returns the new HTML plus the overrides that could not
 * be transplanted (element dropped or lost layout/style capability).
 */
async function transplantManagedOverrides({ currentParsed, nextHtml }) {
  const overrides = collectManualOverrides(
    currentParsed,
    templateDefaultParsed(currentParsed),
  );
  if (!overrides.size) return { html: nextHtml, applied: 0, dropped: [] };
  const nextParsed = parseDocument(nextHtml);
  const nextById = new Map(nextParsed.elements.map((element) => [element.stableId, element]));
  const updates = new Map();
  const dropped = [];
  for (const [stableId, entry] of overrides) {
    const nextElement = nextById.get(stableId);
    const nextInfo = nextElement ? managedInfo(nextElement) : null;
    const layout =
      nextInfo?.layout && Object.keys(entry.layout).length
        ? layoutToSdkStyles(entry.layout)
        : {};
    const style =
      nextInfo?.style && Object.keys(entry.style).length
        ? styleToSdkStyles(entry.style)
        : {};
    const styles = { ...layout, ...style };
    if (!Object.keys(styles).length) {
      dropped.push({
        stableId,
        sceneId: entry.info.sceneId,
        layout: Object.keys(entry.layout),
        style: Object.keys(entry.style),
      });
      continue;
    }
    const marker = formatOverrideAttribute([
      ...(nextInfo?.layout ? Object.keys(entry.layout) : []),
      ...(nextInfo?.style ? Object.keys(entry.style) : []),
    ]);
    updates.set(stableId, { styles, marker });
  }
  if (!updates.size) return { html: nextHtml, applied: 0, dropped };
  const comp = await openComposition(nextHtml);
  try {
    comp.batch(() => {
      for (const [stableId, update] of updates) {
        comp.setStyle(stableId, update.styles);
        if (update.marker)
          comp.setAttribute(stableId, OVERRIDE_ATTRIBUTE, update.marker);
      }
    });
    const html = comp.serialize();
    return { html, applied: updates.size, dropped };
  } finally {
    comp.dispose();
  }
}

function overrideConflict(entry, reason = "AI_DELETE_HUMAN_MODIFY") {
  return {
    sceneId: entry.sceneId,
    stableId: entry.stableId,
    reason,
    field: entry.layout.length
      ? `layout.${entry.layout.join("|")}`
      : `style.${entry.style.join("|")}`,
    human: { present: true, layout: entry.layout, style: entry.style },
    ai: { present: false },
    hint: "AI/scene rewrite would drop human layout/style overrides",
  };
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
  constructor(config, { diagnostic = () => {} } = {}) {
    this.config = config;
    this.handles = new Map();
    this.queues = new Map();
    this.operations = new Map();
    this.lifecycle = new Map();
    this.diagnostic = diagnostic;
    this.previews = new Previews(config, diagnostic);
  }
  async initialize() {
    await this.previews.initialize();
  }
  async shutdown() {
    await this.previews.shutdown();
  }
  queue(id, fn) {
    const next = (this.queues.get(id) || Promise.resolve()).then(fn);
    this.queues.set(
      id,
      next.catch(() => {}),
    );
    return next;
  }
  assertNotClosing(id) {
    if (this.lifecycle.get(id) === "closing")
      fail("E_PROJECT_CLOSING", "Project is closing", "lifecycle");
  }
  assertActive(id) {
    this.assertNotClosing(id);
    if (!this.handles.has(id))
      fail("E_PROJECT_NOT_OPEN", "Open project first", "project");
  }
  requestOpen(id) {
    this.assertNotClosing(id);
    return this.queue(id, () => this.open(id));
  }
  requestInspect(id) {
    this.assertActive(id);
    return this.queue(id, () => this.inspect(id));
  }
  /**
   * P3-016 UI-only rename: atomically update the optional `project.json` title.
   * The declared entry/assets are preserved, so the content revision and the
   * composition history do not change. queued like inspect/edit so a rename can
   * never interleave with a manifest rewrite.
   */
  async rename(p) {
    this.assertActive(p.projectId);
    return this.queue(p.projectId, async () => {
      const current = await this.read(p.projectId);
      const title = normalizeProjectTitle(p.title);
      if (current.title === title)
        return {
          projectId: p.projectId,
          revision: current.revision,
          title,
          changed: false,
        };
      const physicalManifest = JSON.parse(await readFile(resolve(current.dir, "project.json"), "utf8"));
      const next = { ...physicalManifest, assets: current.timeline ? physicalManifest.assets.filter(name => current.timeline.legacyAssets.some(a => a.path === name)) : physicalManifest.assets, title };
      await atomicWrite(
        resolve(current.dir, "project.json"),
        JSON.stringify(next, null, 2) + "\n",
      );
      return {
        projectId: p.projectId,
        revision: current.revision,
        title,
        changed: true,
      };
    });
  }
  beginClose(id) {
    this.lifecycle.set(id, "closing");
  }
  async completeClose(id) {
    this.handles.delete(id);
    this.lifecycle.set(id, "closed");
    // Preview snapshots are private copies of an open project's revision. A
    // successful close means no lifecycle directory for that project is left
    // behind, so drop them before reporting the close as complete.
    await this.previews.releaseProject(id);
  }
  async open(id) {
    string(id);
    this.assertNotClosing(id);
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
    this.assertNotClosing(id);
    this.handles.set(id, dir);
    this.lifecycle.set(id, "open");
    try {
      const result = await this.inspect(id);
      this.assertNotClosing(id);
      return result;
    } catch (e) {
      this.handles.delete(id);
      if (this.lifecycle.get(id) !== "closing")
        this.lifecycle.set(id, "closed");
      throw e;
    }
  }
  async read(id) {
    if(this.timelines){const result=await this.timelines.read(id);if(result)return result;}
    return this.readLegacy(id);
  }
  async readLegacy(id, {ignoreEntry=false, assetNames}={}) {
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
    keys(manifest, ["entry", "assets", "title"], ["entry", "assets"]);
    if (manifest.entry !== "index.html")
      fail("E_PROJECT", "v1 requires index.html entry", "project");
    // The title is optional (legacy projects) but must be a usable 1..120
    // string when present; a malformed one is a manifest error, not a reason
    // to guess at a display name.
    let title = null;
    if (Object.hasOwn(manifest, "title")) {
      if (
        typeof manifest.title !== "string" ||
        manifest.title !== manifest.title.trim() ||
        manifest.title.length < 1 ||
        manifest.title.length > PROJECT_TITLE_MAX
      )
        fail("E_PROJECT", "Invalid project title", "project");
      title = manifest.title;
    }
    if (!Array.isArray(manifest.assets) || manifest.assets.length > 64)
      fail("E_PROJECT", "Invalid declared asset list", "project");
    const names = [
      ...(ignoreEntry?[]:[localName(manifest.entry)]),
      ...(assetNames ?? manifest.assets).map(localName),
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
      title,
      revision: sha(JSON.stringify({ entry: manifest.entry, files: entries })),
      entries,
    };
  }
  async inspect(id) {
    this.assertActive(id);
    const p = await this.read(id);
    if(p.timeline)return {projectId:id,revision:p.revision,title:p.title,width:p.timeline.settings.width,height:p.timeline.settings.height,duration:p.timeline.settings.durationFrames/30,elements:[],scenes:[],files:p.entries.slice(0,50),...(p.entries.length>50?{fileCount:p.entries.length,filesTruncated:true}:{}),timeline:true};
    const comp = await openComposition(
      p.files.get(p.manifest.entry).toString(),
    );
    try {
      const sourceHtml = p.files.get(p.manifest.entry).toString();
      // Multi-scene template documents expose scenes[]; legacy single
      // composition fixtures keep their previous inspect shape.
      let parsed = null;
      try {
        parsed = parseDocument(sourceHtml);
      } catch (error) {
        if (error.code !== "E_TEMPLATE") throw error;
      }
      const parsedByStableId = new Map(
        (parsed?.elements ?? []).map((element) => [element.stableId, element]),
      );
      const elements = comp.getElements().map((e) => {
        const parsedElement = parsedByStableId.get(e.scopedId);
        const managed = parsedElement ? managedView(parsedElement) : null;
        return {
          stableId: e.scopedId,
          sceneId: parsedElement?.sceneId ?? null,
          text: e.text,
          timing: {
            start: e.start,
            duration:
              e.attributes["data-duration"] !== undefined
                ? Number(e.attributes["data-duration"])
                : e.duration,
          },
          layout: managed?.layout ?? null,
          style: managed?.style ?? null,
          capabilities: withManagedCapabilities(capabilities(e), managed?.info),
        };
      });
      const doc = buildDocument(comp.serialize());
      const scenes = parsed ? sceneSummaries(parsed) : [];
      for (const scene of scenes) {
        scene.elements = parsed.elements
          .filter((element) => element.sceneId === scene.sceneId)
          .map((element) => {
            const managed = managedView(element);
            return {
              stableId: element.stableId,
              sceneId: scene.sceneId,
              tag: element.tag,
              text: element.text,
              timing: element.timing,
              layout: managed.layout,
              style: managed.style,
              capabilities: withManagedCapabilities(
                element.capabilities,
                managed.info,
              ),
            };
          });
      }
      return {
        projectId: id,
        revision: p.revision,
        title: p.title,
        width: doc.width,
        height: doc.height,
        duration: doc.compositionDuration,
        elements,
        scenes,
        files: p.entries,
      };
    } finally {
      comp.dispose();
    }
  }
  async edit(id, p) {
    if(await this.timelines?.load(id))fail("E_TIMELINE_MODE","Use timeline.apply or scene.compose for this project","timeline");
    this.assertActive(id);
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
      const html = current.files.get(current.manifest.entry).toString();
      const layoutStyleOps = p.ops.filter(
        (op) => op.type === "layout" || op.type === "style",
      );
      let parsed = null;
      let parsedById = null;
      if (layoutStyleOps.length) {
        try {
          parsed = parseDocument(html);
        } catch {
          fail(
            "E_UNSUPPORTED_EDIT",
            "layout/style edits require the controlled template",
            "edit",
          );
        }
        parsedById = new Map(
          parsed.elements.map((element) => [element.stableId, element]),
        );
      } else if (p.ops.some((op) => op.type === "text")) {
        // Text edits on controlled Scene leaves must not break the
        // scene.template read contract (e.g. an empty required Scene title).
        // Legacy compositions keep their previous behaviour.
        try {
          parsed = parseDocument(html);
          parsedById = new Map(
            parsed.elements.map((element) => [element.stableId, element]),
          );
        } catch {
          parsed = null;
          parsedById = null;
        }
      }
      const comp = await openComposition(html, {
        persist: createFsAdapter({ root: current.dir }),
        persistPath: current.manifest.entry,
      });
      const errors = [];
      comp.on("persist:error", (e) => errors.push(e));
      try {
        const duration = buildDocument(comp.serialize()).compositionDuration;
        const timing = new Map();
        const layoutPatches = new Map();
        const stylePatches = new Map();
        const markerPatches = new Map();
        const counts = { text: 0, timing: 0, layout: 0, style: 0 };
        for (const op of p.ops) {
          const el = comp.getElement(op.target);
          if (!el)
            fail(
              "E_UNSUPPORTED_EDIT",
              "Target element does not exist",
              "edit",
            );
          if (op.type === "text" || op.type === "timing") {
            if (!capabilities(el).includes(op.type))
              fail(
                "E_UNSUPPORTED_EDIT",
                "Element does not support this edit",
                "edit",
              );
            if (op.type === "timing") {
              const currentTiming = timing.get(op.target) || {
                start: el.start,
                duration: Number(el.attributes["data-duration"]),
              };
              const next = {
                start: op.start ?? currentTiming.start,
                duration: op.duration ?? currentTiming.duration,
              };
              if (next.start + next.duration > duration)
                fail("E_PARAMS", "Timing extends beyond composition", "edit");
              timing.set(op.target, next);
            } else {
              // A Scene title is a required template field; allowing an empty
              // edit would make the read projection invalid scene.update input.
              const textElement = parsedById?.get(op.target);
              const textInfo = textElement ? managedInfo(textElement) : null;
              if (textInfo?.suffix === "title" && op.text.trim().length === 0)
                fail("E_PARAMS", "Scene title cannot be empty", "edit");
            }
            counts[op.type] += 1;
            continue;
          }
          const parsedElement = parsed?.elements
            ? parsedById.get(op.target)
            : undefined;
          const info = parsedElement ? managedInfo(parsedElement) : null;
          if (!info || !(op.type === "layout" ? info.layout : info.style))
            fail(
              "E_UNSUPPORTED_EDIT",
              "Element does not support this layout/style edit",
              "edit",
            );
          if (op.type === "layout") {
            if (op.unit !== "composition-px")
              fail("E_PARAMS", "layout.unit must be composition-px");
            const patch = validateLayoutPatch(op.box);
            const previous = layoutPatches.get(op.target) ?? {};
            const currentManaged = managedValues(
              parsedElement.inlineStyles,
              info,
            );
            const effective = mergedLayout(
              { ...(currentManaged.layout ?? {}), ...previous },
              patch,
            );
            validateLayoutBounds(effective, {
              width: parsed.width,
              height: parsed.height,
            });
            layoutPatches.set(op.target, { ...previous, ...patch });
            const marker =
              markerPatches.get(op.target) ??
              parseOverrideAttribute(
                parsedElement.attributes?.[OVERRIDE_ATTRIBUTE],
              ) ??
              new Set();
            for (const key of Object.keys(patch)) marker.add(key);
            markerPatches.set(op.target, marker);
            counts.layout += 1;
          } else {
            const patch = validateStylePatch(op.styles);
            stylePatches.set(op.target, {
              ...(stylePatches.get(op.target) ?? {}),
              ...patch,
            });
            const marker =
              markerPatches.get(op.target) ??
              parseOverrideAttribute(
                parsedElement.attributes?.[OVERRIDE_ATTRIBUTE],
              ) ??
              new Set();
            for (const key of Object.keys(patch)) marker.add(key);
            markerPatches.set(op.target, marker);
            counts.style += 1;
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
            else if (op.type === "timing")
              comp.setTiming(op.target, {
                start: op.start,
                duration: op.duration,
              });
          }
          for (const [target, patch] of layoutPatches)
            comp.setStyle(target, layoutToSdkStyles(patch));
          for (const [target, patch] of stylePatches)
            comp.setStyle(target, styleToSdkStyles(patch));
          for (const [target, marker] of markerPatches)
            comp.setAttribute(
              target,
              OVERRIDE_ATTRIBUTE,
              formatOverrideAttribute(marker),
            );
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
        const dir = this.handles.get(id);
        await recordWrite(dir, {
          before: { revision: current.revision, html },
          after: { revision: saved.revision, html: saved.files.get(saved.manifest.entry).toString() },
          actor: "human",
          kind: "edit",
          summary: `typed edit (${p.ops.length} ops: text ${counts.text}, timing ${counts.timing}, layout ${counts.layout}, style ${counts.style})`,
          operationId: p.operationId,
        });
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
  // ─── P3-012: complete composition publish/read (conversation-first) ─────
  // One validated HTML document is the whole content model of a free-form
  // project: `compose` replaces it atomically (creation and every later edit),
  // `source` reads it back byte-exactly for the next modification.
  async compose(id, p) {
    if(await this.timelines?.load(id))fail("E_TIMELINE_MODE","Use timeline.apply or scene.compose for this project","timeline");
    this.assertActive(id);
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
      const cached = this.operationResult(id, p.operationId, signature);
      if (cached) return cached;
      // Same guard as `edit`: fail before publishing when a successful result
      // could no longer be remembered in the bounded idempotency table.
      if (this.operations.size >= 2048)
        fail("E_LIMIT", "Operation history full; restart worker", "compose");
      const current = await this.read(id);
      if (current.revision !== p.expectedRevision)
        fail("E_REVISION_CONFLICT", "Project changed before compose", "compose");
      const entry = current.manifest.entry;
      const previousHtml = current.files.get(entry).toString();
      const validated = await validateComposition({
        html: p.html,
        assets: current.manifest.assets,
      });
      if (p.html === previousHtml) {
        // Byte-identical to the published entry: no write, same revision. The
        // snapshot proof still runs once so `preview.status: "ready"` stays
        // truthful for this exact revision; nothing is ever rolled back.
        try {
          await this.previewProof({
            projectId: id,
            revision: current.revision,
            manifest: current.manifest,
            files: current.files,
            entries: current.entries,
          });
        } catch {
          fail(
            "E_PERSIST",
            "Preview snapshot proof failed for the unchanged composition",
            "persist",
          );
        }
        const unchangedResult = {
          projectId: id,
          revision: current.revision,
          publishedRevision: current.revision,
          written: false,
          unchanged: true,
          scenes: [],
          entry,
          width: validated.width,
          height: validated.height,
          duration: validated.duration,
          bytes: validated.bytes,
          assets: [...current.manifest.assets],
          elements: validated.elements,
          files: current.entries,
          preview: {
            mode: "snapshot",
            status: "ready",
            checked: "composition+snapshot",
            revision: current.revision,
          },
          history: { status: "unchanged" },
        };
        return this.rememberOperation(
          id,
          p.operationId,
          signature,
          unchangedResult,
        );
      }
      const dir = this.handles.get(id);
      let after;
      try {
        await atomicWrite(resolve(dir, entry), p.html);
        after = await this.read(id);
        if (after.files.get(after.manifest.entry)?.toString() !== p.html)
          throw new Error("published composition readback mismatch");
      } catch {
        const restored = await this.restoreEntry(dir, entry, previousHtml);
        if (!restored)
          fail(
            "E_PERSIST",
            "Publishing the composition failed and the previous composition could not be restored",
            "persist",
            { uncertain: true },
          );
        fail(
          "E_PERSIST",
          "Publishing the composition failed; the previous composition was restored",
          "persist",
        );
      }
      try {
        // Proof that the new revision is servable through the existing private
        // snapshot route (not that a browser plays it).
        await this.previewProof({
          projectId: id,
          revision: after.revision,
          manifest: after.manifest,
          files: after.files,
          entries: after.entries,
        });
      } catch {
        const restored = await this.restoreEntry(dir, entry, previousHtml);
        if (!restored)
          fail(
            "E_PERSIST",
            "Preview snapshot proof failed and the previous composition could not be restored",
            "persist",
            { uncertain: true },
          );
        fail(
          "E_PERSIST",
          "Preview snapshot proof failed; the previous composition was restored",
          "persist",
        );
      }
      // ── Settlement ───────────────────────────────────────────────────────
      // The authoritative commit point is entry atomic write + exact readback
      // + preview-snapshot proof, all completed above. History is auxiliary: a
      // history-stage failure must not report the published revision as an
      // ordinary failure, so it is returned as a bounded degraded-success
      // marker (detail only in the injected diagnostic). The idempotency cache
      // stores that same settled result; a retry returns it unchanged.
      let history;
      try {
        const recorded = await this.recordComposeHistory(dir, {
          before: { revision: current.revision, html: previousHtml },
          after: { revision: after.revision, html: p.html },
          operationId: p.operationId,
          summary: `AI composition (${validated.bytes} bytes, ${formatSeconds(validated.duration)}s)`,
        });
        history = { status: "recorded", historyCursor: recorded.historyCursor };
      } catch {
        this.diagnostic("compose history degraded");
        history = { status: "degraded", code: HISTORY_DEGRADED_CODE };
      }
      const result = {
        projectId: id,
        revision: after.revision,
        publishedRevision: after.revision,
        written: true,
        unchanged: false,
        scenes: [],
        entry: after.manifest.entry,
        width: validated.width,
        height: validated.height,
        duration: validated.duration,
        bytes: validated.bytes,
        assets: [...after.manifest.assets],
        elements: validated.elements,
        files: after.entries,
        preview: {
          mode: "snapshot",
          status: "ready",
          checked: "composition+snapshot",
          revision: after.revision,
        },
        history,
      };
      return this.rememberOperation(id, p.operationId, signature, result);
    });
  }
  /**
   * Persist the history entry for one successfully published composition.
   * Extracted as an instance method so tests can override it to simulate any
   * history-stage failure (read, snapshot write, entries write, ops append,
   * state write) without production fault injection.
   */
  async recordComposeHistory(dir, { before, after, operationId, summary }) {
    return recordWrite(dir, {
      before,
      after,
      actor: "ai",
      kind: "project.compose",
      summary,
      operationId,
    });
  }
  async source(id) {
    if(await this.timelines?.load(id))fail("E_TIMELINE_MODE","Use timeline.inspect and scene.inspect for this project","timeline");
    this.assertActive(id);
    return this.queue(id, async () => {
      const current = await this.read(id);
      const entry = current.manifest.entry;
      const bytes = current.files.get(entry).length;
      if (bytes > MAX_COMPOSITION_BYTES)
        fail(
          "E_LIMIT",
          `project.source is limited to ${MAX_COMPOSITION_BYTES} UTF-8 bytes (48 KiB) so one Tool result stays bounded; this composition is ${bytes} bytes.`,
          "compose",
        );
      const html = current.files.get(entry).toString("utf8");
      // The html travels as one JSON string in the protocol response; bound the
      // escaped form so the source result can never exceed the 64 KiB budget.
      const escapedBytes = Buffer.byteLength(JSON.stringify(html), "utf8");
      if (escapedBytes > MAX_COMPOSITION_ESCAPED_BYTES)
        fail(
          "E_LIMIT",
          `project.source is limited to ${MAX_COMPOSITION_ESCAPED_BYTES} JSON-escaped bytes so one Tool result stays under 64 KiB; this composition is ${bytes} UTF-8 bytes / ${escapedBytes} escaped bytes. Reduce quotes/backslashes or size.`,
          "compose",
        );
      return {
        projectId: id,
        revision: current.revision,
        entry,
        bytes,
        assets: [...current.manifest.assets],
        html,
      };
    });
  }
  /**
   * Create and immediately discard a private preview snapshot of one revision.
   * It proves the revision is servable through the existing snapshot route; it
   * does not prove a browser can play it.
   */
  async previewProof({ projectId, revision, manifest, files, entries }) {
    let snapshot;
    try {
      snapshot = await this.previews.create({
        projectId,
        revision,
        entry: manifest.entry,
        files,
        entries,
        ttlMs: COMPOSE_PREVIEW_TTL_MS,
      });
      if (
        !Array.isArray(snapshot.files) ||
        !snapshot.files.some((file) => file.path === manifest.entry)
      )
        fail(
          "E_PERSIST",
          "Preview snapshot is missing the composition entry",
          "persist",
        );
    } catch (error) {
      if (snapshot?.snapshotId)
        await this.previews.discard(snapshot.snapshotId);
      if (error instanceof WorkerError && error.code === "E_PERSIST") throw error;
      fail("E_PERSIST", "Preview snapshot proof failed", "persist");
    }
    await this.previews.discard(snapshot.snapshotId);
    return snapshot;
  }
  async restoreEntry(dir, entry, html) {
    try {
      await atomicWrite(resolve(dir, entry), html);
      return true;
    } catch {
      this.diagnostic("compose rollback failed");
      return false;
    }
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
        await linkMedia(p.mediaRefs,destination);
        return {
          projectId: id,
          revision,
          entry: p.manifest.entry,
          files: p.entries,
          timeline: p.timeline,
        };
      } catch {
        await rm(destination, { recursive: true, force: true });
        fail("E_SNAPSHOT", "Could not create private snapshot", "snapshot");
      }
    });
  }

  // ─── P3-004: read-only preview snapshots (editor canvas backend) ────────
  // A preview snapshot is a private copy of exactly one open project revision.
  // It is not a revision, is not editable through this worker, and is only
  // addressed by its unpredictable snapshotId (relative file paths only).
  previewSnapshot(p) {
    this.assertActive(p.projectId);
    return this.queue(p.projectId, async () => {
      const current = await this.read(p.projectId);
      if (current.revision !== p.revision)
        fail(
          "E_REVISION_CONFLICT",
          "Requested revision is no longer current",
          "preview",
        );
      const snapshot = await this.previews.create({
        projectId: p.projectId,
        revision: current.revision,
        entry: current.manifest.entry,
        files: current.files,
        entries: current.entries,
        ttlMs: p.ttlMs ?? DEFAULT_PREVIEW_TTL_MS,
      });
      if(current.mediaRefs?.length){await linkMedia(current.mediaRefs,this.previews.entries.get(snapshot.snapshotId).dir);
        for(const ref of current.mediaRefs){const {source,...entry}=ref;snapshot.files.push(entry);}
      }
      const after = await this.read(p.projectId);
      if (after.revision !== current.revision) {
        await this.previews.discard(snapshot.snapshotId);
        fail(
          "E_REVISION_CONFLICT",
          "Project changed while snapshotting",
          "preview",
        );
      }
      return snapshot.files.length>100?{...snapshot,files:snapshot.files.slice(0,100),fileCount:snapshot.files.length,nextOffset:100}:snapshot;
    });
  }
  previewRelease(p) {
    return this.previews.release(p.snapshotId);
  }

  // ─── P3-003: managed projects, scenes, assets, merge, history ───────────
  operationKey(projectId, operationId) {
    return projectId + "\0" + operationId;
  }
  operationResult(projectId, operationId, signature) {
    const previous = this.operations.get(this.operationKey(projectId, operationId));
    if (!previous) return undefined;
    if (previous.signature !== signature)
      fail("E_OPERATION_REUSED", "operationId already has a different request", "operation");
    return previous.result;
  }
  rememberOperation(projectId, operationId, signature, result) {
    if (this.operations.size >= 2048)
      fail("E_LIMIT", "Operation history full; restart worker", "operation");
    this.operations.set(this.operationKey(projectId, operationId), {
      signature,
      result,
    });
    return result;
  }
  async declaredFiles(dir, manifest) {
    const files = new Map();
    for (const name of [manifest.entry, ...manifest.assets])
      files.set(name, await readFile(resolve(dir, name)));
    return files;
  }
  async createProject(p) {
    if (!this.config.managed)
      fail(
        "E_CONFIGURATION",
        "Worker is not configured with projectsRoot; project.create is unavailable",
        "create",
      );
    return withProjectLock(`create:${this.config.registryPath}`, async () => {
      const projectId = generateProjectId();
      const dir = resolve(this.config.root, projectId);
      if (!registryInside(this.config.root, dir))
        fail("E_PATH", "Project id escapes projectsRoot", "create");
      const width = p.width ?? DEFAULT_WIDTH;
      const height = p.height ?? DEFAULT_HEIGHT;
      // P3-016: the create `title` doubles as the stored project title and the
      // first Scene title. It is trimmed once here; the manifest keeps the
      // project title separately so a later rename never rewrites content.
      const projectTitle = p.title === undefined ? null : normalizeProjectTitle(p.title);
      const scenes = [
        defaultScene(0, {
          title: projectTitle ?? "开场",
        }),
      ];
      const html = buildDocumentHtml({ width, height, scenes });
      validateDocumentHtml(html, {
        expectedScenes: scenes.map((scene) => scene.sceneId),
      });
      await mkdir(dir, { recursive: false });
      try {
        await mkdir(resolve(dir, "assets"), { recursive: true });
        const gsap = readFileSync(
          resolve(packageRoot, "node_modules/gsap/dist/gsap.min.js"),
        );
        await writeFile(resolve(dir, "assets/gsap.min.js"), gsap);
        let manifest = {
          entry: "index.html",
          assets: ["assets/gsap.min.js"],
          ...(projectTitle === null ? {} : { title: projectTitle }),
        };
        await writeFile(
          resolve(dir, "project.json"),
          JSON.stringify(manifest, null, 2) + "\n",
        );
        await writeFile(resolve(dir, "index.html"), html);
        for (const item of p.assets ?? []) {
          const files = await this.declaredFiles(dir, manifest);
          await importAssetFile({
            config: this.config,
            projectDir: dir,
            manifest,
            files,
            sourceName: item.inboxName,
            name: item.name,
            mediaType: item.mediaType,
          });
          manifest = JSON.parse(
            await readFile(resolve(dir, "project.json"), "utf8"),
          );
        }
        // Publish the project in the registry only after it can be opened and
        // has durable history. A registry entry pointing at a directory that
        // create() later removes would make the next worker start fail with
        // E_CONFIGURATION while reloading the managed registry.
        this.config.projects[projectId] = dir;
        let opened = await this.open(projectId);
        if (p.templateId === "blank-v1") {
          await this.timelines.createEmpty(projectId, {width, height});
          opened = await this.inspect(projectId);
        }
        await ensureHistory(dir, {
          revision: opened.revision,
          html: await readFile(resolve(dir, "index.html"), "utf8"),
        });
        await addProjectToRegistry(this.config, projectId, dir);
        return {
          projectId,
          templateId: p.templateId,
          revision: opened.revision,
          width: opened.width,
          height: opened.height,
          fps: DEFAULT_FPS,
          scenes: opened.scenes,
        };
      } catch (error) {
        // Keep the in-memory mapping and the on-disk directory consistent with
        // the registry even when a post-create step (open/ensureHistory/
        // registry write) fails.
        delete this.config.projects[projectId];
        this.handles.delete(projectId);
        this.lifecycle.delete(projectId);
        try {
          await rm(dir, { recursive: true, force: true });
        } catch {
          this.diagnostic("failed create cleanup failed");
        }
        throw error;
      }
    });
  }
  async importAsset(p) {
    if(await this.timelines?.load(p.projectId))fail("E_TIMELINE_MODE","Use timeline.apply or scene.compose for this project","timeline");
    this.assertActive(p.projectId);
    return this.queue(p.projectId, async () => {
      const signature = sha(JSON.stringify(p));
      const cached = this.operationResult(
        p.projectId,
        p.operationId,
        signature,
      );
      if (cached) return cached;
      const current = await this.read(p.projectId);
      if (current.revision !== p.expectedRevision)
        fail("E_REVISION_CONFLICT", "Project changed before asset import", "asset");
      const dir = this.handles.get(p.projectId);
      const asset = await importAssetFile({
        config: this.config,
        projectDir: dir,
        manifest: current.manifest,
        files: current.files,
        sourceName: p.sourceName,
        name: p.name,
        mediaType: p.mediaType,
      });
      const after = await this.read(p.projectId);
      if (after.revision === current.revision)
        fail("E_INTERNAL", "Asset import did not produce a new revision", "asset");
      const history = await recordOp(dir, {
        actor: "human",
        kind: "asset.import",
        summary: `imported ${asset.path}`,
        operationId: p.operationId,
        from: current.revision,
        to: after.revision,
      });
      return this.rememberOperation(
        p.projectId,
        p.operationId,
        signature,
        {
          projectId: p.projectId,
          revision: after.revision,
          asset,
          assets: after.entries,
          historyCursor: history.historyCursor,
        },
      );
    });
  }
  async sceneOperation(p, kind, mutate) {
    if(await this.timelines?.load(p.projectId))fail("E_TIMELINE_MODE","Use scene.compose or timeline.apply for this project","timeline");
    this.assertActive(p.projectId);
    return this.queue(p.projectId, async () => {
      const signature = sha(JSON.stringify(p));
      const cached = this.operationResult(
        p.projectId,
        p.operationId,
        signature,
      );
      if (cached) return cached;
      const current = await this.read(p.projectId);
      if (current.revision !== p.expectedRevision)
        fail("E_REVISION_CONFLICT", "Project changed before scene operation", kind);
      const html = current.files.get(current.manifest.entry).toString();
      const parsed = parseDocument(html);
      const mutated = mutate(parsed);
      const generatedHtml = buildDocumentHtml({
        width: parsed.width,
        height: parsed.height,
        scenes: mutated.scenes,
      });
      // Regeneration must not silently discard manual element layout/style.
      const transplant = await transplantManagedOverrides({
        currentParsed: parsed,
        nextHtml: generatedHtml,
      });
      const allowDrops = kind === "scene.remove";
      if (!allowDrops && transplant.dropped.length)
        fail(
          "E_OVERRIDE_CONFLICT",
          `Scene operation would drop manual layout/style overrides: ${transplant.dropped
            .map((entry) => entry.stableId)
            .slice(0, 8)
            .join(",")}`,
          kind,
        );
      const nextHtml = transplant.html;
      validateDocumentHtml(nextHtml, {
        expectedScenes: mutated.scenes.map((scene) => scene.sceneId),
      });
      const dir = this.handles.get(p.projectId);
      await atomicWrite(resolve(dir, current.manifest.entry), nextHtml);
      const after = await this.read(p.projectId);
      if (after.revision === current.revision)
        fail("E_INTERNAL", "Scene operation produced no change", kind);
      const history = await recordWrite(dir, {
        before: { revision: current.revision, html },
        after: { revision: after.revision, html: nextHtml },
        actor: "human",
        kind,
        sceneId: mutated.sceneId ?? null,
        summary: mutated.summary ?? kind,
        operationId: p.operationId,
      });
      const nextParsed = parseDocument(nextHtml);
      return this.rememberOperation(
        p.projectId,
        p.operationId,
        signature,
        {
          projectId: p.projectId,
          revision: after.revision,
          scenes: sceneSummaries(nextParsed),
          changeSummary: {
            ...mutated.changeSummary,
            preservedOverrides: transplant.applied,
            droppedOverrides: allowDrops ? transplant.dropped : [],
          },
          historyCursor: history.historyCursor,
        },
      );
    });
  }
  sceneCreate(p) {
    return this.sceneOperation(p, "scene.create", (parsed) => {
      const spec = validateSceneSpec(p.template, { sceneId: true });
      const ids = new Set(parsed.scenes.map((scene) => scene.sceneId));
      let id = spec.sceneId;
      if (id !== undefined) {
        if (ids.has(id)) fail("E_PARAMS", "Duplicate sceneId");
      } else {
        let index = parsed.scenes.length + 1;
        while (ids.has(`scene-${index}`)) index += 1;
        id = `scene-${index}`;
      }
      let insertAt = parsed.scenes.length;
      if (p.afterSceneId !== undefined) {
        const afterIndex = parsed.scenes.findIndex(
          (scene) => scene.sceneId === p.afterSceneId,
        );
        if (afterIndex < 0) fail("E_SCENE_NOT_FOUND", "afterSceneId not found", "scene");
        insertAt = afterIndex + 1;
      }
      const scenes = parsed.scenes.map((scene) => ({ ...scene }));
      scenes.splice(insertAt, 0, { ...spec, sceneId: id });
      return {
        scenes,
        sceneId: id,
        summary: `created ${id}`,
        changeSummary: { created: id, order: scenes.map((scene) => scene.sceneId) },
      };
    });
  }
  sceneUpdate(p) {
    return this.sceneOperation(p, "scene.update", (parsed) => {
      const spec = validateSceneSpec(p.template);
      const index = parsed.scenes.findIndex(
        (scene) => scene.sceneId === p.sceneId,
      );
      if (index < 0) fail("E_SCENE_NOT_FOUND", "Scene not found", "scene");
      const scenes = parsed.scenes.map((scene, sceneIndex) =>
        sceneIndex === index ? { ...spec, sceneId: p.sceneId } : scene,
      );
      return {
        scenes,
        sceneId: p.sceneId,
        summary: `rewrote ${p.sceneId}`,
        changeSummary: {
          updated: p.sceneId,
          duration: { before: parsed.scenes[index].duration, after: spec.duration },
        },
      };
    });
  }
  sceneRemove(p) {
    return this.sceneOperation(p, "scene.remove", (parsed) => {
      const index = parsed.scenes.findIndex(
        (scene) => scene.sceneId === p.sceneId,
      );
      if (index < 0) fail("E_SCENE_NOT_FOUND", "Scene not found", "scene");
      if (parsed.scenes.length <= 1)
        fail("E_PARAMS", "At least one scene is required");
      const scenes = parsed.scenes.filter(
        (scene) => scene.sceneId !== p.sceneId,
      );
      return {
        scenes,
        sceneId: p.sceneId,
        summary: `removed ${p.sceneId}`,
        changeSummary: { removed: p.sceneId },
      };
    });
  }
  sceneReorder(p) {
    return this.sceneOperation(p, "scene.reorder", (parsed) => {
      const byId = new Map(
        parsed.scenes.map((scene) => [scene.sceneId, scene]),
      );
      if (
        !Array.isArray(p.order) ||
        p.order.length !== parsed.scenes.length ||
        new Set(p.order).size !== p.order.length ||
        p.order.some((id) => !byId.has(id))
      )
        fail("E_PARAMS", "order must list every scene exactly once", "scene");
      const scenes = p.order.map((id) => byId.get(id));
      return {
        scenes,
        summary: "reordered scenes",
        changeSummary: { order: p.order },
      };
    });
  }
  conflictResult(projectId, currentRevision, conflicts) {
    return {
      projectId,
      revision: currentRevision,
      written: false,
      conflicts,
      changeSummary: null,
    };
  }
  sceneElementMap(parsed, sceneId) {
    const map = new Map();
    for (const element of parsed.elements) {
      if (element.sceneId !== sceneId) continue;
      map.set(
        element.stableId,
        JSON.stringify({ tag: element.tag, text: element.text, timing: element.timing }),
      );
    }
    return map;
  }
  diffSceneElements(beforeParsed, afterParsed, sceneId) {
    const before = this.sceneElementMap(beforeParsed, sceneId);
    const after = this.sceneElementMap(afterParsed, sceneId);
    const adopted = [];
    const added = [];
    const removed = [];
    for (const [id, signature] of after) {
      if (!before.has(id)) added.push(id);
      else if (before.get(id) !== signature) adopted.push(id);
    }
    for (const id of before.keys()) if (!after.has(id)) removed.push(id);
    return { adopted, kept: [], added, removed };
  }
  async revise(p) {
    if(await this.timelines?.load(p.projectId))fail("E_TIMELINE_MODE","Use timeline.apply or scene.compose for this project","timeline");
    this.assertActive(p.projectId);
    return this.queue(p.projectId, async () => {
      const signature = sha(JSON.stringify(p));
      const cached = this.operationResult(
        p.projectId,
        p.operationId,
        signature,
      );
      if (cached) return cached;
      const current = await this.read(p.projectId);
      if (current.revision !== p.expectedRevision)
        fail("E_REVISION_CONFLICT", "Project changed before revise", "revise");
      const dir = this.handles.get(p.projectId);
      const humanHtml = current.files.get(current.manifest.entry).toString();
      const humanParsed = parseDocument(humanHtml);
      const humanIndex = humanParsed.scenes.findIndex(
        (scene) => scene.sceneId === p.sceneId,
      );
      if (humanIndex < 0)
        fail("E_SCENE_NOT_FOUND", "Scene not found", "revise");
      const spec = validateSceneSpec(p.template);
      const durationMismatch = (baseDuration) =>
        Math.abs(spec.duration - baseDuration) > 1e-6;
      if (p.baseRevision === current.revision) {
        if (durationMismatch(humanParsed.scenes[humanIndex].duration))
          return this.rememberOperation(
            p.projectId,
            p.operationId,
            signature,
            this.conflictResult(p.projectId, current.revision, [
              {
                sceneId: p.sceneId,
                stableId: `${p.sceneId}-section`,
                reason: "SCENE_META_CHANGED",
                human: { duration: humanParsed.scenes[humanIndex].duration },
                ai: { duration: spec.duration },
                hint: "Scene duration/order changes need an explicit scene operation",
              },
            ]),
          );
        const scenes = humanParsed.scenes.map((scene, index) =>
          index === humanIndex ? { ...spec, sceneId: p.sceneId } : scene,
        );
        const generatedHtml = buildDocumentHtml({
          width: humanParsed.width,
          height: humanParsed.height,
          scenes,
        });
        const transplant = await transplantManagedOverrides({
          currentParsed: humanParsed,
          nextHtml: generatedHtml,
        });
        if (transplant.dropped.length)
          return this.rememberOperation(
            p.projectId,
            p.operationId,
            signature,
            this.conflictResult(
              p.projectId,
              current.revision,
              transplant.dropped.map((entry) => overrideConflict(entry)),
            ),
          );
        const nextHtml = transplant.html;
        validateDocumentHtml(nextHtml, {
          expectedScenes: scenes.map((scene) => scene.sceneId),
        });
        await atomicWrite(resolve(dir, current.manifest.entry), nextHtml);
        const after = await this.read(p.projectId);
        const history = await recordWrite(dir, {
          before: { revision: current.revision, html: humanHtml },
          after: { revision: after.revision, html: nextHtml },
          actor: "ai",
          kind: "project.revise",
          sceneId: p.sceneId,
          summary: `AI rewrite ${p.sceneId} (no human change)`,
          operationId: p.operationId,
        });
        return this.rememberOperation(
          p.projectId,
          p.operationId,
          signature,
          {
            projectId: p.projectId,
            revision: after.revision,
            written: true,
            conflicts: [],
            changeSummary: this.diffSceneElements(
              humanParsed,
              parseDocument(nextHtml),
              p.sceneId,
            ),
            scenes: sceneSummaries(parseDocument(nextHtml)),
            historyCursor: history.historyCursor,
          },
        );
      }
      const baseHtml = await loadSnapshot(dir, p.baseRevision);
      const baseParsed = parseDocument(baseHtml);
      const baseIndex = baseParsed.scenes.findIndex(
        (scene) => scene.sceneId === p.sceneId,
      );
      if (baseIndex < 0)
        fail("E_BASE_MISSING", "baseRevision does not contain the scene", "revise");
      if (durationMismatch(baseParsed.scenes[baseIndex].duration))
        return this.rememberOperation(
          p.projectId,
          p.operationId,
          signature,
          this.conflictResult(p.projectId, current.revision, [
            {
              sceneId: p.sceneId,
              stableId: `${p.sceneId}-section`,
              reason: "SCENE_META_CHANGED",
              human: { duration: humanParsed.scenes[humanIndex].duration },
              ai: { duration: spec.duration },
              hint: "Scene duration/order changes need an explicit scene operation",
            },
          ]),
        );
      const aiScenes = baseParsed.scenes.map((scene, index) =>
        index === baseIndex ? { ...spec, sceneId: p.sceneId } : scene,
      );
      const generatedAiHtml = buildDocumentHtml({
        width: baseParsed.width,
        height: baseParsed.height,
        scenes: aiScenes,
      });
      const baseTransplant = await transplantManagedOverrides({
        currentParsed: baseParsed,
        nextHtml: generatedAiHtml,
      });
      const aiHtml = baseTransplant.html;
      validateDocumentHtml(aiHtml, {
        expectedScenes: aiScenes.map((scene) => scene.sceneId),
      });
      const baseOverriddenIds = new Set(
        collectManualOverrides(
          baseParsed,
          templateDefaultParsed(baseParsed),
        ).keys(),
      );
      const merged = mergeSceneDocuments({
        sceneId: p.sceneId,
        baseHtml,
        humanHtml,
        aiHtml,
        baseOverriddenIds,
      });
      if (!merged.ok)
        return this.rememberOperation(
          p.projectId,
          p.operationId,
          signature,
          {
            ...this.conflictResult(
              p.projectId,
              current.revision,
              merged.conflicts,
            ),
            unsupported: merged.unsupported,
            baseRevision: p.baseRevision,
          },
        );
      await atomicWrite(resolve(dir, current.manifest.entry), merged.html);
      const after = await this.read(p.projectId);
      const history = await recordWrite(dir, {
        before: { revision: current.revision, html: humanHtml },
        after: { revision: after.revision, html: merged.html },
        actor: "ai",
        kind: "project.revise",
        sceneId: p.sceneId,
        summary: `AI rewrite merged into ${p.sceneId}`,
        operationId: p.operationId,
      });
      return this.rememberOperation(
        p.projectId,
        p.operationId,
        signature,
        {
          projectId: p.projectId,
          revision: after.revision,
          written: true,
          conflicts: [],
          changeSummary: {
            ...merged.changeSummary,
            preservedOverrides: baseTransplant.applied,
          },
          scenes: sceneSummaries(parseDocument(merged.html)),
          historyCursor: history.historyCursor,
        },
      );
    });
  }
  async history(p) {
    this.assertActive(p.projectId);
    return this.queue(p.projectId, async () => {
      const current = await this.read(p.projectId);
      const dir = this.handles.get(p.projectId);
      const html = current.files.get(current.manifest.entry).toString();
      await ensureHistory(dir, { revision: current.revision, html });
      const history = await listHistory(dir, { limit: p.limit ?? 20 });
      return {
        projectId: p.projectId,
        revision: current.revision,
        historyCursor: history.historyCursor,
        cursor: history.cursor,
        canUndo: history.canUndo,
        canRedo: history.canRedo,
        entries: history.entries,
        snapshotBytes: history.snapshotBytes,
        maxEntries: history.maxEntries,
        maxSnapshotBytes: history.maxSnapshotBytes,
      };
    });
  }
  async undo(p) {
    return this.historyStep(p, -1);
  }
  async redo(p) {
    return this.historyStep(p, 1);
  }
  async historyStep(p, direction) {
    this.assertActive(p.projectId);
    return this.queue(p.projectId, async () => {
      const signature = sha(JSON.stringify(p) + ":" + direction);
      const cached = this.operationResult(
        p.projectId,
        p.operationId,
        signature,
      );
      if (cached) return cached;
      const current = await this.read(p.projectId);
      if (current.revision !== p.expectedRevision)
        fail("E_REVISION_CONFLICT", "Project changed before history step", "history");
      const dir = this.handles.get(p.projectId);
      const html = current.files.get(current.manifest.entry).toString();
      await ensureHistory(dir, { revision: current.revision, html });
      const step =
        direction < 0
          ? await historyUndo(dir, { actor: "human" })
          : await historyRedo(dir, { actor: "human" });
      const after = await this.read(p.projectId);
      return this.rememberOperation(
        p.projectId,
        p.operationId,
        signature,
        {
          projectId: p.projectId,
          revision: after.revision,
          historyCursor: step.historyCursor,
          restored: {
            historyCursor: step.entry.historyCursor,
            revision: step.entry.revision,
            actor: step.entry.actor,
            kind: step.entry.kind,
            sceneId: step.entry.sceneId ?? null,
            summary: step.entry.summary ?? "",
          },
        },
      );
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
    } else if (op?.type === "layout") {
      keys(op, ["type", "target", "unit", "box"], [
        "type",
        "target",
        "unit",
        "box",
      ]);
      if (op.unit !== "composition-px")
        fail("E_PARAMS", "layout.unit must be composition-px");
      validateLayoutPatch(op.box);
    } else if (op?.type === "style") {
      keys(op, ["type", "target", "styles"], ["type", "target", "styles"]);
      validateStylePatch(op.styles);
    } else fail("E_PARAMS", "Unsupported edit type");
    string(op.target, 256);
  }
}

export function validateCompose(p) {
  keys(
    p,
    ["projectId", "expectedRevision", "operationId", "html"],
    ["projectId", "expectedRevision", "operationId", "html"],
  );
  string(p.projectId);
  revision(p.expectedRevision);
  string(p.operationId);
  // Type/keys only: the composition contract itself (size, structure, assets,
  // SDK round-trip) is validated inside Projects.compose from the live manifest
  // and reports E_COMPOSE_INVALID.
  if (typeof p.html !== "string")
    fail("E_PARAMS", "Expected html to be a complete HTML composition string");
}

export function validateSource(p) {
  keys(p, ["projectId"], ["projectId"]);
  string(p.projectId);
}

function templateObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    fail("E_PARAMS", "Scene template must be an object");
  return value;
}
export function validateCreateProject(p) {
  keys(
    p,
    ["templateId", "title", "width", "height", "fps", "assets"],
    ["templateId"],
  );
  if (p.templateId !== "blank-v1") validTemplateId(p.templateId);
  if (p.title !== undefined) string(p.title, 120);
  if (p.width !== undefined) {
    number(p.width, 320, 3840);
    if (!Number.isInteger(p.width)) fail("E_PARAMS", "width must be an integer");
  }
  if (p.height !== undefined) {
    number(p.height, 180, 2160);
    if (!Number.isInteger(p.height))
      fail("E_PARAMS", "height must be an integer");
  }
  if (p.fps !== undefined && p.fps !== 30)
    fail("E_PARAMS", "Only 30 fps is supported in v1");
  if (p.assets !== undefined) {
    if (!Array.isArray(p.assets) || p.assets.length > 16)
      fail("E_PARAMS", "Expected at most 16 assets");
    for (const asset of p.assets) {
      keys(asset, ["inboxName", "name", "mediaType"], ["inboxName"]);
      string(asset.inboxName, 256);
      if (asset.name !== undefined) string(asset.name, 128);
      if (asset.mediaType !== undefined) string(asset.mediaType, 32);
    }
  }
}
export function validateImportAsset(p) {
  keys(
    p,
    ["projectId", "expectedRevision", "operationId", "sourceName", "name", "mediaType"],
    ["projectId", "expectedRevision", "operationId", "sourceName"],
  );
  string(p.projectId);
  revision(p.expectedRevision);
  string(p.operationId);
  string(p.sourceName, 256);
  if (p.name !== undefined) string(p.name, 128);
  if (p.mediaType !== undefined) string(p.mediaType, 32);
}
export function validateSceneCreate(p) {
  keys(
    p,
    ["projectId", "expectedRevision", "operationId", "sceneId", "afterSceneId", "template"],
    ["projectId", "expectedRevision", "operationId", "template"],
  );
  string(p.projectId);
  revision(p.expectedRevision);
  string(p.operationId);
  if (p.sceneId !== undefined) validSceneId(p.sceneId);
  if (p.afterSceneId !== undefined) validSceneId(p.afterSceneId);
  templateObject(p.template);
}
export function validateSceneUpdate(p) {
  keys(
    p,
    ["projectId", "expectedRevision", "operationId", "sceneId", "template"],
    ["projectId", "expectedRevision", "operationId", "sceneId", "template"],
  );
  string(p.projectId);
  revision(p.expectedRevision);
  string(p.operationId);
  validSceneId(p.sceneId);
  templateObject(p.template);
}
export function validateSceneRemove(p) {
  keys(
    p,
    ["projectId", "expectedRevision", "operationId", "sceneId"],
    ["projectId", "expectedRevision", "operationId", "sceneId"],
  );
  string(p.projectId);
  revision(p.expectedRevision);
  string(p.operationId);
  validSceneId(p.sceneId);
}
export function validateSceneReorder(p) {
  keys(
    p,
    ["projectId", "expectedRevision", "operationId", "order"],
    ["projectId", "expectedRevision", "operationId", "order"],
  );
  string(p.projectId);
  revision(p.expectedRevision);
  string(p.operationId);
  if (!Array.isArray(p.order) || p.order.length < 1 || p.order.length > 12)
    fail("E_PARAMS", "order must be a scene id list");
  for (const id of p.order) validSceneId(id);
}
export function validateRevise(p) {
  keys(
    p,
    ["projectId", "baseRevision", "expectedRevision", "operationId", "sceneId", "template"],
    ["projectId", "baseRevision", "expectedRevision", "operationId", "sceneId", "template"],
  );
  string(p.projectId);
  revision(p.baseRevision);
  revision(p.expectedRevision);
  string(p.operationId);
  validSceneId(p.sceneId);
  templateObject(p.template);
}
export function validateHistory(p) {
  keys(p, ["projectId", "limit"], ["projectId"]);
  string(p.projectId);
  if (p.limit !== undefined) {
    number(p.limit, 1, 64);
    if (!Number.isInteger(p.limit)) fail("E_PARAMS", "limit must be an integer");
  }
}
export function validateHistoryStep(p) {
  keys(
    p,
    ["projectId", "expectedRevision", "operationId"],
    ["projectId", "expectedRevision", "operationId"],
  );
  string(p.projectId);
  revision(p.expectedRevision);
  string(p.operationId);
}
/** P3-016 UI-only rename params: projectId + a trimmed 1..120 title. */
export function validateProjectRename(p) {
  keys(p, ["projectId", "title"], ["projectId", "title"]);
  string(p.projectId);
  string(p.title, PROJECT_TITLE_MAX);
  normalizeProjectTitle(p.title);
}
