import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {applyOperations} from '../packages/video-engine-worker/src/timeline.mjs';
const source=await readFile('client.js','utf8');
const helpers=source.split('//#region host bridge helpers')[1].split('//#endregion')[0];
const {planTimelineMove}=vm.runInNewContext('(function(){'+helpers+';return {planTimelineMove};})()',{console,AbortController});
const base=()=>({schema:'dsh-video/timeline@1',projectId:'demo',settings:{width:320,height:180,fps:30,background:'#000000',durationFrames:600,durationMode:'fixed'},assets:[{assetId:'as_11111111',kind:'image',path:'media/a.png'}],tracks:[{trackId:'tr_top',kind:'video',clips:[{clipId:'cl_long',kind:'image',assetId:'as_11111111',startFrame:0,durationFrames:532}]},{trackId:'tr_lower',kind:'video',clips:[{clipId:'cl_short',kind:'image',assetId:'as_11111111',startFrame:54,durationFrames:68}]}]});
let checks=0;
function plan(t,id,track,start,options={}){return JSON.parse(JSON.stringify(planTimelineMove(t,id,track,start,{snap:false,zoom:60,playheadFrame:65,...options})));}
for(const [id,track,start,end] of [['cl_short','tr_top',540,608],['cl_long','tr_lower',159,691]]){
 const t=base(),before=JSON.stringify(t),p=plan(t,id,track,start);assert.equal(p.valid,true);assert.equal(p.nextDuration,end);assert.equal(p.startFrame,start);
 const next=applyOperations(t,p.ops).timeline;assert.equal(next.settings.durationFrames,end);assert.equal(next.tracks.find(x=>x.trackId===track).clips.find(c=>c.clipId===id).startFrame,start);assert.equal(JSON.stringify(t),before);checks++;
}
let t=base();assert.equal(plan(t,'cl_short','tr_top',500).reason,'overlap');assert.equal(plan(t,'cl_long','tr_lower',100).reason,'overlap');checks++;
t.tracks[1].clips.push({clipId:'cl_other',kind:'image',assetId:'as_11111111',startFrame:200,durationFrames:60});assert.equal(plan(t,'cl_short','tr_lower',190).valid,false);checks++;
let p=plan(base(),'cl_short','tr_top',530,{snap:true});assert.equal(p.startFrame,532);assert.equal(p.nextDuration,600);assert([532,600].includes(p.snapFrame));assert.equal(p.ops.length,2);checks++;
p=plan(base(),'cl_short','tr_lower',130,{snap:true,playheadFrame:200});assert.equal(p.startFrame,132,'snap moving end to playhead, not only start');checks++;
p=plan(base(),'cl_short','tr_lower',125,{snap:true,playheadFrame:127});assert.equal(p.startFrame,127,'nearest candidate wins, not first boundary in array');checks++;
p=plan(base(),'cl_short','tr_lower',125,{snap:false});assert.equal(p.startFrame,125);assert.equal(p.snapFrame,null);checks++;
p=plan(base(),'cl_short','tr_lower',-20);assert.equal(p.startFrame,0);assert(p.valid);checks++;
t=base();t.tracks[1].locked=true;assert.equal(plan(t,'cl_long','tr_lower',160).reason,'locked');assert.equal(plan(t,'cl_short','tr_top',540).reason,'locked');checks++;
t=base();t.tracks.push({trackId:'tr_audio',kind:'audio',clips:[]});assert.equal(plan(t,'cl_long','tr_audio',0).reason,'kind');assert.equal(plan(t,'cl_long',null,0).reason,'outside');checks++;
t=base();t.settings.durationMode='auto';p=plan(t,'cl_long','tr_lower',160);assert.equal(p.ops.length,1);assert.equal(applyOperations(t,p.ops).timeline.settings.durationFrames,692);checks++;
t=base();let next=applyOperations(t,[{op:'timeline.settings',durationMode:'auto'}]).timeline;assert.equal(next.settings.durationFrames,532);checks++;
next=applyOperations(next,[{op:'clip.trim',clipId:'cl_long',edge:'out',deltaFrames:-32}]).timeline;assert.equal(next.settings.durationFrames,500);checks++;
next=applyOperations(next,[{op:'clip.delete',clipId:'cl_long'}]).timeline;assert.equal(next.settings.durationFrames,122);checks++;
next.assets.push({assetId:'as_22222222',kind:'audio',fps:30,durationFrames:900,path:'media/sound.wav'});next.tracks.push({trackId:'tr_audio',kind:'audio',clips:[]});
next=applyOperations(next,[{op:'clip.insert',trackId:'tr_audio',assetId:'as_22222222',startFrame:30,durationFrames:600}]).timeline;assert.equal(next.settings.durationFrames,630);checks++;
console.log(JSON.stringify({ok:true,checks}));
