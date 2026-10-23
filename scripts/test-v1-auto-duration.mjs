/** Export must end at the last clip, not legacy fixed 20s padding. */
import assert from 'node:assert/strict';
import {fixture,client,waitJob} from '../packages/video-engine-worker/test/helpers.mjs';
import {mkdir,writeFile,copyFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
const require=createRequire(resolve('packages/video-engine-worker/package.json')),sharp=require('sharp'),f=await fixture(),out=resolve(process.argv[2]||'/tmp/auto-duration-export');
const si=process.argv.indexOf('--staging');await mkdir(out,{recursive:true});let c;
try{
 const inbox=join(f.dir,'inbox');await mkdir(inbox);await sharp({create:{width:320,height:180,channels:3,background:'#334455'}}).png().toFile(join(inbox,'clip.png'));
 await writeFile(join(f.dir,'managed.json'),JSON.stringify({projects:f.config.projects}));await writeFile(f.registry,JSON.stringify({projectsRoot:f.config.root,registryPath:join(f.dir,'managed.json'),outputRoot:f.config.outputRoot,assetInboxRoot:inbox}));
 c=client(f.registry,si<0?{}:{workerEntry:join(resolve(process.argv[si+1]),'engine-worker/src/worker.mjs')});
 const call=async(method,p={})=>{const r=await c.call(method,{projectId:'demo',...p});assert(r.ok,JSON.stringify(r));return r.result;};
 await call('open');let t=await call('timeline.inspect');const asset=(await call('asset.importMedia',{sourceName:'clip.png'})).asset.assetId;
 await call('timeline.apply',{expectedRevision:t.revision,operationId:'duration-user-shape',ops:[{op:'clip.delete',clipId:t.tracks[0].clips[0].clipId},{op:'track.add',kind:'video'},{op:'timeline.settings',durationFrames:600,durationMode:'fixed'}]});
 t=await call('timeline.inspect');await call('timeline.apply',{expectedRevision:t.revision,operationId:'duration-user-clips',ops:[{op:'clip.insert',trackId:t.tracks[0].trackId,assetId:asset,startFrame:0,durationFrames:532},{op:'clip.insert',trackId:t.tracks[1].trackId,assetId:asset,startFrame:185,durationFrames:68}]});
 t=await call('timeline.inspect');await call('timeline.apply',{expectedRevision:t.revision,operationId:'duration-follow-content',ops:[{op:'timeline.settings',durationMode:'auto'}]});t=await call('timeline.inspect');assert.equal(t.settings.durationFrames,532);
 const snapshot=await call('preview.snapshot',{revision:t.revision});assert(snapshot.snapshotId||snapshot.entry||snapshot.files);
 const job=await call('render',{revision:t.revision}),result=await waitJob(c,job.jobId);assert.equal(result.state,'succeeded',JSON.stringify(result));const video=join(out,'content-duration.mp4');await copyFile(result.artifact.path||join(f.config.outputRoot,result.artifact.name),video);
 const probe=JSON.parse(execFileSync('ffprobe',['-v','error','-show_entries','stream=nb_frames,duration','-of','json',video],{encoding:'utf8'})),stream=probe.streams[0];assert.equal(Number(stream.nb_frames),532);assert(Math.abs(Number(stream.duration)-532/30)<.001);
 await writeFile(join(out,'result.json'),JSON.stringify({ok:true,durationFrames:532,expectedSeconds:532/30,probe},null,2));console.log(JSON.stringify({ok:true,frames:Number(stream.nb_frames),seconds:Number(stream.duration)}));
}finally{await c?.stop();await f.cleanup();}
