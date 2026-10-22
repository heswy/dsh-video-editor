/** Chinese intent fixtures exercise contracts, not a model success-rate benchmark. */
import assert from "node:assert/strict";
import {
  applyOperations,
  validateTimeline,
} from "../packages/video-engine-worker/src/timeline.mjs";
const base = () => ({
  schema: "dsh-video/timeline@1",
  projectId: "demo",
  settings: {
    width: 1280,
    height: 720,
    fps: 30,
    sampleRate: 48000,
    background: "#000000",
    durationFrames: 600,
  },
  assets: [
    {
      assetId: "as_video",
      kind: "video",
      fps: 30,
      durationFrames: 1800,
      path: "media/video.mp4",
    },
    { assetId: "as_image", kind: "image", path: "media/image.png" },
    {
      assetId: "as_audio",
      kind: "audio",
      fps: 30,
      durationFrames: 1800,
      path: "media/audio.wav",
    },
  ],
  tracks: [
    {
      trackId: "tr_video",
      kind: "video",
      name: "视频轨",
      clips: [
        {
          clipId: "cl_one",
          kind: "media",
          assetId: "as_video",
          startFrame: 0,
          durationFrames: 300,
          sourceInFrame: 0,
          speed: 1,
          label: "开场",
        },
        {
          clipId: "cl_two",
          kind: "media",
          assetId: "as_video",
          startFrame: 300,
          durationFrames: 300,
          sourceInFrame: 300,
          speed: 1,
          label: "结尾",
        },
      ],
    },
    { trackId: "tr_empty", kind: "video", name: "叠加轨", clips: [] },
    {
      trackId: "tr_audio",
      kind: "audio",
      name: "配音轨",
      clips: [
        {
          clipId: "cl_audio",
          kind: "media",
          assetId: "as_audio",
          startFrame: 0,
          durationFrames: 600,
          sourceInFrame: 0,
          speed: 1,
        },
      ],
    },
  ],
});
const clip = (t) => t.tracks[0].clips.find((x) => x.clipId === "cl_one");
const cases = [
  [
    "把第一段从五秒处切开",
    [{ op: "clip.split", clipId: "cl_one", atFrame: 150 }],
    (t) => assert.equal(t.tracks[0].clips.length, 3),
  ],
  [
    "把第二段放到最前面",
    [
      {
        op: "clip.reorder",
        trackId: "tr_video",
        clipIds: ["cl_two", "cl_one"],
      },
    ],
    (t) => assert.equal(t.tracks[0].clips[0].clipId, "cl_two"),
  ],
  [
    "第一段缩短到五秒",
    [
      {
        op: "clip.trim",
        clipId: "cl_one",
        edge: "out",
        deltaFrames: -150,
        ripple: true,
      },
    ],
    (t) => assert.equal(clip(t).durationFrames, 150),
  ],
  [
    "第一段去掉开头一秒",
    [{ op: "clip.trim", clipId: "cl_one", edge: "in", deltaFrames: 30 }],
    (t) => assert.equal(clip(t).sourceInFrame, 30),
  ],
  [
    "删掉第一段并前移后续",
    [{ op: "clip.delete", clipId: "cl_one", ripple: true }],
    (t) => assert.equal(t.tracks[0].clips[0].startFrame, 0),
  ],
  [
    "删除第一段但保留空隙",
    [{ op: "clip.delete", clipId: "cl_one" }],
    (t) => assert.equal(t.tracks[0].clips[0].startFrame, 300),
  ],
  [
    "第一段放到叠加轨两秒处",
    [
      {
        op: "clip.move",
        clipId: "cl_one",
        trackId: "tr_empty",
        startFrame: 60,
      },
    ],
    (t) => assert.equal(t.tracks[1].clips[0].startFrame, 60),
  ],
  [
    "复制第一段到叠加轨",
    [
      {
        op: "clip.duplicate",
        clipId: "cl_one",
        trackId: "tr_empty",
        startFrame: 0,
      },
    ],
    (t) => assert.notEqual(t.tracks[1].clips[0].clipId, "cl_one"),
  ],
  [
    "第一段两倍速并前移后续",
    [{ op: "clip.speed", clipId: "cl_one", speed: 2, ripple: true }],
    (t) => assert.equal(clip(t).durationFrames, 150),
  ],
  [
    "第一段半速播放",
    [{ op: "clip.speed", clipId: "cl_one", speed: 0.5, ripple: true }],
    (t) => assert.equal(clip(t).durationFrames, 600),
  ],
  [
    "第一段原声降低六分贝",
    [{ op: "clip.volume", clipId: "cl_one", volumeDb: -6 }],
    (t) => assert.equal(clip(t).volumeDb, -6),
  ],
  [
    "第一段静音",
    [{ op: "clip.set", clipId: "cl_one", patch: { muted: true } }],
    (t) => assert.equal(clip(t).muted, true),
  ],
  [
    "片段名称改为产品特写",
    [{ op: "clip.set", clipId: "cl_one", patch: { label: "产品特写" } }],
    (t) => assert.equal(clip(t).label, "产品特写"),
  ],
  [
    "配音淡入半秒",
    [{ op: "clip.fade", clipId: "cl_audio", inFrames: 15, outFrames: 0 }],
    (t) => assert.equal(t.tracks[2].clips[0].fadeInFrames, 15),
  ],
  [
    "配音淡出一秒",
    [{ op: "clip.fade", clipId: "cl_audio", inFrames: 0, outFrames: 30 }],
    (t) => assert.equal(t.tracks[2].clips[0].fadeOutFrames, 30),
  ],
  [
    "配音音量降低十分贝",
    [{ op: "clip.volume", clipId: "cl_audio", volumeDb: -10 }],
    (t) => assert.equal(t.tracks[2].clips[0].volumeDb, -10),
  ],
  [
    "静音整条配音轨",
    [{ op: "track.update", trackId: "tr_audio", patch: { muted: true } }],
    (t) => assert.equal(t.tracks[2].muted, true),
  ],
  [
    "配音轨增益三分贝",
    [{ op: "track.update", trackId: "tr_audio", patch: { gainDb: 3 } }],
    (t) => assert.equal(t.tracks[2].gainDb, 3),
  ],
  [
    "新建一条音效轨",
    [{ op: "track.add", kind: "audio", name: "音效" }],
    (t) => assert.equal(t.tracks.at(-1).name, "音效"),
  ],
  [
    "重命名配音轨为旁白",
    [{ op: "track.update", trackId: "tr_audio", patch: { name: "旁白" } }],
    (t) => assert.equal(t.tracks[2].name, "旁白"),
  ],
  [
    "删除空的叠加轨",
    [{ op: "track.remove", trackId: "tr_empty" }],
    (t) => assert.equal(t.tracks.length, 2),
  ],
  [
    "锁定视频轨",
    [{ op: "track.update", trackId: "tr_video", patch: { locked: true } }],
    (t) => assert.equal(t.tracks[0].locked, true),
  ],
  [
    "隐藏视频轨",
    [{ op: "track.update", trackId: "tr_video", patch: { hidden: true } }],
    (t) => assert.equal(t.tracks[0].hidden, true),
  ],
  [
    "叠加轨加入五秒图片",
    [
      {
        op: "clip.insert",
        assetId: "as_image",
        trackId: "tr_empty",
        startFrame: 0,
        durationFrames: 150,
      },
    ],
    (t) => assert.equal(t.tracks[1].clips[0].durationFrames, 150),
  ],
  [
    "第一段替换为图片并保留时长",
    [
      {
        op: "clip.replace",
        clipId: "cl_one",
        assetId: "as_image",
        keepTiming: true,
      },
    ],
    (t) => assert.equal(clip(t).durationFrames, 300),
  ],
  [
    "作品背景改成白色",
    [{ op: "timeline.settings", background: "#ffffff" }],
    (t) => assert.equal(t.settings.background, "#ffffff"),
  ],
  [
    "作品尺寸改成竖屏",
    [{ op: "timeline.settings", width: 720, height: 1280 }],
    (t) => assert.equal(t.settings.height, 1280),
  ],
  [
    "作品固定为三十秒",
    [{ op: "timeline.settings", durationFrames: 900 }],
    (t) => assert.equal(t.settings.durationFrames, 900),
  ],
  [
    "配音延后两秒",
    [{ op: "clip.move", clipId: "cl_audio", startFrame: 60 }],
    (t) => assert.equal(t.tracks[2].clips[0].startFrame, 60),
  ],
  [
    "一次改名并降低原声音量",
    [
      { op: "clip.set", clipId: "cl_one", patch: { label: "开场新版" } },
      { op: "clip.volume", clipId: "cl_one", volumeDb: -12 },
    ],
    (t) => {
      assert.equal(clip(t).label, "开场新版");
      assert.equal(clip(t).volumeDb, -12);
    },
  ],
];
for (const [instruction, ops, verify] of cases) {
  const original = base();
  const result = applyOperations(original, ops);
  validateTimeline(result.timeline);
  verify(result.timeline);
  assert.deepEqual(original, base());
  assert(result.applied.every((x) => x.summary));
  const volume=ops.find(x=>x.op==='clip.volume');if(volume)assert(result.applied.some(x=>x.summary.includes(volume.volumeDb+' dB')));
  console.log("PASS " + instruction);
}
console.log(
  JSON.stringify({
    ok: true,
    contractScenarios: cases.length,
    realModelTest: false,
  }),
);
