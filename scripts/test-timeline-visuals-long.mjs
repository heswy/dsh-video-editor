/** Actual pinned worker, 120s mixed media and scene, temporary project only. */
import assert from 'node:assert/strict';
import {mkdir,writeFile,readdir,stat} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {fixture,client} from '../packages/video-engine-worker/test/helpers.mjs';
import {loadStagedHost} from './lib/staged-host.mjs';
const stageIndex=process.argv.indexOf('--staging');
const staging=stageIndex>=0?resolve(process.argv[stageIndex+1]):null;
const staged=staging?await loadStagedHost(staging):null;
const f=await fixture();let c;
const call=async(method,params={})=>{const r=await c.call(method,{projectId:'demo',...params});assert.equal(r.ok,true,JSON.stringify(r));return r.result;};
try{
 const inbox=join(f.dir,'inbox');await mkdir(inbox);await writeFile(join(f.dir,'managed.json'),JSON.stringify({projects:f.config.projects}));
 await writeFile(f.registry,JSON.stringify({projectsRoot:f.config.root,registryPath:join(f.dir,'managed.json'),outputRoot:f.config.outputRoot,assetInboxRoot:inbox}));
 execFileSync('ffmpeg',['-v','error','-f','lavfi','-i','testsrc2=size=320x180:rate=30:duration=120','-f','lavfi','-i','sine=frequency=440:duration=120','-c:v','libx264','-preset','ultrafast','-crf','30','-c:a','aac','-shortest',join(inbox,'long.mp4')]);
 execFileSync('ffmpeg',['-v','error','-f','lavfi','-i','sine=frequency=220:sample_rate=8000:duration=120','-filter:a','volume=0.08',join(inbox,'quiet.wav')]);
 c=client(f.registry,staged?{node:staged.config.workerNode,workerEntry:staged.evidence.resolved.workerEntry}:{});
 await call('open');let t=await call('timeline.inspect');
 const v=(await call('asset.importMedia',{sourceName:'long.mp4'})).asset,a=(await call('asset.importMedia',{sourceName:'quiet.wav'})).asset;
 await call('timeline.apply',{expectedRevision:t.revision,operationId:'mixed-tracks',ops:[{op:'timeline.settings',durationMode:'auto'},{op:'track.add',kind:'video'},{op:'track.add',kind:'audio'}]});
 t=await call('timeline.inspect');await call('timeline.apply',{expectedRevision:t.revision,operationId:'mixed-insert',ops:[{op:'clip.insert',assetId:v.assetId,trackId:t.tracks.filter(x=>x.kind==='video')[1].trackId,startFrame:0},{op:'clip.insert',assetId:a.assetId,trackId:t.tracks.find(x=>x.kind==='audio').trackId,startFrame:0}]});
 t=await call('timeline.inspect');assert.equal(t.settings.durationFrames,3600);
 const start=performance.now(),tasks=[];let peakRss=0;
 const measure=()=>{try{peakRss=Math.max(peakRss,Number(execFileSync('ps',['-o','rss=','-p',String(c.child.pid)],{encoding:'utf8'}).trim())*1024);}catch{}};
 for(const clip of t.tracks.flatMap(x=>x.clips))tasks.push(await call('timeline.visuals.request',{expectedRevision:t.revision,clipId:clip.clipId,startFrame:clip.startFrame,endFrame:clip.startFrame+clip.durationFrames,count:4}));
 const during=performance.now();assert.equal((await call('timeline.inspect')).revision,t.revision);const inspectMs=Math.round(performance.now()-during);
 const results=[];
 for(const task of tasks){let status;do{measure();status=await call('timeline.visuals.status',{taskId:task.taskId});if(['queued','running'].includes(status.status))await new Promise(yes=>setTimeout(yes,50));if(performance.now()-start>120000)throw new Error('Mixed visuals deadline');}while(['queued','running'].includes(status.status));assert.equal(status.status,'complete',JSON.stringify(status));assert.ok(JSON.stringify(status).length<65536);results.push(status.result);}
 assert.ok(results.some(x=>x.thumbnails.length===4&&x.waveform));assert.ok(results.some(x=>x.thumbnails.length===4&&!x.waveform));assert.ok(results.some(x=>!x.thumbnails.length&&x.waveform));
 assert.equal((await call('timeline.inspect')).revision,t.revision);
 const cache=join(f.project,'.dsh-video','timeline-visuals-v1');let diskBytes=0;for(const name of await readdir(cache))diskBytes+=(await stat(join(cache,name))).size;
 const cacheStart=performance.now(),clip=t.tracks.find(x=>x.kind==='audio').clips[0];const cached=await call('timeline.visuals.request',{expectedRevision:t.revision,clipId:clip.clipId,startFrame:0,endFrame:3600,count:4});let result;
 do{result=await call('timeline.visuals.status',{taskId:cached.taskId});if(result.status!=='complete')await new Promise(yes=>setTimeout(yes,20));}while(['queued','running'].includes(result.status));assert.equal(result.status,'complete');
 console.log(JSON.stringify({ok:true,checks:8,durationSeconds:120,clips:tasks.length,firstScreenMs:Math.round(cacheStart-start),inspectDuringSamplingMs:inspectMs,cacheHitMs:Math.round(performance.now()-cacheStart),peakWorkerRss:peakRss,diskBytes}));
}finally{await c?.stop();await f.cleanup();if(staged)await loadStagedHost(staging);}
