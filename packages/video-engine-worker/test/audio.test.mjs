import test from 'node:test';
import assert from 'node:assert/strict';
import { applyOperations, generateComposition } from '../src/timeline.mjs';
import { audioMixPlan } from '../src/audio.mjs';
const base = () => ({
  schema: 'dsh-video/timeline@1',
  projectId: 'demo',
  settings: {
    width: 320,
    height: 180,
    fps: 30,
    background: '#000000',
    durationFrames: 600,
  },
  assets: [
    {
      assetId: 'as_12345678',
      kind: 'audio',
      fps: 30,
      durationFrames: 600,
      path: 'media/sound.wav',
    },
  ],
  tracks: [
    { trackId: 'tr_a1', kind: 'audio', name: '旁白', gainDb: -3, clips: [] },
  ],
});
test('audio clips share timeline operations and source offsets', () => {
  let t = applyOperations(base(), [
    {
      op: 'clip.insert',
      assetId: 'as_12345678',
      trackId: 'tr_a1',
      startFrame: 30,
    },
    { op: 'timeline.settings', durationFrames: 660 },
  ]).timeline;
  let c = t.tracks[0].clips[0];
  t = applyOperations(t, [
    { op: 'clip.split', clipId: c.clipId, atFrame: 90 },
  ]).timeline;
  assert.equal(t.tracks[0].clips[1].sourceInFrame, 60);
  assert.match(generateComposition(t), /<audio /);
});
test('audio mix includes source trim speed gain fades delay and exact duration', () => {
  const t = base();
  t.tracks[0].clips = [
    {
      clipId: 'cl_audio',
      kind: 'media',
      assetId: 'as_12345678',
      startFrame: 30,
      durationFrames: 120,
      sourceInFrame: 60,
      speed: 2,
      volumeDb: -6,
      fadeInFrames: 15,
      fadeOutFrames: 30,
    },
  ];
  const p = audioMixPlan(t, '/tmp/snapshot');
  assert.equal(p.sources.length, 1);
  assert.match(p.filter, /atrim=start=2:duration=8/);
  assert.match(p.filter, /atempo=2/);
  assert.match(p.filter, /volume=0.3548/);
  assert.match(p.filter, /afade=t=in:st=0:d=0.5/);
  assert.match(p.filter, /adelay=1000/);
  assert.match(p.filter, /loudnorm=I=-16/);
  assert.match(p.filter, /atrim=duration=20/);
});
test('muted tracks and clips never enter export mix', () => {
  const t = base();
  t.tracks[0].muted = true;
  assert.equal(audioMixPlan(t, '/tmp').sources.length, 0);
});
test('audio assets cannot enter visual lanes and images cannot enter audio lanes', () => {
  const t = base();
  t.tracks.push({ trackId: 'tr_v1', kind: 'video', name: '画面', clips: [] });
  assert.throws(
    () =>
      applyOperations(t, [
        {
          op: 'clip.insert',
          assetId: 'as_12345678',
          trackId: 'tr_v1',
          startFrame: 0,
        },
      ]),
    (e) => e.code === 'E_TRACK_KIND',
  );
});
test('splitting and shortening audio keeps fades valid on the surviving ends', () => {
  let t = applyOperations(base(), [
    {
      op: 'clip.insert',
      assetId: 'as_12345678',
      trackId: 'tr_a1',
      startFrame: 0,
    },
  ]).timeline;
  const id = t.tracks[0].clips[0].clipId;
  t = applyOperations(t, [
    { op: 'clip.fade', clipId: id, inFrames: 60, outFrames: 60 },
    { op: 'clip.split', clipId: id, atFrame: 30 },
  ]).timeline;
  assert.equal(t.tracks[0].clips[0].fadeInFrames, 30);
  assert.equal(t.tracks[0].clips[0].fadeOutFrames, 0);
  assert.equal(t.tracks[0].clips[1].fadeInFrames, 0);
  t = applyOperations(t, [
    {
      op: 'clip.trim',
      clipId: t.tracks[0].clips[1].clipId,
      edge: 'out',
      deltaFrames: -550,
    },
  ]).timeline;
  assert.equal(t.tracks[0].clips[1].fadeOutFrames, 20);
});
