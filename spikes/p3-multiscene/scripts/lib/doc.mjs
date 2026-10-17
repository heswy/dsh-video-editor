import { buildDocument } from "@hyperframes/sdk";
import { readFile, rename, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { readJson, sha256 } from "./util.mjs";

// ─── Project snapshot / revision (mirrors the accepted worker's rules) ─────
export async function readProjectSnapshot(projectDir) {
  const manifest = await readJson(resolve(projectDir, "project.json"));
  const names = [manifest.entry, ...manifest.assets].sort();
  const files = new Map();
  for (const name of names) files.set(name, await readFile(resolve(projectDir, name)));
  const entries = [...files].map(([path, bytes]) => ({
    path,
    bytes: bytes.length,
    sha256: sha256(bytes),
  }));
  const revision = sha256(JSON.stringify({ entry: manifest.entry, files: entries }));
  return { manifest, files, entries, revision };
}

// ─── DOM/model helpers over @hyperframes/sdk ────────────────────────────────
function elementSnapshot(element, parentId, depth, sceneId, order) {
  return {
    id: element.scopedId,
    tag: element.tag,
    parentId,
    depth,
    sceneId,
    order,
    text: element.text,
    start: element.start,
    duration: element.duration,
    attributes: { ...element.attributes },
    classNames: [...element.classNames],
    inlineStyles: { ...element.inlineStyles },
  };
}

export function documentModel(html) {
  const document = buildDocument(html);
  const elements = [];
  const walk = (element, parentId, depth, inheritedSceneId, order) => {
    const sceneId =
      element.attributes["data-scene-id"] ?? inheritedSceneId ?? null;
    elements.push(elementSnapshot(element, parentId, depth, sceneId, order));
    element.children.forEach((child, index) =>
      walk(child, element.scopedId, depth + 1, sceneId, index),
    );
  };
  document.roots.forEach((root, index) =>
    walk(root, null, 0, root.attributes["data-scene-id"] ?? null, index),
  );
  return {
    elements,
    html,
    width: document.width,
    height: document.height,
    duration: document.compositionDuration,
  };
}

export function childrenOf(model, parentId) {
  return model.elements
    .filter((element) => element.parentId === parentId)
    .sort((a, b) => a.order - b.order);
}

export function capabilities(model, element) {
  const caps = [];
  if (
    ["h1", "h2", "h3", "h4", "p", "span", "div"].includes(element.tag) &&
    childrenOf(model, element.id).length === 0
  )
    caps.push("text");
  if (
    !element.attributes["data-composition-id"] &&
    element.start !== null &&
    Number(element.attributes["data-duration"]) > 0
  )
    caps.push("timing");
  return caps;
}

// ─── Raw HTML scene sections (spike convention: data-scene-id sections) ───
function parseAttributes(source) {
  const attributes = {};
  for (const match of source.matchAll(/([^\s=/>]+)="([^"]*)"/g))
    attributes[match[1]] = match[2];
  return attributes;
}

export function sceneSections(html) {
  const sections = [];
  for (const match of html.matchAll(/<section\b([^>]*)>([\s\S]*?)<\/section>/g)) {
    const attributes = parseAttributes(match[1]);
    const sceneId = attributes["data-scene-id"];
    if (!sceneId) continue;
    sections.push({
      sceneId,
      order: Number(attributes["data-scene-order"] ?? "0"),
      start: Number(attributes["data-start"] ?? "0"),
      duration: Number(attributes["data-duration"] ?? "0"),
      openTag: `<section${match[1]}>`,
      html: match[0],
      index: match.index,
      endIndex: match.index + match[0].length,
    });
  }
  return sections;
}

export function sectionHtml(html, sceneId) {
  return sceneSections(html).find((section) => section.sceneId === sceneId)?.html;
}

export function replaceSectionHtml(html, sceneId, replacementHtml) {
  const section = sceneSections(html).find((item) => item.sceneId === sceneId);
  if (!section) throw new Error(`section ${sceneId} not found`);
  return html.slice(0, section.index) + replacementHtml + html.slice(section.endIndex);
}

export function sceneElementSnapshots(model, sceneId) {
  const section = model.elements.find(
    (element) =>
      element.tag === "section" &&
      element.attributes["data-scene-id"] === sceneId,
  );
  if (!section) throw new Error(`scene ${sceneId} not found in model`);
  const descendants = [];
  const collect = (parentId) => {
    for (const child of childrenOf(model, parentId)) {
      descendants.push(child);
      collect(child.id);
    }
  };
  collect(section.id);
  return { section, descendants };
}

export function sectionMeta(section) {
  return {
    sceneId: section.attributes["data-scene-id"],
    order: Number(section.attributes["data-scene-order"] ?? "0"),
    start: Number(section.attributes["data-start"] ?? "0"),
    duration: Number(section.attributes["data-duration"] ?? "0"),
  };
}

export function sameSectionMeta(left, right) {
  return JSON.stringify(sectionMeta(left)) === JSON.stringify(sectionMeta(right));
}

// ─── Extended inspect proposal (Q2) ────────────────────────────────────────
export async function inspectExtended(projectDir) {
  const snapshot = await readProjectSnapshot(projectDir);
  const html = snapshot.files.get("index.html").toString("utf8");
  const model = await documentModel(html);
  const sections = model.elements
    .filter(
      (element) =>
        element.tag === "section" && element.attributes["data-scene-id"],
    )
    .sort((a, b) => a.order - b.order);
  const scenes = sections.map((section) => {
    const { descendants } = sceneElementSnapshots(
      model,
      section.attributes["data-scene-id"],
    );
    return {
      sceneId: section.attributes["data-scene-id"],
      order: Number(section.attributes["data-scene-order"] ?? "0"),
      start: Number(section.attributes["data-start"] ?? "0"),
      duration: Number(section.attributes["data-duration"] ?? "0"),
      elements: descendants.map((element) => ({
        stableId: element.id,
        sceneId: section.attributes["data-scene-id"],
        tag: element.tag,
        text: element.text,
        timing: {
          start: element.start,
          duration:
            element.attributes["data-duration"] !== undefined
              ? Number(element.attributes["data-duration"])
              : element.duration,
        },
        capabilities: capabilities(model, element),
      })),
    };
  });
  return {
    projectId: snapshot.manifest.projectId ?? null,
    revision: snapshot.revision,
    width: model.width,
    height: model.height,
    duration: model.duration,
    fps: 30,
    scenes,
  };
}

// ─── Serialization for the template-constrained document (Q5 merge output) ─
const VOID_TAGS = new Set(["img", "br", "hr", "source", "video", "audio"]);

function kebab(name) {
  if (name.startsWith("--")) return name;
  return name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}

function escapeAttribute(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;");
}

export function escapeText(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

export function serializeElement(element, childrenHtml = "") {
  const attributes = [];
  if (element.attributes.id !== undefined)
    attributes.push(`id="${escapeAttribute(element.attributes.id)}"`);
  attributes.push(`data-hf-id="${escapeAttribute(element.id)}"`);
  if (element.classNames.length)
    attributes.push(`class="${escapeAttribute(element.classNames.join(" "))}"`);
  const styles = Object.entries(element.inlineStyles)
    .map(([name, value]) => `${kebab(name)}:${value}`)
    .join(";");
  if (styles) attributes.push(`style="${escapeAttribute(styles)}"`);
  for (const [name, value] of Object.entries(element.attributes)) {
    if (["id", "class", "style"].includes(name) || name.startsWith("data-hf-"))
      continue;
    attributes.push(`${name}="${escapeAttribute(value)}"`);
  }
  const open = `<${element.tag} ${attributes.join(" ")}>`;
  if (VOID_TAGS.has(element.tag)) return open;
  const text = element.text ? escapeText(element.text) : "";
  return `${open}${text}${childrenHtml}</${element.tag}>`;
}

export function serializeScene(model, sceneId) {
  const { section, descendants } = sceneElementSnapshots(model, sceneId);
  const nested = descendants.filter((element) => element.depth > section.depth + 1);
  if (nested.length)
    return {
      ok: false,
      error: `unsupported nested depth under scene ${sceneId}: ${nested.map((n) => n.id).join(",")}`,
    };
  const elementsById = new Map(model.elements.map((element) => [element.id, element]));
  const render = (parentId) =>
    childrenOf(model, parentId)
      .map((child) => {
        const grandchildren = childrenOf(model, child.id);
        if (grandchildren.length)
          return serializeElement(child, render(child.id));
        return serializeElement(child);
      })
      .join("");
  return { ok: true, html: serializeElement(section, render(section.id)), elementsById };
}

// Validate a controlled whole-file rewrite before publishing it.
export async function validateDocument(html, expected) {
  const model = await documentModel(html);
  const errors = [];
  if (model.width !== expected.width || model.height !== expected.height)
    errors.push("dimensions changed");
  if (Math.abs(model.duration - expected.duration) > 1e-6)
    errors.push(`duration changed: ${model.duration} != ${expected.duration}`);
  const ids = model.elements.map((element) => element.id);
  if (new Set(ids).size !== ids.length) errors.push("duplicate stable ids");
  const sections = model.elements.filter(
    (element) =>
      element.tag === "section" && element.attributes["data-scene-id"],
  );
  const extraSections = sections
    .map((section) => section.attributes["data-scene-id"])
    .filter((sceneId) => !expected.sceneIds.includes(sceneId));
  if (extraSections.length) errors.push(`unexpected scenes: ${extraSections}`);
  const missing = expected.sceneIds.filter(
    (sceneId) =>
      !sections.some(
        (section) => section.attributes["data-scene-id"] === sceneId,
      ),
  );
  if (missing.length) errors.push(`missing scenes: ${missing}`);
  return { ok: errors.length === 0, errors, model };
}

// Write the entry atomically; validation happens before this call.
export async function writeEntryAtomic(projectDir, html) {
  const target = resolve(projectDir, "index.html");
  const temporary = resolve(projectDir, `.index.${randomUUID()}.tmp`);
  await writeFile(temporary, html);
  await rename(temporary, target);
}

export function otherSectionsUnchanged(beforeHtml, afterHtml, sceneIds) {
  const before = new Map(
    sceneSections(beforeHtml).map((section) => [section.sceneId, section.html]),
  );
  const after = new Map(
    sceneSections(afterHtml).map((section) => [section.sceneId, section.html]),
  );
  return sceneIds.map((sceneId) => ({
    sceneId,
    unchanged: before.get(sceneId) === after.get(sceneId),
    beforeSha: sha256(before.get(sceneId) ?? ""),
    afterSha: sha256(after.get(sceneId) ?? ""),
  }));
}
