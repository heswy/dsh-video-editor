// Controlled scene templates for the P3-001 spike. All projects are generated
// from this module (no user assets, no network, no model calls); a "simulated
// AI rewrite" means regenerating one scene from this same template with
// different text/timing/layout values.

export const SCENE_MARKERS = [
  { color: "#1d4ed8", accent: "#bfdbfe" },
  { color: "#0f766e", accent: "#99f6e4" },
  { color: "#9d174d", accent: "#fbcfe8" },
  { color: "#7c2d12", accent: "#fed7aa" },
];

export function scenesFixture() {
  return [
    {
      sceneId: "scene-1",
      order: 0,
      start: 0,
      duration: 4,
      badge: "SCENE 01",
      title: "开场：内容成为影像",
      subtitle: "人工与 AI 共用同一份可编辑工程",
      ...SCENE_MARKERS[0],
    },
    {
      sceneId: "scene-2",
      order: 1,
      start: 4,
      duration: 4,
      badge: "SCENE 02",
      title: "截图进入画面",
      subtitle: "受控素材与 revision 快照",
      ...SCENE_MARKERS[1],
    },
    {
      sceneId: "scene-3",
      order: 2,
      start: 8,
      duration: 4,
      badge: "SCENE 03",
      title: "人工修改先发生",
      subtitle: "typed edit 只触碰明确对象",
      ...SCENE_MARKERS[2],
    },
    {
      sceneId: "scene-4",
      order: 3,
      start: 12,
      duration: 3,
      badge: "SCENE 04",
      title: "收尾：导出成片",
      subtitle: "15 秒 / 1280×720 / 30fps",
      ...SCENE_MARKERS[3],
    },
  ];
}

export const TOTAL_DURATION = 15;

// One scene as its own composition file (candidate A): a template wrapper keeps
// the official sub-composition convention.
export function renderSceneTemplate(scene, { assetPrefix = "../assets" } = {}) {
  const id = scene.sceneId;
  const esc = escapeHtml;
  return `<template data-composition-id="${id}">
<div data-composition-id="${id}" data-width="1280" data-height="720" data-duration="${scene.duration}" style="position:absolute;inset:0;overflow:hidden;background:${scene.color};font-family:SpikeHeiti,sans-serif;color:#ffffff">
  <div data-hf-id="${id}-badge" style="position:absolute;left:88px;top:88px;font-size:22px;letter-spacing:6px;color:${scene.accent}">${esc(scene.badge)}</div>
  <h1 data-hf-id="${id}-title" data-start="0" data-duration="${scene.duration}" style="position:absolute;left:88px;top:196px;margin:0;width:980px;font-size:64px;line-height:1.12;font-weight:600">${esc(scene.title)}</h1>
  <p data-hf-id="${id}-subtitle" data-start="0.4" data-duration="${Math.max(0.5, scene.duration - 0.4)}" style="position:absolute;left:90px;top:330px;margin:0;font-size:26px;color:${scene.accent}">${esc(scene.subtitle)}</p>
  <div data-hf-id="${id}-rule" data-start="0.2" data-duration="${Math.max(0.5, scene.duration - 0.2)}" style="position:absolute;left:88px;top:560px;width:1104px;height:2px;background:${scene.accent}"></div>
  <img data-hf-id="${id}-logo" src="${assetPrefix}/logo.png" style="position:absolute;left:1030px;top:88px;width:140px;height:140px;object-fit:cover;border-radius:20px">
  <img data-hf-id="${id}-shot" src="${assetPrefix}/shot-${scene.order + 1}.png" style="position:absolute;left:800px;top:430px;width:250px;height:150px;object-fit:cover;border-radius:14px">
  <script>
    const tl = gsap.timeline({ paused: true });
    tl.fromTo('[data-hf-id="${id}-title"]', { opacity: 0, y: 36 }, { opacity: 1, y: 0, duration: 0.9, ease: "power2.out" }, 0);
    tl.fromTo('[data-hf-id="${id}-rule"]', { scaleX: 0 }, { scaleX: 1, duration: 1.2, ease: "none" }, 0.2);
    window.__timelines = window.__timelines || {};
    window.__timelines["${id}"] = tl;
  </script>
</div>
</template>
`;
}

// Master composition referencing one scene file per host (candidate A).
export function renderMasterNested(scenes, { duration = TOTAL_DURATION } = {}) {
  const hosts = scenes
    .map(
      (scene) => `  <div id="${scene.sceneId}" class="comp" data-composition-id="${scene.sceneId}" data-composition-src="compositions/${scene.sceneId}.html" data-start="${scene.start}" data-duration="${scene.duration}" data-track-index="${scene.order}"></div>`,
    )
    .join("\n");
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<style>
@font-face { font-family: SpikeHeiti; src: url('./assets/Heiti.ttc'); }
* { box-sizing: border-box; }
html, body { margin: 0; width: 1280px; height: 720px; overflow: hidden; background: #000; }
#main { position: relative; width: 1280px; height: 720px; overflow: hidden; background: #000; font-family: SpikeHeiti, sans-serif; }
.comp { position: absolute; inset: 0; }
</style>
<script src="./assets/gsap.min.js"></script>
</head>
<body>
<div id="main" data-composition-id="main" data-hf-id="hf-main" data-width="1280" data-height="720" data-fps="30" data-start="0" data-duration="${duration}">
${hosts}
</div>
<script>
const tl = gsap.timeline({ paused: true });
window.__timelines = { main: tl };
</script>
</body>
</html>
`;
}

// Candidate B: one document, scene sections in a single composition with a
// master timeline that reveals exactly one section at a time.
export function renderSingleDoc(scenes, { duration = TOTAL_DURATION } = {}) {
  const sections = scenes
    .map(
      (scene) => `  <section id="${scene.sceneId}" data-scene-id="${scene.sceneId}" data-scene-order="${scene.order}" data-hf-id="${scene.sceneId}-section" data-start="${scene.start}" data-duration="${scene.duration}" style="position:absolute;inset:0;overflow:hidden;background:${scene.color};opacity:${scene.order === 0 ? 1 : 0}">
    <div data-hf-id="${scene.sceneId}-badge" style="position:absolute;left:88px;top:88px;font-size:22px;letter-spacing:6px;color:${scene.accent}">${escapeHtml(scene.badge)}</div>
    <h1 data-hf-id="${scene.sceneId}-title" data-start="${scene.start}" data-duration="${scene.duration}" style="position:absolute;left:88px;top:196px;margin:0;width:980px;font-size:64px;line-height:1.12;font-weight:600">${escapeHtml(scene.title)}</h1>
    <p data-hf-id="${scene.sceneId}-subtitle" data-start="${scene.start + 0.4}" data-duration="${Math.max(0.5, scene.duration - 0.4)}" style="position:absolute;left:90px;top:330px;margin:0;font-size:26px;color:${scene.accent}">${escapeHtml(scene.subtitle)}</p>
    <div data-hf-id="${scene.sceneId}-rule" data-start="${scene.start + 0.2}" data-duration="${Math.max(0.5, scene.duration - 0.2)}" style="position:absolute;left:88px;top:560px;width:1104px;height:2px;background:${scene.accent}"></div>
    <img data-hf-id="${scene.sceneId}-logo" src="./assets/logo.png" style="position:absolute;left:1030px;top:88px;width:140px;height:140px;object-fit:cover;border-radius:20px">
    <img data-hf-id="${scene.sceneId}-shot" src="./assets/shot-${scene.order + 1}.png" style="position:absolute;left:800px;top:430px;width:250px;height:150px;object-fit:cover;border-radius:14px">
  </section>`,
    )
    .join("\n");
  const timeline = scenes
    .map((scene, index) => {
      const lines = [];
      if (index === 0) lines.push(`tl.set("#${scene.sceneId}", { opacity: 1 }, 0);`);
      else lines.push(`tl.set("#${scene.sceneId}", { opacity: 1 }, ${scene.start});`);
      if (index < scenes.length - 1)
        lines.push(`tl.set("#${scene.sceneId}", { opacity: 0 }, ${scene.start + scene.duration});`);
      lines.push(
        `tl.fromTo('[data-hf-id="${scene.sceneId}-title"]', { opacity: 0, y: 36 }, { opacity: 1, y: 0, duration: 0.9, ease: "power2.out" }, ${scene.start});`,
        `tl.fromTo('[data-hf-id="${scene.sceneId}-rule"]', { scaleX: 0 }, { scaleX: 1, duration: 1.2, ease: "none" }, ${scene.start + 0.2});`,
      );
      return "  " + lines.join("\n  ");
    })
    .join("\n");
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<style>
@font-face { font-family: SpikeHeiti; src: url('./assets/Heiti.ttc'); }
* { box-sizing: border-box; }
html, body { margin: 0; width: 1280px; height: 720px; overflow: hidden; background: #000; }
#main { position: relative; width: 1280px; height: 720px; overflow: hidden; background: #000; font-family: SpikeHeiti, sans-serif; }
</style>
<script src="./assets/gsap.min.js"></script>
</head>
<body>
<div id="main" data-composition-id="main" data-hf-id="hf-main" data-width="1280" data-height="720" data-fps="30" data-start="0" data-duration="${duration}">
${sections}
</div>
<script>
  const tl = gsap.timeline({ paused: true });
${timeline}
  window.__timelines = { main: tl };
  tl.seek(0);
</script>
</body>
</html>
`;
}

// Candidate C: one standalone composition file per scene and a custom manifest;
// there is no aggregate root composition file.
export function renderStandaloneScene(scene) {
  return renderSceneTemplate(scene, { assetPrefix: "./assets" });
}

export function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
