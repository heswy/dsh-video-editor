import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,rm,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {TimelineVisuals} from '../src/timeline-visuals.mjs';
import {timelineRevision} from '../src/timeline.mjs';
test('real video visual job yields different frames and audible envelope without editing timeline',async()=>{
 const root=await mkdtemp(resolve(tmpdir(),'dsh-visual-test-'));
 try{
  const path=resolve(root,'video.mp4');
  execFileSync('ffmpeg',['-v','error','-f','lavfi','-i','testsrc2=size=320x180:rate=30:duration=3','-f','lavfi','-i','sine=frequency=440:duration=3','-c:v','libx264','-c:a','aac','-shortest',path]);
  const c={clipId:'cl_a',kind:'media',assetId:'as_12345678',startFrame:0,sourceInFrame:0,durationFrames:90,speed:1};
  const asset={assetId:c.assetId,kind:'video',hasAudio:true,fps:30,durationFrames:90,sha256:'a'.repeat(64)};
  const t={projectId:'test',assets:[asset],tracks:[{clips:[c]}]};const revision=timelineRevision(t);
  const service=new TimelineVisuals({dir:()=>root,load:async()=>({timeline:t}),media:{resolveFile:async()=>({path,asset})}});
  const req=await service.request({projectId:'test',expectedRevision:revision,clipId:'cl_a',startFrame:0,endFrame:90,count:4});
  await service.tail;
  const result=service.status({projectId:'test',taskId:req.taskId});assert.equal(result.status,'complete',JSON.stringify(result));
  assert.equal(result.result.thumbnails.length,4);assert.notEqual(result.result.thumbnails[0].data,result.result.thumbnails[3].data);
  assert.ok(result.result.waveform.peaks.some(x=>x>.01));assert.equal(timelineRevision(t),revision);
  assert.ok(JSON.stringify(result).length<65536);
  const second=await service.request({projectId:'test',expectedRevision:revision,clipId:'cl_a',startFrame:30,endFrame:60,count:2});
  service.cancel({projectId:'test',taskId:second.taskId});await service.tail;assert.equal(service.status({projectId:'test',taskId:second.taskId}).status,'cancelled');
 }finally{await rm(root,{recursive:true,force:true});}
});
test('AI scene sampling uses its own deterministic timeline and changes images',async()=>{
 const root=await mkdtemp(resolve(tmpdir(),'dsh-scene-visual-'));
 try{
  const c={clipId:'cl_scene',kind:'composition',startFrame:0,sourceInFrame:0,durationFrames:60,scene:{path:'scenes/'+ 'b'.repeat(64)+'.html',durationFrames:60}};
  const t={projectId:'scene',settings:{width:320,height:180},assets:[],tracks:[{clips:[c]}]};
  const html=Buffer.from('<html><body style="margin:0"><div style="width:320px;height:180px;background:red" id="box"></div><script>window.__timelines={main:{pause(){},seek(t){document.getElementById("box").style.background=t<1?"red":"blue"}}}</script></body></html>');
  const revision=timelineRevision(t);
  const service=new TimelineVisuals({dir:()=>root,load:async()=>({timeline:t}),read:async()=>({revision,files:new Map([['scene-cl_scene.html',html]]),entries:[{path:'scene-cl_scene.html',sha256:'x'}]})});
  const task=await service.request({projectId:'scene',expectedRevision:revision,clipId:c.clipId,startFrame:0,endFrame:60,count:2});await service.tail;
  const result=service.status({projectId:'scene',taskId:task.taskId});assert.equal(result.status,'complete',JSON.stringify(result));assert.notEqual(result.result.thumbnails[0].data,result.result.thumbnails[1].data);
 }finally{await rm(root,{recursive:true,force:true});}
});
test('120 second quiet audio retains silence and structure with bounded cached data',async()=>{
 const root=await mkdtemp(resolve(tmpdir(),'dsh-long-wave-'));
 try{
  const path=resolve(root,'quiet.wav'),rate=8000,samples=120*rate,buffer=Buffer.alloc(44+samples*2);
  buffer.write('RIFF');buffer.writeUInt32LE(buffer.length-8,4);buffer.write('WAVEfmt ',8);buffer.writeUInt32LE(16,16);buffer.writeUInt16LE(1,20);buffer.writeUInt16LE(1,22);buffer.writeUInt32LE(rate,24);buffer.writeUInt32LE(rate*2,28);buffer.writeUInt16LE(2,32);buffer.writeUInt16LE(16,34);buffer.write('data',36);buffer.writeUInt32LE(samples*2,40);
  for(let i=0;i<samples;i++)buffer.writeInt16LE(Math.floor(i/rate)%2===0?Math.round(32767*.01*Math.sin(i/rate*2*Math.PI*220)):0,44+i*2);
  await writeFile(path,buffer);
  const c={clipId:'cl_long',kind:'media',assetId:'as_12345678',startFrame:0,sourceInFrame:0,durationFrames:3600,speed:1};
  const asset={assetId:c.assetId,kind:'audio',fps:rate,durationFrames:samples,sha256:'c'.repeat(64)};
  const t={projectId:'long',assets:[asset],tracks:[{clips:[c]}]},revision=timelineRevision(t);
  const service=new TimelineVisuals({dir:()=>root,load:async()=>({timeline:t}),media:{resolveFile:async()=>({path,asset})}});
  const start=performance.now(),rss=process.memoryUsage().rss;
  const first=await service.request({projectId:'long',expectedRevision:revision,clipId:c.clipId,startFrame:0,endFrame:120,count:1});await service.tail;
  const result=service.status({projectId:'long',taskId:first.taskId});assert.equal(result.status,'complete',JSON.stringify(result));
  assert.ok(result.result.waveform.peaks.some(x=>x===0));assert.ok(result.result.waveform.peaks.some(x=>x>.005));assert.equal(result.result.thumbnails.length,0);
  const cached=await service.request({projectId:'long',expectedRevision:revision,clipId:c.clipId,startFrame:120,endFrame:240,count:1});await service.tail;assert.equal(service.status({projectId:'long',taskId:cached.taskId}).status,'complete');
  console.log(JSON.stringify({kind:'120s-waveform',elapsedMs:Math.round(performance.now()-start),rssDelta:process.memoryUsage().rss-rss,responseBytes:JSON.stringify(result).length}));
 }finally{await rm(root,{recursive:true,force:true});}
});
test('global cache budget removes only owned derived files',async()=>{
 const {open,stat}=await import('node:fs/promises');const root=await mkdtemp(resolve(tmpdir(),'dsh-cache-budget-'));
 try{
  const service=new TimelineVisuals({dir:id=>resolve(root,id)}),roots=[];
  const protectedPath=resolve(root,'user.wav');await writeFile(protectedPath,'keep');
  for(let i=0;i<5;i++){
   const project=resolve(root,'p'+i);await mkdir(project);
   const cache=await service.cacheRoot('p'+i);roots.push(cache);
   const file=await open(resolve(cache,String(i).repeat(64)+'.jpg'),'w');await file.truncate(128*1024*1024);await file.close();
  }
  await service.trim(roots[0]);let bytes=0;
  for(let i=0;i<5;i++)bytes+=(await stat(resolve(roots[i],String(i).repeat(64)+'.jpg')).catch(()=>({size:0}))).size;
  assert.ok(bytes<=512*1024*1024);assert.equal(await readFile(protectedPath,'utf8'),'keep');
 }finally{await rm(root,{recursive:true,force:true});}
});
