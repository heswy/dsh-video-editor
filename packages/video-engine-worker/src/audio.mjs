import { resolve } from 'node:path';
/** A deterministic mix from the immutable timeline snapshot. Time is project frames. */
export function audioMixPlan(t, root) {
  const targetLufs = t?.settings.loudnessTargetLufs ?? -16;
  const sources = [],
    chains = [];
  for (const tr of t?.tracks ?? []) {
    if (tr.muted) continue;
    for (const c of tr.clips) {
      const a = t.assets.find((a) => a.assetId === c.assetId);
      if (c.muted || !a || (a.kind !== 'audio' && !a.hasAudio)) continue;
      const n = sources.length,
        speed = c.speed ?? 1,
        duration = c.durationFrames / 30;
      sources.push(resolve(root, a.path));
      const tempo = [];
      let rate = speed;
      while (rate > 2) {
        tempo.push('atempo=2');
        rate /= 2;
      }
      while (rate < 0.5) {
        tempo.push('atempo=0.5');
        rate /= 0.5;
      }
      tempo.push(`atempo=${rate}`);
      const gain = 10 ** (((c.volumeDb ?? 0) + (tr.gainDb ?? 0)) / 20);
      const filters = [
        `atrim=start=${(c.sourceInFrame ?? 0) / a.fps}:duration=${duration * speed}`,
        'asetpts=PTS-STARTPTS',
        ...tempo,
        'aresample=48000',
        'aformat=channel_layouts=stereo',
        `volume=${gain.toFixed(8)}`,
        `apad=whole_dur=${duration}`,
        `atrim=duration=${duration}`,
      ];
      if (c.fadeInFrames)
        filters.push(`afade=t=in:st=0:d=${c.fadeInFrames / 30}`);
      if (c.fadeOutFrames)
        filters.push(
          `afade=t=out:st=${Math.max(0, duration - c.fadeOutFrames / 30)}:d=${c.fadeOutFrames / 30}`,
        );
      filters.push(`adelay=${Math.round((c.startFrame / 30) * 1000)}:all=1`);
      chains.push(`[${n + 1}:a]${filters.join(',')}[a${n}]`);
    }
  }
  if (sources.length)
    chains.push(
      `${sources.map((_, i) => `[a${i}]`).join('')}amix=inputs=${sources.length}:normalize=0:dropout_transition=0,apad,atrim=duration=${t.settings.durationFrames / 30},loudnorm=I=${targetLufs}:TP=-1.5:LRA=11,aresample=48000[aout]`,
    );
  return {
    sources,
    targetLufs,
    filter: chains.join(';'),
    duration: t?.settings.durationFrames / 30,
  };
}
