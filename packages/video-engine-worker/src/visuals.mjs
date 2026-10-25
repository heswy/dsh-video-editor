// Source-time envelopes are shared by trimmed, copied and retimed clips.
export function sourceSeconds(clip, timelineFrame, sourceFps, timelineFps=30) {
  return (clip.sourceInFrame ?? 0)/sourceFps + (timelineFrame-clip.startFrame)/timelineFps*(clip.speed ?? 1);
}
export function peakPyramid(channels, bucketSize=256) {
  if (!Number.isSafeInteger(bucketSize) || bucketSize<1 || !channels.length)
    throw new RangeError('Invalid peak input');
  const length=channels[0].length;
  if(channels.some(x=>x.length!==length)) throw new RangeError('Channel lengths differ');
  const peaks=[], rms=[];
  for(let start=0;start<length;start+=bucketSize){
    let peak=0,energy=0,count=0;
    for(let i=start;i<Math.min(length,start+bucketSize);i++){
      let square=0;
      for(const channel of channels){const value=Number.isFinite(channel[i])?channel[i]:0;peak=Math.max(peak,Math.abs(value));square=Math.max(square,value*value);}
      energy+=square;count++;
    }
    peaks.push(peak);rms.push(Math.sqrt(energy/count));
  }
  const levels=[{bucketSize,peaks,rms}];
  while(levels.at(-1).peaks.length>1){
    const previous=levels.at(-1),p=[],r=[];
    for(let i=0;i<previous.peaks.length;i+=2){p.push(Math.max(previous.peaks[i],previous.peaks[i+1]??0));r.push(Math.sqrt((previous.rms[i]**2+(previous.rms[i+1]??previous.rms[i])**2)/2));}
    levels.push({bucketSize:previous.bucketSize*2,peaks:p,rms:r});
  }
  return levels;
}
export function displayAmplitude(value, materialPeak) {
  const gain=Math.min(8,1/Math.max(.125,materialPeak));
  return Math.min(1,Math.max(0,value)*gain)**.65;
}
