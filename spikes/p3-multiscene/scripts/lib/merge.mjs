import {
  documentModel,
  otherSectionsUnchanged,
  replaceSectionHtml,
  sceneElementSnapshots,
  sceneSections,
  sectionMeta,
  sameSectionMeta,
  serializeScene,
  validateDocument,
} from "./doc.mjs";

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

function mapScene(model, sceneId) {
  const { section, descendants } = sceneElementSnapshots(model, sceneId);
  const map = new Map(descendants.map((element) => [element.id, element]));
  return { section, map };
}

// Three-way merge for one template-constrained scene. Base is the revision the
// AI candidate was generated from, human is the current file, ai is the
// candidate rewrite. Only text/timing/attribute/presence changes on stable ids
// are auto-merged; tag/parent/order/nesting/scene-meta changes are reported as
// manual coordination cases.
export function mergeElementMaps(sceneId, base, human, ai) {
  const conflicts = [];
  const unsupported = [];
  const result = new Map();

  // A pure presence change shifts sibling sequence indexes, so reordering has
  // to be detected on the filtered common-id sequence instead of on `order`.
  const commonInAi = [...base.keys()].filter((id) => ai.has(id));
  const aiCommon = [...ai.keys()].filter((id) => base.has(id));
  if (JSON.stringify(commonInAi) !== JSON.stringify(aiCommon))
    conflicts.push({
      sceneId,
      stableId: null,
      reason: "STRUCTURAL_ORDER",
      human: null,
      ai: null,
      hint: "AI reordered existing objects; scene/object order changes need explicit coordination",
    });

  const baseOrder = [...base.keys()];
  const humanOrder = [...human.keys()];
  const aiOrder = [...ai.keys()];
  const ordered = [...new Set([...baseOrder, ...humanOrder, ...aiOrder])];

  for (const id of ordered) {
    const b = base.get(id);
    const h = human.get(id);
    const a = ai.get(id);
    if (b) {
      if (h && a) {
        const structural = [
          h.tag !== b.tag || a.tag !== b.tag ? "STRUCTURAL_TAG" : null,
          h.parentId !== b.parentId || a.parentId !== b.parentId
            ? "STRUCTURAL_PARENT"
            : null,
          h.depth !== b.depth || a.depth !== b.depth
            ? "STRUCTURAL_NESTING"
            : null,
        ].filter(Boolean);
        if (structural.length) {
          conflicts.push({
            sceneId,
            stableId: id,
            reason: structural[0],
            human: summary(h),
            ai: summary(a),
          });
          continue;
        }
        const hc = signature(h) !== signature(b);
        const ac = signature(a) !== signature(b);
        if (hc && ac) {
          if (signature(h) === signature(a)) result.set(id, h);
          else
            conflicts.push({
              sceneId,
              stableId: id,
              reason: "BOTH_MODIFIED",
              human: summary(h),
              ai: summary(a),
            });
        } else if (hc) result.set(id, h);
        else if (ac) result.set(id, a);
        else result.set(id, h);
      } else if (h && !a) {
        // AI deleted the element. It may only be removed if the human did not
        // change it in the same revision.
        if (signature(h) === signature(b)) {
          // deletion accepted
        } else
          conflicts.push({
            sceneId,
            stableId: id,
            reason: "AI_DELETE_HUMAN_MODIFY",
            human: summary(h),
            ai: summary(a),
          });
      } else if (!h && a) {
        // Human deleted the element. It may only stay deleted if the AI did
        // not change it as well.
        if (signature(a) === signature(b)) {
          // human deletion wins
        } else
          conflicts.push({
            sceneId,
            stableId: id,
            reason: "HUMAN_DELETE_AI_MODIFY",
            human: summary(h),
            ai: summary(a),
          });
      }
      // both deleted: stays absent
    } else if (h && a) {
      if (signature(h) === signature(a)) result.set(id, h);
      else
        conflicts.push({
          sceneId,
          stableId: id,
          reason: "ADD_ADD",
          human: summary(h),
          ai: summary(a),
        });
    } else if (h) {
      result.set(id, h); // human addition is preserved
    } else if (a) {
      result.set(id, a); // AI addition is adopted
    }
  }

  const structuralNesting = [...result.values()].some(
    (element) => element.depth > (base.get(element.id) ?? human.get(element.id) ?? element).depth + 1,
  );
  if (structuralNesting)
    unsupported.push("nested element depth cannot be serialized by this spike");

  return { result, conflicts, unsupported };
}

export async function mergeDocument({
  sceneId,
  baseHtml,
  humanHtml,
  aiHtml,
}) {
  const [baseModel, humanModel, aiModel] = await Promise.all([
    documentModel(baseHtml),
    documentModel(humanHtml),
    documentModel(aiHtml),
  ]);
  const base = mapScene(baseModel, sceneId);
  const human = mapScene(humanModel, sceneId);
  const ai = mapScene(aiModel, sceneId);

  // A scene content merge may not silently restructure the rest of the
  // document: AI candidates must change only the requested scene, and the
  // scene order itself is a document-level operation.
  const baseSceneIds = sceneSections(baseHtml).map((section) => section.sceneId);
  const aiSceneIds = sceneSections(aiHtml).map((section) => section.sceneId);
  if (JSON.stringify(baseSceneIds) !== JSON.stringify(aiSceneIds))
    return {
      ok: false,
      conflicts: [
        {
          sceneId: null,
          stableId: null,
          reason: "STRUCTURAL_ORDER",
          human: null,
          ai: { sceneOrder: aiSceneIds },
          hint: "AI reordered whole scenes; scene reorder is an explicit scene operation",
        },
      ],
      unsupported: [],
    };
  for (const otherSceneId of baseSceneIds.filter((id) => id !== sceneId)) {
    const before = mapScene(baseModel, otherSceneId);
    const after = mapScene(aiModel, otherSceneId);
    const digest = (map) => JSON.stringify([...map.map.entries()].map(([id, element]) => [id, signature(element)]));
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
            hint: "AI candidate changed a scene that was not requested; this needs a separate scene operation",
          },
        ],
        unsupported: [],
      };
  }

  if (
    !sameSectionMeta(base.section, human.section) ||
    !sameSectionMeta(base.section, ai.section)
  )
    return {
      ok: false,
      conflicts: [
        {
          sceneId,
          stableId: human.section.id,
          reason: "SCENE_META_CHANGED",
          human: summary(human.section),
          ai: summary(ai.section),
          hint: "Scene start/duration/order changes need an explicit scene operation, not a content merge",
        },
      ],
      unsupported: [],
    };

  const { result, conflicts, unsupported } = mergeElementMaps(
    sceneId,
    base.map,
    human.map,
    ai.map,
  );
  if (conflicts.length) return { ok: false, conflicts, unsupported };

  // Keep the human document order for existing elements; append human/AI
  // additions in their own order after the existing ones.
  const existingOrder = [...human.map.keys()].filter((id) => result.has(id));
  const addedIds = [...result.keys()].filter((id) => !human.map.has(id));
  const ordered = [...existingOrder, ...addedIds];
  const section = human.section;
  const synthetic = {
    elements: [
      section,
      ...ordered.map((id, index) => ({
        ...result.get(id),
        parentId: section.id,
        depth: section.depth + 1,
        order: index,
      })),
    ],
    width: humanModel.width,
    height: humanModel.height,
    duration: humanModel.duration,
  };
  const serialized = serializeScene(synthetic, sceneId);
  if (!serialized.ok) return { ok: false, conflicts: [], unsupported: [serialized.error] };

  const mergedHtml = replaceSectionHtml(humanHtml, sceneId, serialized.html);
  const validation = await validateDocument(mergedHtml, {
    width: humanModel.width,
    height: humanModel.height,
    duration: humanModel.duration,
    sceneIds: sceneSections(humanHtml).map((sectionInfo) => sectionInfo.sceneId),
  });
  if (!validation.ok)
    return { ok: false, conflicts: [], unsupported: validation.errors };

  const sectionIds = sceneSections(humanHtml).map((item) => item.sceneId);
  return {
    ok: true,
    html: mergedHtml,
    conflicts: [],
    unsupported: [],
    mergedSectionHtml: serialized.html,
    elementCount: result.size,
    added: [...result.keys()].filter((id) => !base.map.has(id)),
    removed: [...base.map.keys()].filter((id) => !result.has(id)),
    otherSections: otherSectionsUnchanged(
      humanHtml,
      mergedHtml,
      sectionIds.filter((id) => id !== sceneId),
    ),
    validation: { width: validation.model.width, height: validation.model.height, duration: validation.model.duration },
  };
}
