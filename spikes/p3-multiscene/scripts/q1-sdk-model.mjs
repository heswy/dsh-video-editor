import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { artifacts, evidenceDir, writeJson } from "./lib/util.mjs";
import { documentModel, sceneSections } from "./lib/doc.mjs";

const work = resolve(artifacts, "q1");
const result = { generatedAt: new Date().toISOString(), node: process.version, structures: {} };

async function probe(label, file) {
  const html = await readFile(file, "utf8");
  const model = documentModel(html);
  return {
    label,
    elementCount: model.elements.length,
    stableIds: model.elements.map((element) => element.id).slice(0, 12),
    sceneIds: model.elements
      .filter((element) => element.tag === "section" && element.attributes["data-scene-id"])
      .map((element) => element.attributes["data-scene-id"]),
    duration: model.duration,
    width: model.width,
    height: model.height,
    sceneSections: sceneSections(html).map((section) => section.sceneId),
    edges: model.elements.filter((element) => element.depth > 2).length,
  };
}

result.structures.A_root = await probe("A-root", resolve(work, "A-nested/index.html"));
result.structures.A_scene1 = await probe("A-scene1", resolve(work, "A-nested/compositions/scene-1.html"));
result.structures.B_root = await probe("B-root", resolve(work, "B-single-doc/index.html"));
await writeJson(resolve(evidenceDir, "q1-sdk-model.json"), result);
console.log(JSON.stringify(result, null, 2));
