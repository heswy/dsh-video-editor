// Controlled layout/style model for direct manipulation edits (P3-006-B).
//
// Single source of truth: the project HTML's inline style attributes. There is
// no second override database and no hidden metadata:
// - `inspect` parses the managed properties from each supported template leaf;
// - layout/style edit ops rewrite those inline styles in the same authoritative
//   HTML that carries revision/history/snapshot/render;
// - scene.project regeneration transplants existing manual overrides onto the
//   freshly generated document (see projects.mjs), so AI/scene operations do not
//   silently drop human layout adjustments.
//
// All values are static base layout in composition CSS pixels, never the
// animated getBoundingClientRect and never a transform.
import { fail } from "./errors.mjs";

export const LAYOUT_PROPS = ["left", "top", "width", "height"];
export const STYLE_PROPS = ["color", "fontSize", "fontWeight", "textAlign"];
export const LAYOUT_UNIT = "composition-px";
// Controlled override representation carried in the authoritative HTML: a
// space-separated list of managed properties that were explicitly set by an
// edit op (not inherited from the template default). This is what distinguishes
// "human picked a value equal to the current template default" from "template
// default", so a later scene-level change cannot silently rewrite human choice.
export const OVERRIDE_ATTRIBUTE = "data-dv-managed";
export const MAX_CANVAS_WIDTH = 3840;
export const MAX_CANVAS_HEIGHT = 2160;
const COLOR = /^#[0-9a-fA-F]{6}$/;
const TEXT_ALIGN = ["left", "center", "right"];
const PX = /^(-?(?:\d+(?:\.\d+)?|\.\d+))px$/;

// Supported controlled-template leaves. The tag check keeps the capability
// tied to the template shape instead of granting layout to arbitrary DOM.
const LAYOUT_SUFFIX = new Map([
  ["title", "h1"],
  ["subtitle", "p"],
  ["badge", "div"],
  ["rule", "div"],
  ["logo", "img"],
  ["shot", "img"],
]);
const STYLE_SUFFIX = new Set(["title", "subtitle", "badge"]);

export function round3(value) {
  return Math.round(value * 1000) / 1000;
}

export function formatPx(value) {
  return `${round3(value)}px`;
}

export function formatNumber(value) {
  return String(round3(value));
}

const MANAGED_KEYS = new Set([...LAYOUT_PROPS, ...STYLE_PROPS]);

export function parseOverrideAttribute(value) {
  if (typeof value !== "string") return null;
  const tokens = value.trim().split(/\s+/).filter(Boolean);
  return new Set(tokens.filter((token) => MANAGED_KEYS.has(token)));
}

export function formatOverrideAttribute(properties) {
  return [...properties].filter((key) => MANAGED_KEYS.has(key)).sort().join(" ");
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function finiteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

export function parsePx(value) {
  if (typeof value !== "string") return null;
  const match = PX.exec(value.trim());
  if (!match) return null;
  const number = Number(match[1]);
  return Number.isFinite(number) ? round3(number) : null;
}

export function parseColor(value) {
  return typeof value === "string" && COLOR.test(value)
    ? value.toLowerCase()
    : null;
}

export function parseFontWeight(value) {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const number = Number(value);
  if (!Number.isInteger(number) || number < 100 || number > 900 || number % 100 !== 0)
    return null;
  return number;
}

export function parseTextAlign(value) {
  return typeof value === "string" && TEXT_ALIGN.includes(value) ? value : null;
}

/**
 * Capability descriptor for a template leaf. Returns null for the composition
 * root, scene sections, nested/unknown elements and non-template projects.
 */
export function templateElementInfo({ stableId, tag, parentId, sceneId }) {
  if (
    typeof stableId !== "string" ||
    typeof tag !== "string" ||
    typeof sceneId !== "string" ||
    !sceneId
  )
    return null;
  const prefix = `${sceneId}-`;
  if (!stableId.startsWith(prefix)) return null;
  const suffix = stableId.slice(prefix.length);
  const expectedTag = LAYOUT_SUFFIX.get(suffix);
  if (!expectedTag || expectedTag !== tag) return null;
  if (parentId !== `${sceneId}-section`) return null;
  const style = STYLE_SUFFIX.has(suffix);
  return {
    suffix,
    sceneId,
    layout: true,
    style,
    capabilities: style ? ["layout", "style"] : ["layout"],
  };
}

/** Normalize the managed layout/style subset of an inline style object. */
export function managedValues(inlineStyles, info) {
  if (!info) return { layout: null, style: null };
  const styles = isObject(inlineStyles) ? inlineStyles : {};
  const layout = info.layout
    ? {
        left: parsePx(styles.left),
        top: parsePx(styles.top),
        width: parsePx(styles.width),
        height: parsePx(styles.height),
      }
    : null;
  const style = info.style
    ? {
        color: parseColor(styles.color),
        fontSize: parsePx(styles.fontSize),
        fontWeight: parseFontWeight(styles.fontWeight),
        textAlign: parseTextAlign(styles.textAlign),
      }
    : null;
  return { layout, style };
}

/** Validate + normalize one layout op patch (allows partial patches). */
export function validateLayoutPatch(patch) {
  if (!isObject(patch)) fail("E_PARAMS", "layout.box must be an object");
  const keys = Object.keys(patch);
  if (!keys.length) fail("E_PARAMS", "layout.box must not be empty");
  const normalized = {};
  for (const key of keys) {
    if (!LAYOUT_PROPS.includes(key))
      fail("E_PARAMS", `Unsupported layout box field ${key}`);
    const value = patch[key];
    if (!finiteNumber(value))
      fail("E_PARAMS", `layout.box.${key} must be a finite number`);
    if (key === "left" || key === "top") {
      if (value < 0) fail("E_PARAMS", `layout.box.${key} must not be negative`);
      if (value > Math.max(MAX_CANVAS_WIDTH, MAX_CANVAS_HEIGHT))
        fail("E_PARAMS", `layout.box.${key} is outside the canvas range`);
    } else {
      if (value < 1) fail("E_PARAMS", `layout.box.${key} must be at least 1px`);
      if (value > Math.max(MAX_CANVAS_WIDTH, MAX_CANVAS_HEIGHT))
        fail("E_PARAMS", `layout.box.${key} exceeds the canvas size`);
    }
    normalized[key] = round3(value);
  }
  return normalized;
}

/** Validate + normalize one style op patch. */
export function validateStylePatch(styles) {
  if (!isObject(styles)) fail("E_PARAMS", "style.styles must be an object");
  const keys = Object.keys(styles);
  if (!keys.length) fail("E_PARAMS", "style.styles must not be empty");
  const normalized = {};
  for (const key of keys) {
    const value = styles[key];
    if (key === "color") {
      if (typeof value !== "string" || !COLOR.test(value))
        fail("E_PARAMS", "style.color must be #RRGGBB");
      normalized.color = value.toLowerCase();
    } else if (key === "fontSize") {
      if (!finiteNumber(value) || value < 8 || value > 256)
        fail("E_PARAMS", "style.fontSize must be a number in [8,256]");
      normalized.fontSize = round3(value);
    } else if (key === "fontWeight") {
      if (
        typeof value !== "number" ||
        !Number.isInteger(value) ||
        value < 100 ||
        value > 900 ||
        value % 100 !== 0
      )
        fail("E_PARAMS", "style.fontWeight must be 100..900 in steps of 100");
      normalized.fontWeight = value;
    } else if (key === "textAlign") {
      if (!TEXT_ALIGN.includes(value))
        fail("E_PARAMS", "style.textAlign must be left/center/right");
      normalized.textAlign = value;
    } else {
      fail("E_PARAMS", `Unsupported style property ${key}`);
    }
  }
  return normalized;
}

/** SDK setStyle patch (camelCase keys, px units) for a normalized box. */
export function layoutToSdkStyles(box) {
  const styles = {};
  for (const key of LAYOUT_PROPS)
    if (box[key] !== undefined && box[key] !== null)
      styles[key] = formatPx(box[key]);
  return styles;
}

export function styleToSdkStyles(styles) {
  const sdk = {};
  if (styles.color !== undefined) sdk.color = styles.color;
  if (styles.fontSize !== undefined) sdk.fontSize = formatPx(styles.fontSize);
  if (styles.fontWeight !== undefined) sdk.fontWeight = String(styles.fontWeight);
  if (styles.textAlign !== undefined) sdk.textAlign = styles.textAlign;
  return sdk;
}

/** Current managed box merged with a validated patch (for bounds checks). */
export function mergedLayout(current, patch) {
  const next = {};
  for (const key of LAYOUT_PROPS) {
    const value = patch[key] !== undefined ? patch[key] : current?.[key];
    next[key] = value === undefined ? null : value;
  }
  return next;
}

/**
 * Validate the effective box against the composition canvas when sizes are
 * known. Auto/unknown dimensions are not invented: an unknown width/height
 * simply skips the combined check (documented v1 behavior).
 */
export function validateLayoutBounds(box, canvas) {
  const { width: canvasWidth, height: canvasHeight } = canvas;
  if (box.left !== null && box.left > canvasWidth)
    fail("E_PARAMS", "layout left is outside the composition");
  if (box.top !== null && box.top > canvasHeight)
    fail("E_PARAMS", "layout top is outside the composition");
  if (box.width !== null && box.width > canvasWidth)
    fail("E_PARAMS", "layout width exceeds the composition width");
  if (box.height !== null && box.height > canvasHeight)
    fail("E_PARAMS", "layout height exceeds the composition height");
  if (
    box.left !== null &&
    box.width !== null &&
    box.left + box.width > canvasWidth + 1e-9
  )
    fail("E_PARAMS", "layout left+width exceeds the composition width");
  if (
    box.top !== null &&
    box.height !== null &&
    box.top + box.height > canvasHeight + 1e-9
  )
    fail("E_PARAMS", "layout top+height exceeds the composition height");
}

/**
 * Manual (non-template-default) managed overrides in a parsed document.
 * `different` is the same document regenerated from its own scene model, so a
 * property counts as overridden only when it differs from the template default.
 * Only non-null values are represented (v1 patches cannot clear a property).
 */
export function collectManualOverrides(parsed, defaultParsed) {
  const defaults = new Map();
  for (const element of defaultParsed.elements) {
    const info = templateElementInfo(element);
    if (!info) continue;
    defaults.set(element.stableId, managedValues(element.inlineStyles, info));
  }
  const overrides = new Map();
  for (const element of parsed.elements) {
    const info = templateElementInfo(element);
    if (!info) continue;
    const current = managedValues(element.inlineStyles, info);
    const base = defaults.get(element.stableId);
    const marked = parseOverrideAttribute(element.attributes?.[OVERRIDE_ATTRIBUTE]);
    const layout = {};
    const style = {};
    let has = false;
    for (const key of LAYOUT_PROPS) {
      const value = current.layout?.[key];
      if (value === null || value === undefined) continue;
      // With the explicit marker, a property is an override even when its value
      // equals the current template default. Files without the marker (written
      // by external tools/older flows) keep the diff-vs-default fallback.
      const changed = marked ? marked.has(key) : base?.layout?.[key] !== value;
      if (changed) {
        layout[key] = value;
        has = true;
      }
    }
    for (const key of STYLE_PROPS) {
      const value = current.style?.[key];
      if (value === null || value === undefined) continue;
      const changed = marked ? marked.has(key) : base?.style?.[key] !== value;
      if (changed) {
        style[key] = value;
        has = true;
      }
    }
    if (has) overrides.set(element.stableId, { layout, style, info });
  }
  return overrides;
}

/** true when the element carries any manual managed override. */
export function overrideSummary(overrides) {
  return [...overrides.entries()].map(([stableId, entry]) => ({
    stableId,
    sceneId: entry.info?.sceneId ?? null,
    layout: Object.keys(entry.layout),
    style: Object.keys(entry.style),
  }));
}
