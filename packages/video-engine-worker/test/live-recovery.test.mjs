import test from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fixture, client, managed } from "./helpers.mjs";
import { validateComposition } from "../src/composition.mjs";
const html = `<!doctype html><html><head><script src="assets/gsap.min.js"></script></head><body><div id="main" data-composition-id="main" data-width="1280" data-height="720" data-duration="20"><div id="stage">Hello</div></div><script>const tl=gsap.timeline();tl.to({},{duration:20});window.__timelines={main:tl};</script></body></html>`;
async function call(c, method, p) {
  const r = await c.call(method, p);
  assert(r.ok, JSON.stringify(r));
  return r.result;
}
test("renaming a timeline project never persists virtual scene assets and stays renderable", async () => {
  const f = await fixture(),
    c = client(f.registry);
  try {
    await call(c, "open", { projectId: "demo" });
    const t = await call(c, "timeline.inspect", { projectId: "demo" });
    const before = JSON.parse(await readFile(join(f.project, "project.json")));
    await call(c, "project.rename", { projectId: "demo", title: "Renamed" });
    const after = JSON.parse(await readFile(join(f.project, "project.json")));
    assert.deepEqual(after.assets, before.assets);
    assert.equal(
      (await call(c, "inspect", { projectId: "demo" })).revision,
      t.revision,
    );
  } finally {
    await c.stop();
    await f.cleanup();
  }
});
test("SDK root ambiguity identifies the reserved stage id and accepts an explicit main root", async () => {
  await assert.rejects(
    validateComposition({ html, assets: ["assets/gsap.min.js"] }),
    (e) =>
      e.code === "E_COMPOSE_INVALID" &&
      /stage/.test(e.message) &&
      /data-hf-root/.test(e.message),
  );
  const r = await validateComposition({
    html: html.replace('id="main"', 'id="main" data-hf-root'),
    assets: ["assets/gsap.min.js"],
  });
  assert.equal(r.duration, 20);
});
test("new blank projects have no fake original clip and first scene owns the duration", async () => {
  const f = await managed("blank-live");
  try {
    const p = await call(f.c, "project.create", {
      templateId: "blank-v1",
      title: "Blank",
    });
    const t = await call(f.c, "timeline.inspect", { projectId: p.projectId });
    assert.equal(t.totalClips, 0);
    const r = await call(f.c, "scene.compose", {
      projectId: p.projectId,
      expectedRevision: t.revision,
      operationId: "first-scene",
      trackId: "tr_v1",
      startFrame: 0,
      html: html.replace('id="stage"', 'id="artwork"'),
    });
    assert.equal(r.settings.durationFrames, 600);
    assert.equal(
      (await call(f.c, "timeline.inspect", { projectId: p.projectId }))
        .totalClips,
      1,
    );
  } finally {
    await f.cleanup();
  }
});

test("scene publication rejects a missing library asset before changing a blank timeline", async () => {
  const f = await managed("missing-scene-asset");
  try {
    const p = await call(f.c, "project.create", { templateId: "blank-v1" });
    const t = await call(f.c, "timeline.inspect", { projectId: p.projectId });
    const r = await f.c.call("scene.compose", {
      projectId: p.projectId,
      expectedRevision: t.revision,
      operationId: "bad-font",
      trackId: "tr_v1",
      html: html
        .replace('id="stage"', 'id="artwork"')
        .replace("assets/gsap.min.js", "assets/MotionPathPlugin.min.js"),
    });
    assert.equal(r.ok, false);
    assert.equal(r.error.code, "E_COMPOSE_INVALID");
    assert.equal(
      (await call(f.c, "timeline.inspect", { projectId: p.projectId }))
        .revision,
      t.revision,
    );
  } finally {
    await f.cleanup();
  }
});
