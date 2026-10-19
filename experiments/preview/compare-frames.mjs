#!/usr/bin/env node
/**
 * Dev-only pixel comparison between the isolated iframe snapshots and the real
 * worker frame PNGs captured at the same revision/time.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import sharp from 'sharp';

const OUT = process.argv[2] || new URL('./evidence/', import.meta.url).pathname;
const TIMES = [
  { time: 0.5, preview: 'seek-0.5s.png', worker: 'worker-0_5.png' },
  { time: 2.5, preview: 'seek-2.5s.png', worker: 'worker-2_5.png' },
  { time: 4.5, preview: 'seek-4.5s.png', worker: 'worker-4_5.png' },
];
function sha256(bytes) { return createHash('sha256').update(bytes).digest('hex'); }
async function raw(path) {
  const bytes = await readFile(path);
  const { data, info } = await sharp(bytes).removeAlpha().toColourspace('srgb').raw().toBuffer({ resolveWithObject: true });
  return { bytes, data, info };
}
const result = { kind: 'p2-005-preview-consistency', frames: [] };
for (const entry of TIMES) {
  const preview = await raw(join(OUT, entry.preview));
  const worker = await raw(join(OUT, entry.worker));
  if (preview.info.width !== worker.info.width || preview.info.height !== worker.info.height || preview.info.channels !== worker.info.channels) {
    result.frames.push({ ...entry, error: 'dimension/channel mismatch', preview: preview.info, worker: worker.info });
    continue;
  }
  let sum = 0;
  let pixelsChanged = 0;
  let maxDiff = 0;
  let over8 = 0;
  let over16 = 0;
  const channels = preview.info.channels;
  for (let index = 0; index < preview.data.length; index += channels) {
    let changed = false;
    for (let channel = 0; channel < channels; channel += 1) {
      const diff = Math.abs(preview.data[index + channel] - worker.data[index + channel]);
      sum += diff;
      if (diff > maxDiff) maxDiff = diff;
      if (diff > 0) changed = true;
      if (diff > 8) over8 += 1;
      if (diff > 16) over16 += 1;
    }
    if (changed) pixelsChanged += 1;
  }
  const pixels = preview.info.width * preview.info.height;
  result.frames.push({
    time: entry.time,
    preview: { width: preview.info.width, height: preview.info.height, channels, sha256: sha256(preview.bytes) },
    worker: { width: worker.info.width, height: worker.info.height, channels, sha256: sha256(worker.bytes) },
    pixelMAE: sum / (pixels * channels),
    maxChannelDiff: maxDiff,
    changedPixelFraction: pixelsChanged / pixels,
    channelDiffOver8Fraction: over8 / (pixels * channels),
    channelDiffOver16Fraction: over16 / (pixels * channels),
  });
}
result.ok = result.frames.every((frame) => frame.error === undefined);
await writeFile(join(OUT, 'consistency.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result, null, 2));
if (!result.ok) process.exitCode = 1;
