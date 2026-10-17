import { buildDocument } from "@hyperframes/sdk";
import { fail } from "./errors.mjs";
import { validateDocumentHtml } from "./scenes.mjs";

function snapshot(element, parentId, depth, sceneId, order) {
  return {
    stableId: element.scopedId,
    tag: element.tag,
    childTag: undefined,
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
    childCount: element.children.length,
  };
}

export function modelOf(html) {
  const document = buildDocument(html);
  const root = document.roots[0];
  if (!root) fail("E_TEMPLATE", "Composition root is missing");
  const elements = [];
  const walk = (element, parentId, depth, inheritedSceneId, order) => {
    const sceneId = element.attributes["data-scene-id"] ?? inheritedSceneId ?? null;
    elements.push(snapshot(element, parentId, depth, sceneId, order));
    element.children.forEach((child, index) =>
      walk(child, element.scopedId, depth + 1, sceneId, index),
    );
  };
  walk(root, null, 0, null, 0);
  return {
    width: document.width,
    height: document.height,
    duration: document.compositionDuration,
    elements,
    html,
  };
}

function signature(element) {
  return JSON.stringify({
    tag: element.tag,
    text: element.text,
    start: element.start,
    duration: element.duration,
    attributes: element.attributes,
    classNames: element.classNames,
    inlineStyles: element.inlineStyles,
    parentId: element.parentId,
    depth: element.depth,
  });
}

function summary(element) {
  if (!element) return { present: false };
  return {
    present: true,
    text: element.text,
    timing: { start: element.start, duration: element.duration },
    tag: element.tag,
  };
}

function sectionOf(model, sceneId) {
  return model.elements.find(
    (element) =>
      element.tag === "section" &&
      element.attributes["data-scene-id"] === sceneId,
  );
}

function childrenOf(model, parentId) {
  return model.elements
    .filter((element) => element.parentId === parentId)
    .sort((left, right) => left.order - right.order);
}

function sceneMap(model, sceneId) {
  const section = sectionOf(model, sceneId);
  if (!section) return null;
  const map = new Map();
  const walk = (parentId) => {
    for (const child of childrenOf(model, parentId)) {
      map.set(child.stableId, child);
      walk(child.stableId);
    }
  };
  walk(section.stableId);
  return { section, map };
}

function sceneMeta(section) {
  return {
    sceneId: section.attributes["data-scene-id"],
    order: Number(section.attributes["data-scene-order"] ?? 0),
    start: Number(section.attributes["data-start"] ?? 0),
    duration: Number(section.attributes["data-duration"] ?? 0),
  };
}

function sameMeta(left, right) {
  return JSON.stringify(sceneMeta(left)) === JSON.stringify(sceneMeta(right));
}

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

function escapeText(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

const VOID_TAGS = new Set(["img", "br", "hr", "source"]);

function serializeElement(element, childrenHtml = "") {
  const attributes = [];
  if (element.attributes.id !== undefined)
    attributes.push(`id="${escapeAttribute(element.attributes.id)}"`);
  attributes.push(`data-hf-id="${escapeAttribute(element.stableId)}"`);
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

function serializeSection(section, elements) {
  const ordered = [...elements];
  const render = (parentId, depth) => {
    const children = ordered
      .filter((element) => element.parentId === parentId)
      .sort((left, right) => left.order - right.order);
    return children
      .map((child) => {
        const grandchildren = render(child.stableId, depth + 1);
        return serializeElement(child, grandchildren);
      })
      .join("\n");
  };
  const body = render(section.stableId, 1);
  return `<section ${attributesForSection(section)}>\n${body}\n  </section>`;
}

function attributesForSection(section) {
  const attributes = [];
  if (section.attributes.id !== undefined)
    attributes.push(`id="${escapeAttribute(section.attributes.id)}"`);
  attributes.push(`data-hf-id="${escapeAttribute(section.stableId)}"`);
  attributes.push(
    `data-scene-id="${escapeAttribute(section.attributes["data-scene-id"])}"`,
    `data-scene-order="${escapeAttribute(section.attributes["data-scene-order"] ?? "0")}"`,
    `data-start="${escapeAttribute(section.attributes["data-start"] ?? "0")}"`,
    `data-duration="${escapeAttribute(section.attributes["data-duration"] ?? "0")}"`,
  );
  const styles = Object.entries(section.inlineStyles)
    .map(([name, value]) => `${kebab(name)}:${value}`)
    .join(";");
  if (styles) attributes.push(`style="${escapeAttribute(styles)}"`);
  for (const [name, value] of Object.entries(section.attributes)) {
    if (
      ["id", "class", "style", "data-scene-id", "data-scene-order", "data-start", "data-duration"].includes(
        name,
      ) ||
      name.startsWith("data-hf-")
    )
      continue;
    attributes.push(`${name}="${escapeAttribute(value)}"`);
  }
  return attributes.join(" ");
}

function sceneSectionText(html, sceneId) {
  const pattern = new RegExp(
    `<section\\b[^>]*data-scene-id="${sceneId}"[^>]*>[\\s\\S]*?</section>`,
  );
  const match = html.match(pattern);
  if (!match) fail("E_TEMPLATE", "Scene section is missing from document");
  return match[0];
}

function replaceSection(html, sceneId, replacement) {
  const pattern = new RegExp(
    `<section\\b[^>]*data-scene-id="${sceneId}"[^>]*>[\\s\\S]*?</section>`,
  );
  if (!pattern.test(html)) fail("E_TEMPLATE", "Scene section is missing from document");
  return html.replace(pattern, replacement);
}

export function mergeSceneDocuments({ sceneId, baseHtml, humanHtml, aiHtml }) {
  const base = modelOf(baseHtml);
  const human = modelOf(humanHtml);
  const ai = modelOf(aiHtml);
  const baseScene = sectionOf(base, sceneId);
  const humanScene = sectionOf(human, sceneId);
  const aiScene = sectionOf(ai, sceneId);
  if (!baseScene || !humanScene || !aiScene)
    return {
      ok: false,
      conflicts: [
        {
          sceneId,
          stableId: null,
          reason: "STRUCTURAL_OTHER_SCENE",
          human: null,
          ai: null,
          hint: "Scene is missing from one of the revisions",
        },
      ],
      unsupported: [],
    };

  const baseSceneIds = base.elements
    .filter((element) => element.tag === "section" && element.attributes["data-scene-id"])
    .map((element) => element.attributes["data-scene-id"]);
  const aiSceneIds = ai.elements
    .filter((element) => element.tag === "section" && element.attributes["data-scene-id"])
    .map((element) => element.attributes["data-scene-id"]);
  if (JSON.stringify(baseSceneIds) !== JSON.stringify(aiSceneIds))
    return {
      ok: false,
      conflicts: [
        {
          sceneId: null,
          stableId: null,
          reason: "STRUCTURAL_ORDER",
          human: null,
          ai: null,
          hint: "AI candidate reordered whole scenes",
        },
      ],
      unsupported: [],
    };

  if (!sameMeta(baseScene, aiScene) || !sameMeta(baseScene, humanScene))
    return {
      ok: false,
      conflicts: [
        {
          sceneId,
          stableId: humanScene.stableId,
          reason: "SCENE_META_CHANGED",
          human: summary(humanScene),
          ai: summary(aiScene),
          hint: "Scene start/duration/order changes need an explicit scene operation",
        },
      ],
      unsupported: [],
    };

  for (const otherSceneId of baseSceneIds.filter((id) => id !== sceneId)) {
    const before = sceneMap(base, otherSceneId);
    const after = sceneMap(ai, otherSceneId);
    const digest = (scene) =>
      JSON.stringify(
        [...scene.map.entries()].map(([id, element]) => [id, signature(element)]),
      );
    if (digest(before) !== digest(after))
      return {
        ok: false,
        conflicts: [
          {
            sceneId: otherSceneId,
            stableId: null,
            reason: "STRUCTURAL_OTHER_SCENE",
            human: null,
            ai: null,
            hint: "AI candidate changed a scene that was not requested",
          },
        ],
        unsupported: [],
      };
  }

  const baseMap = sceneMap(base, sceneId).map;
  const humanMap = sceneMap(human, sceneId).map;
  const aiMap = sceneMap(ai, sceneId).map;
  const conflicts = [];
  const result = new Map();
  const commonInAi = [...baseMap.keys()].filter((id) => aiMap.has(id));
  const aiCommon = [...aiMap.keys()].filter((id) => baseMap.has(id));
  if (JSON.stringify(commonInAi) !== JSON.stringify(aiCommon))
    conflicts.push({
      sceneId,
      stableId: null,
      reason: "STRUCTURAL_ORDER",
      human: null,
      ai: null,
      hint: "AI reordered existing objects",
    });

  const ordered = [...new Set([...baseMap.keys(), ...humanMap.keys(), ...aiMap.keys()])];
  for (const id of ordered) {
    const baseElement = baseMap.get(id);
    const humanElement = humanMap.get(id);
    const aiElement = aiMap.get(id);
    if (baseElement) {
      if (humanElement && aiElement) {
        const structural =
          humanElement.tag !== baseElement.tag || aiElement.tag !== baseElement.tag
            ? "STRUCTURAL_TAG"
            : humanElement.parentId !== baseElement.parentId ||
                aiElement.parentId !== baseElement.parentId
              ? "STRUCTURAL_PARENT"
              : humanElement.depth !== baseElement.depth ||
                  aiElement.depth !== baseElement.depth
                ? "STRUCTURAL_NESTING"
                : null;
        if (structural) {
          conflicts.push({
            sceneId,
            stableId: id,
            reason: structural,
            human: summary(humanElement),
            ai: summary(aiElement),
          });
          continue;
        }
        const humanChanged = signature(humanElement) !== signature(baseElement);
        const aiChanged = signature(aiElement) !== signature(baseElement);
        if (humanChanged && aiChanged) {
          if (signature(humanElement) === signature(aiElement)) result.set(id, humanElement);
          else
            conflicts.push({
              sceneId,
              stableId: id,
              reason: "BOTH_MODIFIED",
              human: summary(humanElement),
              ai: summary(aiElement),
            });
        } else if (humanChanged) result.set(id, humanElement);
        else if (aiChanged) result.set(id, aiElement);
        else result.set(id, humanElement);
      } else if (humanElement && !aiElement) {
        if (signature(humanElement) === signature(baseElement)) {
          // AI deletion accepted
        } else
          conflicts.push({
            sceneId,
            stableId: id,
            reason: "AI_DELETE_HUMAN_MODIFY",
            human: summary(humanElement),
            ai: summary(aiElement),
          });
      } else if (!humanElement && aiElement) {
        if (signature(aiElement) === signature(baseElement)) {
          // human deletion wins
        } else
          conflicts.push({
            sceneId,
            stableId: id,
            reason: "HUMAN_DELETE_AI_MODIFY",
            human: summary(humanElement),
            ai: summary(aiElement),
          });
      }
    } else if (humanElement && aiElement) {
      if (signature(humanElement) === signature(aiElement)) result.set(id, humanElement);
      else
        conflicts.push({
          sceneId,
          stableId: id,
          reason: "ADD_ADD",
          human: summary(humanElement),
          ai: summary(aiElement),
        });
    } else if (humanElement) result.set(id, humanElement);
    else if (aiElement) result.set(id, aiElement);
  }

  if (conflicts.length) return { ok: false, conflicts, unsupported: [] };

  const existingOrder = [...humanMap.keys()].filter((id) => result.has(id));
  const added = [...result.keys()].filter((id) => !humanMap.has(id));
  const orderedElements = [...existingOrder, ...added].map((id, index) => ({
    ...result.get(id),
    parentId: humanScene.stableId,
    depth: humanScene.depth + 1,
    order: index,
  }));
  // This spike/implementation merge supports one flat level below the section.
  if (orderedElements.some((element) => element.childCount > 0))
    return {
      ok: false,
      conflicts: [],
      unsupported: ["nested elements are not merge-serializable in v1"],
    };
  const section = { ...humanScene };
  section.childCount = orderedElements.length;
  const mergedSection = serializeSection(section, orderedElements);
  const mergedHtml = replaceSection(humanHtml, sceneId, mergedSection);
  try {
    validateDocumentHtml(mergedHtml);
  } catch (error) {
    return { ok: false, conflicts: [], unsupported: [error.message] };
  }
  const otherScenes = baseSceneIds
    .filter((id) => id !== sceneId)
    .map((id) => ({
      sceneId: id,
      unchanged: sceneSectionText(humanHtml, id) === sceneSectionText(mergedHtml, id),
    }));
  const changes = {
    adopted: [],
    kept: [],
    added,
    removed: [...baseMap.keys()].filter((id) => !result.has(id)),
  };
  for (const id of ordered) {
    const baseElement = baseMap.get(id);
    const humanElement = humanMap.get(id);
    const aiElement = aiMap.get(id);
    if (!baseElement) continue;
    const humanChanged = humanElement
      ? signature(humanElement) !== signature(baseElement)
      : true;
    const aiChanged = aiElement
      ? signature(aiElement) !== signature(baseElement)
      : true;
    if (aiChanged && humanChanged) changes.kept.push(id);
    else if (aiChanged) changes.adopted.push(id);
    else if (humanChanged) changes.kept.push(id);
  }
  return {
    ok: true,
    html: mergedHtml,
    conflicts: [],
    unsupported: [],
    changeSummary: {
      ...changes,
      otherScenes,
      mergedSectionBytes: Buffer.byteLength(mergedSection),
    },
  };
}
