/** Actual worker frame and MP4 pixel checks; disposable two-track project only. */
import assert from 'node:assert/strict';
import {fixture,client,waitJob} from '../packages/video-engine-worker/test/helpers.mjs';
import {mkdir,writeFile,copyFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
const require=createRequire(resolve('packages/video-engine-worker/package.json')),sharp=require('sharp');
const f=await fixture(),out=resolve(process.argv[2]||'/tmp/upper-track-pixels'),stage=process.argv.indexOf('--staging');
await mkdir(out,{recursive:true});let c;
try{
 const inbox=join(f.dir,'inbox');await mkdir(inbox);
 await writeFile(join(f.dir,'managed.json'),JSON.stringify({projects:f.config.projects}));
 await writeFile(f.registry,JSON.stringify({projectsRoot:f.config.root,registryPath:join(f.dir,'managed.json'),outputRoot:f.config.outputRoot,assetInboxRoot:inbox}));
 for(const [name,color] of [['upper.png','#ff0000'],['lower.png','#0000ff']])await sharp({create:{width:320,height:180,channels:4,background:color}}).png().toFile(join(inbox,name));
 c=client(f.registry,stage<0?{}:{workerEntry:join(resolve(process.argv[stage+1]),'engine-worker/src/worker.mjs')});
 const call=async(method,p={})=>{const r=await c.call(method,{projectId:'demo',...p});assert(r.ok,JSON.stringify(r));return r.result;};
 await call('open');let t=await call('timeline.inspect');
 const upper=(await call('asset.importMedia',{sourceName:'upper.png'})).asset.assetId,lower=(await call('asset.importMedia',{sourceName:'lower.png'})).asset.assetId;
 await call('timeline.apply',{expectedRevision:t.revision,operationId:'stack-init',ops:[{op:'clip.delete',clipId:t.tracks[0].clips[0].clipId},{op:'track.add',kind:'video'},{op:'timeline.settings',width:320,height:180,durationFrames:30,durationMode:'fixed'}]});
 t=await call('timeline.inspect');
 await call('timeline.apply',{expectedRevision:t.revision,operationId:'stack-insert',ops:[{op:'clip.insert',trackId:t.tracks[0].trackId,assetId:upper,startFrame:0,durationFrames:30},{op:'clip.insert',trackId:t.tracks[1].trackId,assetId:lower,startFrame:0,durationFrames:30}]});
 const pixels=[];
 async function checkFrame(name,channel){
  t=await call('timeline.inspect');const job=await call('frame',{revision:t.revision,times:[.5]});const result=await waitJob(c,job.jobId);assert.equal(result.state,'succeeded',JSON.stringify(result));
  const path=join(out,name+'.png');await copyFile((result.artifact.path||join(f.config.outputRoot,result.artifact.name)),path);
  const {data,info}=await sharp(path).raw().toBuffer({resolveWithObject:true});const at=(Math.floor(info.height/2)*info.width+Math.floor(info.width/2))*info.channels;const rgb=[...data.subarray(at,at+3)];
  assert(rgb[channel]>220&&rgb[channel===0?2:0]<35,JSON.stringify({name,rgb}));pixels.push({name,rgb});
 }
 await checkFrame('upper-visible',0);
 t=await call('timeline.inspect');await call('timeline.apply',{expectedRevision:t.revision,operationId:'hide-upper',ops:[{op:'track.update',trackId:t.tracks[0].trackId,patch:{hidden:true}}]});
 await checkFrame('upper-hidden',2);
 t=await call('timeline.inspect');await call('timeline.apply',{expectedRevision:t.revision,operationId:'show-upper',ops:[{op:'track.update',trackId:t.tracks[0].trackId,patch:{hidden:false}}]});
 t=await call('timeline.inspect');const job=await call('render',{revision:t.revision});const result=await waitJob(c,job.jobId);assert.equal(result.state,'succeeded',JSON.stringify(result));const video=join(out,'upper-track.mp4');await copyFile((result.artifact.path||join(f.config.outputRoot,result.artifact.name)),video);
 const raw=execFileSync('ffmpeg',['-v','error','-ss','0.5','-i',video,'-frames:v','1','-vf','crop=2:2:160:90','-f','rawvideo','-pix_fmt','rgb24','pipe:1']);assert(raw[0]>220&&raw[2]<35,JSON.stringify([...raw.subarray(0,3)]));pixels.push({name:'mp4-upper-visible',rgb:[...raw.subarray(0,3)]});
 await writeFile(join(out,'result.json'),JSON.stringify({ok:true,pixels},null,2));console.log(JSON.stringify({ok:true,pixels}));
}finally{await c?.stop();await f.cleanup();}
