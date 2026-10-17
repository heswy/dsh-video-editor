import { mkdir, copyFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../", import.meta.url));
const artifacts = resolve(root, "artifacts"),
  project = resolve(artifacts, "projects/demo");
await mkdir(resolve(project, "assets"), { recursive: true });
await copyFile(
  resolve(root, "fixtures/index.html"),
  resolve(project, "index.html"),
);
for (const file of ["gsap.min.js", "MotionPathPlugin.min.js"])
  await copyFile(
    resolve(root, "node_modules/gsap/dist", file),
    resolve(project, "assets", file),
  );
await copyFile(
  process.env.VIDEO_FONT_PATH || "/System/Library/Fonts/STHeiti Medium.ttc",
  resolve(project, "assets/Heiti.ttc"),
);
await writeFile(
  resolve(project, "project.json"),
  JSON.stringify(
    {
      entry: "index.html",
      assets: [
        "assets/gsap.min.js",
        "assets/MotionPathPlugin.min.js",
        "assets/Heiti.ttc",
      ],
    },
    null,
    2,
  ),
);
const registry = {
  root: resolve(artifacts, "projects"),
  projects: { demo: project },
  outputRoot: resolve(artifacts, "output"),
  ...(process.env.VIDEO_BROWSER_PATH
    ? { browserPath: process.env.VIDEO_BROWSER_PATH }
    : {}),
};
await writeFile(
  resolve(artifacts, "registry.json"),
  JSON.stringify(registry, null, 2),
);
console.log(
  JSON.stringify({ registry: resolve(artifacts, "registry.json"), project }),
);
