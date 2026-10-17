import { buildDocument } from "@hyperframes/sdk";
import { fail } from "./errors.mjs";

export const TEMPLATE_ID = "product-launch-v1";
export const TEMPLATE_IDS = [TEMPLATE_ID];
export const MAX_SCENES = 12;
export const MAX_DURATION = 3600;
export const MIN_SCENE_DURATION = 0.5;
export const MAX_SCENE_DURATION = 60;
export const DEFAULT_WIDTH = 1280;
export const DEFAULT_HEIGHT = 720;
export const DEFAULT_FPS = 30;
export const DEFAULT_SCENE_DURATION = 5;

const FPS = 30;
const PALETTE = [
  { color: "#1d4ed8", accent: "#bfdbfe" },
  { color: "#0f766e", accent: "#99f6e4" },
  { color: "#9d174d", accent: "#fbcfe8" },
  { color: "#7c2d12", accent: "#fed7aa" },
  { color: "#4c1d95", accent: "#ddd6fe" },
  { color: "#134e4a", accent: "#a7f3d0" },
];
const HEX = /^#[0-9a-f]{6}$/;
const ASSET_PATH = /^assets\/[A-Za-z0-9][A-Za-z0-9._-]*\.(png|jpe?g)$/;
const SCENE_KEYS = [
  "sceneId",
  "duration",
  "title",
  "subtitle",
  "badge",
  "color",
  "accent",
  "logo",
  "shot",
];
const SCENE_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;

function parameter(message) {
  fail("E_PARAMS", message);
}
function template(message) {
  fail("E_TEMPLATE", message);
}

export function templateId(value) {
  if (typeof value !== "string" || !TEMPLATE_IDS.includes(value))
    template("Unsupported project template");
  return value;
}

export function projectId(value) {
  if (typeof value !== "string" || !SCENE_ID.test(value))
    parameter("Invalid projectId");
  return value;
}

export function sceneId(value) {
  if (typeof value !== "string" || !SCENE_ID.test(value))
    parameter("Invalid sceneId");
  return value;
}

function text(value, name, min, max) {
  if (
    typeof value !== "string" ||
    value.length < min ||
    value.length > max
  )
    parameter(`Invalid ${name}`);
  return value;
}

function color(value, name) {
  if (typeof value !== "string" || !HEX.test(value))
    parameter(`Invalid ${name}`);
  return value;
}

function assetReference(value, name) {
  if (typeof value !== "string" || !ASSET_PATH.test(value))
    parameter(`Invalid ${name}`);
  return value;
}

export function validateSceneSpec(value, { sceneId: allowId = false } = {}) {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    parameter("Scene template must be an object");
  for (const key of Object.keys(value))
    if (!SCENE_KEYS.includes(key))
      parameter(`Unsupported scene template field ${key}`);
  if (value.sceneId !== undefined) {
    if (!allowId) parameter("sceneId is not allowed in this template");
    sceneId(value.sceneId);
  }
  if (value.duration === undefined) parameter("Scene duration is required");
  if (
    typeof value.duration !== "number" ||
    !Number.isFinite(value.duration) ||
    value.duration < MIN_SCENE_DURATION ||
    value.duration > MAX_SCENE_DURATION
  )
    parameter("Scene duration outside supported range");
  const spec = {
    sceneId: allowId && value.sceneId !== undefined ? value.sceneId : undefined,
    duration: Math.round(value.duration * 1000) / 1000,
    title: text(value.title, "scene title", 1, 200),
    subtitle:
      value.subtitle === undefined
        ? undefined
        : text(value.subtitle, "scene subtitle", 0, 300),
    badge:
      value.badge === undefined
        ? undefined
        : text(value.badge, "scene badge", 0, 48),
    color: value.color === undefined ? undefined : color(value.color, "scene color"),
    accent:
      value.accent === undefined ? undefined : color(value.accent, "scene accent"),
    logo: value.logo === undefined ? undefined : assetReference(value.logo, "scene logo"),
    shot: value.shot === undefined ? undefined : assetReference(value.shot, "scene shot"),
  };
  return spec;
}

export function defaultScene(index, overrides = {}) {
  const palette = PALETTE[index % PALETTE.length];
  return {
    sceneId: `scene-${index + 1}`,
    duration: DEFAULT_SCENE_DURATION,
    title: `Scene ${index + 1}`,
    subtitle: undefined,
    badge: undefined,
    color: palette.color,
    accent: palette.accent,
    logo: undefined,
    shot: undefined,
    ...overrides,
  };
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function normalizeScenes(specs) {
  if (!Array.isArray(specs) || specs.length < 1 || specs.length > MAX_SCENES)
    fail("E_PARAMS", `Expected 1-${MAX_SCENES} scenes`);
  if (!specs.every((spec) => spec))
    fail("E_INTERNAL", "Missing scene template");
  const ids = new Set();
  let total = 0;
  const scenes = specs.map((rawSpec, index) => {
    const checked = validateSceneSpec(rawSpec, { sceneId: true });
    const palette = PALETTE[index % PALETTE.length];
    const id = checked.sceneId ?? defaultScene(index).sceneId;
    if (ids.has(id)) fail("E_PARAMS", "Duplicate sceneId");
    ids.add(id);
    total = Math.round((total + checked.duration) * 1000) / 1000;
    return {
      sceneId: id,
      duration: checked.duration,
      start: 0,
      startComputed: true,
      title: checked.title,
      subtitle: checked.subtitle,
      badge: checked.badge,
      color: checked.color ?? palette.color,
      accent: checked.accent ?? palette.accent,
      logo: checked.logo,
      shot: checked.shot,
    };
  });
  if (total > MAX_DURATION) fail("E_PARAMS", "Total duration exceeds limit");
  let start = 0;
  for (const scene of scenes) {
    scene.start = Math.round(start * 1000) / 1000;
    start += scene.duration;
  }
  return { scenes, total: Math.round(start * 1000) / 1000 };
}

function image(attributes) {
  return `  <img ${attributes.join(" ")}>`;
}

function renderSection(scene) {
  const id = scene.sceneId;
  const local = scene.duration;
  const children = [];
  children.push(
    `  <div id="${id}-badge" data-hf-id="${id}-badge" style="position:absolute;left:88px;top:88px;font-size:22px;letter-spacing:6px;color:${scene.accent}">${escapeHtml(scene.badge ?? "")}</div>`,
  );
  children.push(
    `  <h1 id="${id}-title" class="clip" data-hf-id="${id}-title" data-start="${scene.start}" data-duration="${local}" style="position:absolute;left:88px;top:196px;margin:0;width:980px;font-size:64px;line-height:1.12;font-weight:600">${escapeHtml(scene.title)}</h1>`,
  );
  if (scene.subtitle !== undefined)
    children.push(
      `  <p id="${id}-subtitle" class="clip" data-hf-id="${id}-subtitle" data-start="${scene.start + 0.4}" data-duration="${Math.max(0.5, local - 0.4)}" style="position:absolute;left:90px;top:330px;margin:0;font-size:26px;color:${scene.accent}">${escapeHtml(scene.subtitle)}</p>`,
    );
  children.push(
    `  <div id="${id}-rule" class="clip" data-hf-id="${id}-rule" data-start="${scene.start + 0.2}" data-duration="${Math.max(0.5, local - 0.2)}" style="position:absolute;left:88px;top:560px;width:1104px;height:2px;background:${scene.accent}"></div>`,
  );
  if (scene.logo)
    children.push(
      image([
        `id="${id}-logo"`, `data-hf-id="${id}-logo"`,
        `src="./${scene.logo}"`,
        `style="position:absolute;left:1030px;top:88px;width:140px;height:140px;object-fit:cover;border-radius:20px"`,
      ]),
    );
  if (scene.shot)
    children.push(
      image([
        `id="${id}-shot"`, `data-hf-id="${id}-shot"`,
        `src="./${scene.shot}"`,
        `style="position:absolute;left:800px;top:430px;width:250px;height:150px;object-fit:cover;border-radius:14px"`,
      ]),
    );
  return `  <section id="${id}" class="clip" data-scene-id="${id}" data-scene-order="${scene.order ?? 0}" data-hf-id="${id}-section" data-start="${scene.start}" data-duration="${local}" style="position:absolute;inset:0;overflow:hidden;background:${scene.color};opacity:0">
${children.join("\n")}
  </section>`;
}

function renderTimeline(scenes) {
  const lines = ["  const tl = gsap.timeline({ paused: true });"];
  // All sections start with inline opacity:0. The first reveal happens at 0,
  // which avoids the P3-001 StaticGuard "starts visible before its first
  // opacity tween" warning.
  lines.push(`  tl.set("#${scenes[0].sceneId}", { opacity: 1 }, 0);`);
  for (let index = 1; index < scenes.length; index++)
    lines.push(
      `  tl.set("#${scenes[index].sceneId}", { opacity: 1 }, ${scenes[index].start});`,
    );
  for (let index = 0; index < scenes.length - 1; index++) {
    const scene = scenes[index];
    lines.push(
      `  tl.set("#${scene.sceneId}", { opacity: 0 }, ${Math.round((scene.start + scene.duration) * 1000) / 1000});`,
    );
  }
  for (const scene of scenes) {
    const id = scene.sceneId;
    lines.push(
      `  tl.fromTo('[data-hf-id="${id}-title"]', { opacity: 0, y: 36 }, { opacity: 1, y: 0, duration: 0.9, ease: "power2.out" }, ${scene.start});`,
      `  tl.fromTo('[data-hf-id="${id}-rule"]', { scaleX: 0 }, { scaleX: 1, duration: 1.2, ease: "none" }, ${scene.start + 0.2});`,
    );
  }
  lines.push("  window.__timelines = { main: tl };");
  lines.push("  tl.seek(0);");
  return lines.join("\n");
}

export function buildDocumentHtml({ width, height, scenes }) {
  const { scenes: normalized, total } = normalizeScenes(scenes);
  normalized.forEach((scene, index) => {
    scene.order = index;
    scene.id = scene.sceneId;
  });
  const sections = normalized.map((scene) => renderSection(scene)).join("\n");
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>DSH Video</title>
<style>
* { box-sizing: border-box; }
html, body { margin: 0; width: ${width}px; height: ${height}px; overflow: hidden; background: #000; }
#main { position: relative; width: ${width}px; height: ${height}px; overflow: hidden; background: #000; font-family: sans-serif; }
</style>
<script src="./assets/gsap.min.js"></script>
</head>
<body>
<div id="main" data-composition-id="main" data-hf-id="hf-main" data-width="${width}" data-height="${height}" data-fps="${FPS}" data-start="0" data-duration="${total}">
${sections}
</div>
<script>
${renderTimeline(normalized)}
</script>
</body>
</html>
`;
}

// ─── Parsing the single document back into scene templates ────────────────
function elementChildren(root) {
  return root.children.filter(
    (child) => child.attributes["data-scene-id"] !== undefined,
  );
}

function findBySuffix(elements, suffix) {
  return elements.find(
    (element) => element.scopedId === suffix || element.scopedId?.endsWith(suffix),
  );
}

function styleColor(element, property) {
  const styles = element?.inlineStyles ?? {};
  const value = styles[property];
  return typeof value === "string" && HEX.test(value) ? value : undefined;
}

function specFromSection(model, section, elements) {
  const id = section.attributes["data-scene-id"];
  const titleElement = elements.find((element) => element.scopedId === `${id}-title`);
  const palette = PALETTE[Number(section.attributes["data-scene-order"] ?? 0) % PALETTE.length];
  const spec = {
    sceneId: id,
    duration: Number(section.attributes["data-duration"]),
    title: (titleElement?.text ?? "").trim(),
    subtitle: undefined,
    badge: undefined,
    color: styleColor(section, "background") ?? palette.color,
    accent: undefined,
    logo: undefined,
    shot: undefined,
  };
  const badge = elements.find((element) => element.scopedId === `${id}-badge`);
  if (badge) spec.badge = badge.text ?? "";
  const subtitle = elements.find((element) => element.scopedId === `${id}-subtitle`);
  if (subtitle) spec.subtitle = subtitle.text ?? "";
  const rule = elements.find((element) => element.scopedId === `${id}-rule`);
  spec.accent = styleColor(rule, "background") ?? palette.accent;
  const assetSrc = (element) =>
    element?.attributes.src?.replace(/^\.\//, "");
  const logo = elements.find((element) => element.scopedId === `${id}-logo`);
  if (logo) spec.logo = assetSrc(logo);
  const shot = elements.find((element) => element.scopedId === `${id}-shot`);
  if (shot) spec.shot = assetSrc(shot);
  if (!spec.title)
    fail("E_TEMPLATE", "Scene title is empty; template requires text");
  if (!Number.isFinite(spec.duration) || spec.duration < MIN_SCENE_DURATION)
    fail("E_TEMPLATE", "Scene duration is invalid");
  if (spec.logo !== undefined && !ASSET_PATH.test(spec.logo ?? ""))
    fail("E_TEMPLATE", "Scene logo is not a declared asset path");
  if (spec.shot !== undefined && !ASSET_PATH.test(spec.shot ?? ""))
    fail("E_TEMPLATE", "Scene shot is not a declared asset path");
  return spec;
}

export function parseDocument(html) {
  const document = buildDocument(html);
  const root = document.roots[0];
  if (!root) fail("E_TEMPLATE", "Composition root is missing");
  const sections = root.children.filter(
    (child) => child.attributes["data-scene-id"] !== undefined,
  );
  if (sections.length < 1 || sections.length > MAX_SCENES)
    fail("E_TEMPLATE", "Unsupported scene count");
  const elements = [];
  const collect = (element, sceneId, depth) => {
    for (const child of element.children) {
      collect(child, sceneId, depth + 1);
      elements.push({ element: child, sceneId, depth });
    }
  };
  const sceneTemplates = sections.map((section) => {
    const id = section.attributes["data-scene-id"];
    collect(section, id, 1);
    return specFromSection(document, section, elements.map((entry) => entry.element));
  });
  const total = sceneTemplates.reduce((sum, scene) => sum + scene.duration, 0);
  if (Math.abs((document.compositionDuration ?? 0) - total) > 1e-6)
    fail("E_TEMPLATE", "Root duration does not match scene durations");
  return {
    width: document.width,
    height: document.height,
    fps: FPS,
    duration: document.compositionDuration,
    scenes: sceneTemplates,
    elements: elements.map(({ element, sceneId }) => ({
      stableId: element.scopedId,
      sceneId,
      tag: element.tag,
      text: element.text,
      timing: {
        start: element.start,
        duration:
          element.attributes["data-duration"] !== undefined
            ? Number(element.attributes["data-duration"])
            : element.duration,
      },
      capabilities: capabilities(element),
    })),
    rootAttributes: root.attributes,
  };
}

export function capabilities(element) {
  const caps = [];
  if (
    ["h1", "h2", "h3", "h4", "p", "span", "div"].includes(element.tag) &&
    !element.children.length
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

export function validateDocumentHtml(html, { expectedScenes } = {}) {
  const document = buildDocument(html);
  if (!(document.width > 0 && document.width <= 3840))
    fail("E_TEMPLATE", "Unsupported width");
  if (!(document.height > 0 && document.height <= 2160))
    fail("E_TEMPLATE", "Unsupported height");
  if (!(document.compositionDuration > 0 && document.compositionDuration <= MAX_DURATION))
    fail("E_TEMPLATE", "Unsupported duration");
  const parsed = parseDocument(html);
  const ids = parsed.elements.map((element) => element.stableId);
  if (new Set(ids).size !== ids.length)
    fail("E_TEMPLATE", "Duplicate stable ids");
  if (expectedScenes !== undefined) {
    const current = parsed.scenes.map((scene) => scene.sceneId).sort();
    const expected = [...expectedScenes].sort();
    if (JSON.stringify(current) !== JSON.stringify(expected))
      fail("E_TEMPLATE", "Scene set does not match requested operation");
  }
  if (Math.abs(parsed.duration - document.compositionDuration) > 1e-6)
    fail("E_TEMPLATE", "Duration mismatch");
  return parsed;
}

export function sceneSummary(scene) {
  return {
    sceneId: scene.sceneId,
    order: scene.order ?? 0,
    start: scene.start ?? 0,
    duration: scene.duration,
    title: scene.title,
  };
}

export function sceneSummaries(parsed) {
  let order = 0;
  let start = 0;
  return parsed.scenes.map((scene) => {
    const summary = {
      sceneId: scene.sceneId,
      order,
      start,
      duration: scene.duration,
      title: scene.title,
    };
    order += 1;
    start = Math.round((start + scene.duration) * 1000) / 1000;
    return summary;
  });
}

export { PALETTE, FPS };
