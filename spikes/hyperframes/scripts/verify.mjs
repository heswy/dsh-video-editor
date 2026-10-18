import assert from 'node:assert/strict';
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { artifacts, project } from './paths.mjs';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const video = resolve(artifacts, 'edited.mp4');
const metadata = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-count_frames', '-select_streams', 'v:0',
  '-show_entries', 'stream=codec_name,width,height,r_frame_rate,avg_frame_rate,duration,nb_frames,nb_read_frames',
  '-show_entries', 'format=duration', '-of', 'json', video], { encoding: 'utf8' }));
const stream = metadata.streams[0];
assert.equal(stream.codec_name, 'h264');
assert.equal(stream.width, 1280); assert.equal(stream.height, 720);
assert.equal(stream.r_frame_rate, '30/1'); assert.equal(stream.avg_frame_rate, '30/1');
assert.equal(Number(stream.nb_read_frames), 150); assert.equal(Number(stream.nb_frames), 150);
assert.ok(Math.abs(Number(metadata.format.duration) - 5) <= 1/30);
const seek = [];
for (const name of (await readdir(resolve(artifacts, 'ordered'))).filter(n => n.endsWith('.png')).sort()) {
  const a = await readFile(resolve(artifacts, 'ordered', name));
  const b = await readFile(resolve(artifacts, 'shuffled', name));
  assert.ok(a.equals(b), `seek mismatch ${name}`);
  seek.push({ name, sha256: hash(a), identical: true });
}
assert.equal(seek.length, 8);
assert.notEqual(hash(await readFile(resolve(artifacts, 'before/at-2.5s.png'))),
  hash(await readFile(resolve(artifacts, 'ordered/at-2.5s.png'))));
const preview = JSON.parse(await readFile(resolve(artifacts, 'preview-check.json')));
assert.equal(preview.title, 'HyperFrames Studio');
assert.deepEqual(preview.errors, []);
assert.deepEqual(preview.preview.samples.map(s=>s.visibility), ['hidden','visible','visible','hidden']);
assert.ok(preview.preview.samples.every(s=>s.fontLoaded && s.box.x>=0 && s.box.x+s.box.width<=1280 && s.box.y>=0 && s.box.y+s.box.height<=720));
assert.ok(preview.preview.playback.advanced, 'real Player playback must advance');
const lifecycle = {};
for (const mode of ['cancel', 'timeout']) {
  const r = JSON.parse(await readFile(resolve(artifacts, `render-${mode}.json`)));
  assert.equal(r.status, mode === 'cancel' ? 'cancelled' : 'timed_out');
  assert.deepEqual(r.survivors, []); lifecycle[mode] = r;
}
execFileSync('ffmpeg', ['-v', 'error', '-ss', '2.5', '-i', video, '-frames:v', '1', '-y', resolve(artifacts, 'mp4-at-2.5s.png')]);
const summary = { verifiedAt: new Date().toISOString(), metadata, frameToleranceSeconds: 1/30,
  durationErrorSeconds: Number(metadata.format.duration)-5, seek, lifecycle,
  files: {} };
for (const path of [video, resolve(project, 'index.html'), resolve(artifacts, 'studio-preview.png'),
  resolve(artifacts, 'before/at-2.5s.png'), resolve(artifacts, 'ordered/at-2.5s.png'), resolve(artifacts, 'mp4-at-2.5s.png')]) {
  const bytes = await readFile(path); summary.files[path] = { bytes: bytes.length, sha256: hash(bytes) };
}
await writeFile(resolve(artifacts, 'verification.json'), JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
