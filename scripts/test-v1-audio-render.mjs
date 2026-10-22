import assert from 'node:assert/strict';
import {loadStagedHost} from './lib/staged-host.mjs';
import {
  fixture,
  client,
  waitJob,
} from '../packages/video-engine-worker/test/helpers.mjs';
import { mkdir, writeFile, copyFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
const stageArg=process.argv.indexOf('--staging');const staged=stageArg>=0?await loadStagedHost(resolve(process.argv[stageArg+1])):null;const runtime=staged?{node:staged.config.workerNode,workerEntry:staged.evidence.resolved.workerEntry}:undefined;
const f = await fixture(),
  out = resolve(process.argv[2] || '/tmp/m4-audio-render');
await mkdir(out, { recursive: true });
let c;
async function call(method, p = {}) {
  const r = await c.call(method, { projectId: 'demo', ...p });
  assert.equal(r.ok, true, JSON.stringify(r));
  return r.result;
}
try {
  const inbox = join(f.dir, 'inbox');
  await mkdir(inbox);
  await writeFile(
    join(f.dir, 'managed.json'),
    JSON.stringify({ projects: f.config.projects }),
  );
  await writeFile(
    f.registry,
    JSON.stringify({
      projectsRoot: f.config.root,
      registryPath: join(f.dir, 'managed.json'),
      outputRoot: f.config.outputRoot,
      assetInboxRoot: inbox,
    }),
  );
  execFileSync('ffmpeg', [
    '-v',
    'error',
    '-f',
    'lavfi',
    '-i',
    "color=c=black:s=320x180:r=30:d=21,drawbox=color=white:t=fill:enable='lt(mod(t,5),0.1)'",
    '-f',
    'lavfi',
    '-i',
    'aevalsrc=sin(2*PI*1000*t)*lt(mod(t\\,5)\\,0.1):s=48000:d=21',
    '-c:v',
    'libx264',
    '-c:a',
    'aac',
    '-shortest',
    join(inbox, 'markers.mp4'),
  ]);
  execFileSync('ffmpeg', [
    '-v',
    'error',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=300:sample_rate=48000:duration=21',
    '-c:a',
    'pcm_s16le',
    join(inbox, 'bgm.wav'),
  ]);
  c = client(f.registry,runtime);
  await call('open');
  let t = await call('timeline.inspect');
  const v = (await call('asset.importMedia', { sourceName: 'markers.mp4' }))
      .asset,
    a = (await call('asset.importMedia', { sourceName: 'bgm.wav' })).asset;
  let r = await call('timeline.apply', {
    expectedRevision: t.revision,
    operationId: 'audio_setup',
    ops: [
      { op: 'clip.delete', clipId: t.tracks[0].clips[0].clipId },
      { op: 'timeline.settings', width: 320, height: 180, durationFrames: 630 },
      {
        op: 'clip.insert',
        assetId: v.assetId,
        trackId: 'tr_v1',
        startFrame: 0,
      },
      { op: 'track.add', kind: 'audio', name: 'BGM' },
    ],
  });
  t = await call('timeline.inspect');
  const tr = t.tracks.find((x) => x.kind === 'audio');
  r = await call('timeline.apply', {
    expectedRevision: r.revision,
    operationId: 'audio_bgm',
    ops: [
      {
        op: 'clip.insert',
        assetId: a.assetId,
        trackId: tr.trackId,
        startFrame: 0,
      },
    ],
  });
  t = await call('timeline.inspect');
  const ac = t.tracks.find((x) => x.trackId === tr.trackId).clips[0];
  r = await call('timeline.apply', {
    expectedRevision: r.revision,
    operationId: 'audio_levels',
    ops: [
      { op: 'clip.volume', clipId: ac.clipId, volumeDb: -60 },
      { op: 'clip.fade', clipId: ac.clipId, inFrames: 15, outFrames: 30 },
    ],
  });
  const j = await call('render', { revision: r.revision });
  const result = await waitJob(c, j.jobId);
  await writeFile(join(out, 'result.json'), JSON.stringify(result, null, 2));
  assert.equal(result.state, 'succeeded', JSON.stringify(result));
  assert.equal(result.audio.channels, 2);
  const output = join(out, 'audio.mp4');
  await copyFile(join(f.config.outputRoot, result.artifact.name), output);
  const pcm = execFileSync(
    'ffmpeg',
    [
      '-v',
      'error',
      '-i',
      output,
      '-vn',
      '-ac',
      '1',
      '-ar',
      '48000',
      '-f',
      'f32le',
      '-',
    ],
    { maxBuffer: 16 * 1024 * 1024 },
  );
  const samples = new Float32Array(pcm.buffer, pcm.byteOffset, pcm.length / 4);
  const offsets = [0, 5, 10, 20].map((at) => {
    let first = -1;
    for (
      let i = Math.max(0, Math.round((at - 0.1) * 48000));
      i < Math.min(samples.length, (at + 0.2) * 48000);
      i++
    )
      if (Math.abs(samples[i]) > 0.01) {
        first = i / 48000;
        break;
      }
    assert.ok(first >= 0);
    assert.ok(Math.abs(first - at) <= 1 / 30, JSON.stringify({ at, first }));
    return { at, audio: first, errorSeconds: Math.abs(first - at) };
  });
  const loud = spawnSync(
    'ffmpeg',
    [
      '-hide_banner',
      '-i',
      output,
      '-af',
      'loudnorm=I=-16:TP=-1.5:LRA=50:print_format=json',
      '-f',
      'null',
      '-',
    ],
    { encoding: 'utf8' },
  );
  assert.equal(loud.status, 0);
  const loudness = JSON.parse(loud.stderr.match(/\{\s*"input_i"[\s\S]*?\}/)[0]);
  await writeFile(
    join(out, 'loudness.json'),
    JSON.stringify(loudness, null, 2),
  );
  assert.ok(
    Math.abs(Number(loudness.input_i) + 16) <= 1,
    JSON.stringify(loudness),
  );
  const gray = execFileSync('ffmpeg', [
    '-v',
    'error',
    '-i',
    output,
    '-vf',
    'scale=1:1',
    '-pix_fmt',
    'gray',
    '-f',
    'rawvideo',
    '-',
  ]);
  for (const offset of offsets) {
    let frame = -1;
    for (
      let i = Math.max(0, Math.round((offset.at - 0.1) * 30));
      i < Math.min(gray.length, (offset.at + 0.2) * 30);
      i++
    )
      if (gray[i] > 128) {
        frame = i;
        break;
      }
    assert.ok(frame >= 0);
    offset.visual = frame / 30;
    offset.errorSeconds = Math.abs(offset.audio - offset.visual);
    assert.ok(offset.errorSeconds <= 1 / 30, JSON.stringify(offset));
  }
  await c.stop();
  c = client(f.registry,runtime);
  await call('open');
  assert.equal((await call('timeline.inspect')).revision, r.revision);
  await writeFile(
    join(out, 'sync.json'),
    JSON.stringify({ ok: true, offsets }, null, 2),
  );
  console.log(
    JSON.stringify({
      ok: true,
      audio: result.audio,
      frames: result.artifact.metadata.nb_read_frames,
      offsets,
    }),
  );
} finally {
  if (c) await c.stop();
  await f.cleanup();
}
