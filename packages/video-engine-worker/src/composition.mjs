// Validation for `project.compose`: one complete, self-contained HTML
// composition is published atomically only after every rule below passes.
//
// The module is the single authority for the composition contract. It checks
// the submitted document bytes, the document structure the fixed preview
// runtime needs (#main + data-* timing), the timeline exposure
// (window.__timelines = { main }), the self-contained-reference rule (declared
// project assets only, no external fetch surfaces), and finally the real SDK
// round-trip used by inspect/frame/render: `openComposition(html)` must open and
// `buildDocument(comp.serialize())` must give finite width/height/duration
// inside the supported ranges. `comp.dispose()` always runs.
import { buildDocument, openComposition } from "@hyperframes/sdk";
import { fail } from "./errors.mjs";
import { capabilities } from "./scenes.mjs";

// `project.source` must keep one Tool result under the 64 KiB budget, so the
// HTML ceiling is a protocol constant shared by the Host (host/limits.js).
export const MAX_COMPOSITION_BYTES = 48 * 1024;
export const MIN_COMPOSITION_WIDTH = 320;
export const MAX_COMPOSITION_WIDTH = 3840;
export const MIN_COMPOSITION_HEIGHT = 180;
export const MAX_COMPOSITION_HEIGHT = 2160;
export const MIN_COMPOSITION_DURATION = 0.1;
export const MAX_COMPOSITION_DURATION = 3600;
// Model-facing prompt facts only ever use a bounded target list.
export const MAX_COMPOSITION_ELEMENTS = 40;

const FORBIDDEN_TAGS = [
  "iframe",
  "object",
  "embed",
  "base",
  "link",
  "video",
  "audio",
  "source",
  "track",
];
const FORBIDDEN_TAG = new RegExp(`<(${FORBIDDEN_TAGS.join("|")})\\b`, "i");
const EXTERNAL_URL = /^(?:https?:|\/\/|file:|blob:|javascript:)/i;
// `src=`/`href=` including the legacy `xlink:href`, but not attributes that
// merely end in "href" such as `data-href`.
const ATTRIBUTE_REFERENCE =
  /(?<![\w.-])(?:xlink:)?(?:src|href)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/gi;
const CSS_URL = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)"']*?))\s*\)/gi;
// Accept `window.__timelines = { main: ... }` and
// `window["__timelines"] = { main: ... }`. The capture reaches the first `}`
// and only needs to contain a `main:`/`"main":` key, so nested object literals
// and multi-key maps are still accepted.
const TIMELINES_ASSIGNMENT =
  /window\s*(?:\.\s*__timelines|\[\s*["']__timelines["']\s*\])\s*=\s*\{([\s\S]*?)\}/g;
const TIMELINES_MAIN_KEY = /(?:^|[,{])\s*(?:main|["']main["'])\s*:/;

function invalid(message) {
  // Worker error messages are bounded by the protocol envelope (256 chars).
  fail("E_COMPOSE_INVALID", message, "compose");
}

function brief(value, max = 80) {
  const text = String(value);
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function declaredAssetsText(assets) {
  if (!assets.length) return "none declared";
  const shown = assets.slice(0, 4).map((name) => brief(name, 40));
  const suffix = assets.length > shown.length ? `, … (${assets.length} total)` : "";
  return shown.join(", ") + suffix;
}

function assertDocumentShape(html) {
  const starts = html.replace(/^\uFEFF/, "").trimStart();
  if (
    !/^<!doctype\s+html[\s>]/i.test(starts) &&
    !/^<html[\s>]/i.test(starts)
  )
    invalid(
      "Composition must be a complete HTML document: after optional whitespace it must start with <!doctype html> (or <html).",
    );
  if (!/<\/html\s*>/i.test(html))
    invalid("Composition must be a complete HTML document: a closing </html> tag is required.");
}

function assertNoFetchSurfaces(html) {
  const tag = FORBIDDEN_TAG.exec(html);
  if (tag)
    invalid(
      `Composition must not contain <${tag[1].toLowerCase()}> or other external media/embedding elements; draw artwork with inline SVG/HTML/CSS.`,
    );
}

function checkReference(value, declared) {
  // `#gradient` and similar same-document references do not fetch anything and
  // are normal inline-SVG usage.
  if (value.startsWith("#")) return;
  if (EXTERNAL_URL.test(value))
    invalid(
      `Composition must not reference external URLs; found "${brief(value)}" in a src/href/url() position. Use only declared local project assets.`,
    );
  const normalized = value.replace(/^\.\//, "");
  if (declared.includes(normalized)) return;
  invalid(
    `Composition references "${brief(value)}", which is not a declared project asset. Currently declared assets: ${declaredAssetsText(declared)}.`,
  );
}

function assertDeclaredReferences(html, declared) {
  for (const match of html.matchAll(ATTRIBUTE_REFERENCE)) {
    const value = (match[1] ?? match[2] ?? match[3] ?? "").trim();
    if (value) checkReference(value, declared);
  }
  for (const match of html.matchAll(CSS_URL)) {
    const value = (match[1] ?? match[2] ?? match[3] ?? "").trim();
    if (value) checkReference(value, declared);
  }
}

function documentModel(html) {
  try {
    return buildDocument(html);
  } catch {
    invalid(
      "Composition could not be parsed as an HTML document by the video SDK; submit one complete well-formed document.",
    );
  }
}

function mainElements(document) {
  const found = [];
  const visit = (node) => {
    if (!node) return;
    if (node.attributes?.id === "main") found.push(node);
    for (const child of node.children ?? []) visit(child);
  };
  for (const root of document.roots ?? []) visit(root);
  return found;
}

function numericAttribute(attributes, name, min, max) {
  const raw = attributes[name];
  const value =
    typeof raw === "string" && raw.trim() !== "" ? Number(raw) : Number.NaN;
  if (!Number.isFinite(value) || value < min || value > max)
    invalid(
      `#main must carry a numeric ${name} inside ${min}..${max} (got ${
        raw === undefined ? "nothing" : `"${brief(raw, 40)}"`
      }).`,
    );
}

function assertMain(html) {
  const mains = mainElements(documentModel(html));
  if (mains.length !== 1)
    invalid(
      `Composition must contain exactly one element with id="main"; found ${mains.length}.`,
    );
  const attributes = mains[0].attributes ?? {};
  const compositionId = attributes["data-composition-id"];
  if (typeof compositionId !== "string" || compositionId.trim() === "")
    invalid(
      '#main must carry a non-empty data-composition-id attribute (for example data-composition-id="main").',
    );
  numericAttribute(attributes, "data-width", MIN_COMPOSITION_WIDTH, MAX_COMPOSITION_WIDTH);
  numericAttribute(attributes, "data-height", MIN_COMPOSITION_HEIGHT, MAX_COMPOSITION_HEIGHT);
  numericAttribute(attributes, "data-duration", MIN_COMPOSITION_DURATION, MAX_COMPOSITION_DURATION);
}

function assertTimelineExposure(html) {
  for (const match of html.matchAll(TIMELINES_ASSIGNMENT))
    if (TIMELINES_MAIN_KEY.test(match[1])) return;
  invalid(
    'Composition must expose the preview timeline: a script must assign window.__timelines = { main: <gsap timeline> } (window["__timelines"] is also accepted).',
  );
}

async function sdkRoundTrip(html) {
  let comp;
  try {
    comp = await openComposition(html);
  } catch {
    invalid(
      "The video SDK could not open the composition; check that the document is well-formed and complete.",
    );
  }
  try {
    let document;
    try {
      document = buildDocument(comp.serialize());
    } catch {
      invalid("The video SDK could not build a document from the composition.");
    }
    const { width, height, compositionDuration: duration } = document;
    if (
      !Number.isFinite(width) ||
      width < MIN_COMPOSITION_WIDTH ||
      width > MAX_COMPOSITION_WIDTH ||
      !Number.isFinite(height) ||
      height < MIN_COMPOSITION_HEIGHT ||
      height > MAX_COMPOSITION_HEIGHT ||
      !Number.isFinite(duration) ||
      duration < MIN_COMPOSITION_DURATION ||
      duration > MAX_COMPOSITION_DURATION
    )
      invalid(
        "The validated composition size/duration is outside the supported range: width 320..3840, height 180..2160, duration 0.1..3600s.",
      );
    const elements = comp
      .getElements()
      .slice(0, MAX_COMPOSITION_ELEMENTS)
      .map((element) => ({
        stableId: element.scopedId,
        capabilities: capabilities(element),
      }));
    return { width, height, duration, elements };
  } finally {
    comp.dispose();
  }
}

/**
 * Validate one submitted composition document.
 *
 * @param {{html: string, assets?: string[]}} input `assets` is the project
 *   manifest's declared asset list (relative paths).
 * @returns {Promise<{bytes:number,width:number,height:number,duration:number,
 *   elements:{stableId:string,capabilities:string[]}[]}>}
 *   Throws `E_COMPOSE_INVALID` (stage `"compose"`) on any contract violation.
 */
export async function validateComposition({ html, assets = [] }) {
  const declared = Array.isArray(assets) ? assets : [];
  const bytes = Buffer.byteLength(html, "utf8");
  if (bytes < 1 || bytes > MAX_COMPOSITION_BYTES)
    invalid(
      `Composition is ${bytes} UTF-8 bytes; the contract allows 1..${MAX_COMPOSITION_BYTES} bytes (48 KiB).`,
    );
  if (html.includes("\0"))
    invalid("Composition must not contain NUL bytes.");
  assertDocumentShape(html);
  assertNoFetchSurfaces(html);
  assertDeclaredReferences(html, declared);
  assertMain(html);
  assertTimelineExposure(html);
  const validated = await sdkRoundTrip(html);
  return { bytes, ...validated };
}
